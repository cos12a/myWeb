//! rust-mqtt-backend 统一入口：装配所有模块 + 优雅关闭（对齐 go cmd/consumer/main.go）。

mod classifier;
mod config;
mod dedup;
mod health;
mod influx;
mod logger;
mod mqtt;
mod sensor;
mod timestamp;

use std::process::exit;
use std::sync::Arc;
use std::time::{Duration, Instant};

use clap::Parser;
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::config::Config;
use crate::dedup::MessageDeduplicator;
use crate::health::AppState;
use crate::influx::InfluxWriter;
use crate::mqtt::MqttConsumer;

#[derive(Parser)]
#[command(
    name = "rust-mqtt-consumer",
    version = "2.1.0",
    about = "Rust rewrite of bun-mqtt-backend: MQTT -> dedup/classify/normalize -> InfluxDB 2.x"
)]
struct Args {
    /// 环境变量文件路径
    #[arg(long, default_value = ".env", value_name = "FILE")]
    env_file: String,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // ---------- 加载 .env 文件（不存在不 fatal） ----------
    if let Err(e) = dotenvy::from_filename(&args.env_file) {
        eprintln!(
            "⚠️  无法加载 {}: {}（将使用系统环境变量）",
            args.env_file, e
        );
    }

    // ---------- 配置校验（一次性返回所有错误） ----------
    let cfg = match Config::load() {
        Ok(c) => c,
        Err(errs) => {
            eprintln!("❌ 环境变量校验失败:");
            for e in errs {
                eprintln!("   - {e}");
            }
            exit(1);
        }
    };

    // ---------- 日志初始化（最先） ----------
    logger::init(&cfg.log_level);

    let cfg = Arc::new(cfg);
    info!(config = %cfg.snapshot(), "启动 rust-mqtt-backend");

    // ---------- InfluxDB（在 MQTT 之前建） ----------
    let influx = Arc::new(InfluxWriter::new(&cfg));

    // 启动连通性检查（非阻塞、非 fatal）
    {
        let influx_ping = influx.clone();
        tokio::spawn(async move {
            match influx_ping.ping().await {
                Ok(_) => tracing::debug!("InfluxDB 连通性检查通过"),
                Err(e) => warn!(error = %e, "InfluxDB 连通性检查失败"),
            }
        });
    }

    // ---------- 去重器 ----------
    let dedup = Arc::new(MessageDeduplicator::new(
        cfg.dedup_enabled,
        cfg.dedup_max_size,
        cfg.dedup_ttl_ms,
    ));
    dedup.spawn_sweep();

    // ---------- MQTT Consumer ----------
    let (consumer, connected) =
        match MqttConsumer::start(cfg.clone(), dedup.clone(), influx.clone()).await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("❌ MQTT 启动失败: {e}");
                exit(1);
            }
        };

    // ---------- Health Server ----------
    let state = AppState {
        start: Instant::now(),
        cfg: cfg.clone(),
        connected: connected.clone(),
        dedup: dedup.clone(),
    };
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let health_handle = tokio::spawn(async move {
        if let Err(e) = health::serve(state, shutdown_rx).await {
            tracing::error!(error = %e, "健康检查服务器异常退出");
        }
    });
    info!(
        port = cfg.health_port as i64,
        hostname = "localhost",
        "健康检查端点已启动"
    );

    // ---------- 等待信号 ----------
    let sig_name = wait_for_signal().await;
    info!(signal = %sig_name, "收到信号，正在关闭...");

    // ---------- 5 秒兜底强制退出 ----------
    let shutdown_fut =
        graceful_shutdown(shutdown_tx, health_handle, &dedup, &consumer, &influx);
    if tokio::time::timeout(Duration::from_secs(5), shutdown_fut)
        .await
        .is_err()
    {
        warn!("优雅关闭超时，强制退出");
        exit(1);
    }

    logger::sync();
    println!("👋 已安全退出");
}

/// 等待 SIGINT / SIGTERM，返回信号名。
async fn wait_for_signal() -> String {
    let mut sigterm = signal(SignalKind::terminate()).expect("无法绑定 SIGTERM");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => "SIGINT".to_string(),
        _ = sigterm.recv() => "SIGTERM".to_string(),
    }
}

/// 按依赖顺序优雅关闭（对齐 2.10）：
/// ① health → ② dedup sweep → ③ MQTT → ④ InfluxDB flush → ⑤ 日志。
async fn graceful_shutdown(
    health_tx: oneshot::Sender<()>,
    health_handle: JoinHandle<()>,
    dedup: &Arc<MessageDeduplicator>,
    consumer: &MqttConsumer,
    influx: &Arc<InfluxWriter>,
) {
    // ① 停止健康检查 HTTP 服务器
    let _ = health_tx.send(());
    let _ = health_handle.await;

    // ② 停止去重器 sweep 后台任务
    dedup.stop();

    // ③ 断开 MQTT（不再产生新点）
    consumer.stop().await;

    // ④ 刷新 InfluxDB 写入缓冲区（确保缓冲里的点全部落库）
    influx.close().await;

    // ⑤ 日志刷新在 main 里调用 logger::sync()
}
