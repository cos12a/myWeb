//! HTTP 健康检查 / 统计端点（对齐 go-mqtt-backend/internal/health）。
//!
//! 三路由 GET / /health /stats，返回 JSON（字段名逐字对齐 2.8）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::config::Config;
use crate::dedup::MessageDeduplicator;

/// axum 共享状态（Clone + Send + Sync）。
#[derive(Clone)]
pub struct AppState {
    pub start: Instant,
    pub cfg: Arc<Config>,
    pub connected: Arc<AtomicBool>,
    pub dedup: Arc<MessageDeduplicator>,
}

async fn root() -> Json<Value> {
    Json(json!({
        "name": "rust-mqtt-backend",
        "version": "2.1.0",
        "endpoints": ["/health", "/stats"],
    }))
}

async fn health(State(s): State<AppState>) -> (StatusCode, Json<Value>) {
    let connected = s.connected.load(Ordering::SeqCst);
    let (status_str, code) = if connected {
        ("ok", StatusCode::OK)
    } else {
        ("degraded", StatusCode::SERVICE_UNAVAILABLE)
    };
    let body = json!({
        "status": status_str,
        "mqtt": { "connected": connected },
        "uptimeSec": s.start.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true),
    });
    (code, Json(body))
}

async fn stats(State(s): State<AppState>) -> Json<Value> {
    let connected = s.connected.load(Ordering::SeqCst);
    let dedup_stats = s.dedup.get_stats();
    Json(json!({
        "uptimeSec": s.start.elapsed().as_secs(),
        "mqtt": {
            "connected": connected,
            "clientId": s.cfg.mqtt_client_id,
            "subscribeTopic": s.cfg.mqtt_subscribe_topic,
        },
        "influx": {
            "url": s.cfg.influx_url,
            "org": s.cfg.influx_org,
            "bucket": s.cfg.influx_bucket,
        },
        "dedup": serde_json::to_value(dedup_stats).unwrap_or(Value::Null),
    }))
}

/// 绑定 :health_port 并服务，直到 shutdown_rx 收到信号（优雅关闭）。
pub async fn serve(state: AppState, shutdown_rx: oneshot::Receiver<()>) -> anyhow::Result<()> {
    let port = state.cfg.health_port;
    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/stats", get(stats))
        .with_state(state);

    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await?;
    Ok(())
}
