//! InfluxDB 2.x 批量写入客户端（手写 Line Protocol + reqwest 批量 POST）。
//!
//! 参数对齐 HANDOFF.md 2.11：batch=500 / flush=1s / retry=3 / precision=ns。

use std::sync::Mutex;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{error, info};

use crate::config::Config;

const BATCH_SIZE: usize = 500;
const FLUSH_INTERVAL_MS: u64 = 1000;
const RETRY_INTERVAL_MS: u64 = 1000;
const MAX_RETRIES: u32 = 3;

/// 批量写入器：把 Line Protocol 通过 channel 送入后台任务，批量 POST 到 InfluxDB。
pub struct InfluxWriter {
    tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    handle: Mutex<Option<JoinHandle<()>>>,
    client: reqwest::Client,
    url: String,
    token: String,
}

impl InfluxWriter {
    /// 启动后台批量写入任务。
    pub fn new(cfg: &Config) -> Self {
        let client = reqwest::Client::new();
        let (tx, rx) = mpsc::unbounded_channel::<String>();

        let task_client = client.clone();
        let task_url = cfg.influx_url.clone();
        let task_org = cfg.influx_org.clone();
        let task_bucket = cfg.influx_bucket.clone();
        let task_token = cfg.influx_token.clone();

        let handle = tokio::spawn(async move {
            run_writer(
                rx,
                task_client,
                task_url,
                task_org,
                task_bucket,
                task_token,
            )
            .await;
        });

        info!(
            url = %cfg.influx_url,
            org = %cfg.influx_org,
            bucket = %cfg.influx_bucket,
            batchSize = BATCH_SIZE as i64,
            flushIntervalMs = FLUSH_INTERVAL_MS as i64,
            "InfluxDB writeAPI 已就绪"
        );

        InfluxWriter {
            tx: Mutex::new(Some(tx)),
            handle: Mutex::new(Some(handle)),
            client,
            url: cfg.influx_url.clone(),
            token: cfg.influx_token.clone(),
        }
    }

    /// 把一行 Line Protocol 入队（非阻塞）。
    pub fn write_line(&self, line: String) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(line);
        }
    }

    /// 优雅关闭：drop 发送端 → 后台任务 flush 剩余并退出 → await 其 handle。
    pub async fn close(&self) {
        // 先 drop sender，触发后台任务收尾 flush
        {
            let _ = self.tx.lock().unwrap().take();
        }
        let handle = self.handle.lock().unwrap().take();
        if let Some(h) = handle {
            let _ = h.await;
        }
        info!("InfluxDB 缓冲区已刷出，连接已关闭");
    }

    /// 连通性检查（GET /ping），3s 超时。
    pub async fn ping(&self) -> anyhow::Result<()> {
        let url = format!("{}/ping", self.url.trim_end_matches('/'));
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Token {}", self.token))
            .timeout(Duration::from_secs(3))
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            anyhow::bail!("influx ping returned status {}", resp.status())
        }
    }
}

/// 后台写入循环：满 500 行或每 1s tick → flush；channel 关闭 → flush 剩余后退出。
async fn run_writer(
    mut rx: mpsc::UnboundedReceiver<String>,
    client: reqwest::Client,
    url: String,
    org: String,
    bucket: String,
    token: String,
) {
    let mut buffer: Vec<String> = Vec::with_capacity(BATCH_SIZE);
    let mut interval = tokio::time::interval(Duration::from_millis(FLUSH_INTERVAL_MS));

    loop {
        tokio::select! {
            maybe = rx.recv() => {
                match maybe {
                    Some(line) => {
                        buffer.push(line);
                        if buffer.len() >= BATCH_SIZE {
                            flush(&client, &url, &org, &bucket, &token, &mut buffer).await;
                        }
                    }
                    None => {
                        // channel 关闭：flush 剩余后退出
                        if !buffer.is_empty() {
                            flush(&client, &url, &org, &bucket, &token, &mut buffer).await;
                        }
                        break;
                    }
                }
            }
            _ = interval.tick() => {
                if !buffer.is_empty() {
                    flush(&client, &url, &org, &bucket, &token, &mut buffer).await;
                }
            }
        }
    }
}

/// 把 buffer 用换行拼接后 POST；失败重试最多 3 次（每次间隔 1s）。
/// ⚠️ 陷阱 8：panic="abort" 下不 unwrap 网络结果，用 match + 日志。
async fn flush(
    client: &reqwest::Client,
    url: &str,
    org: &str,
    bucket: &str,
    token: &str,
    buffer: &mut Vec<String>,
) {
    if buffer.is_empty() {
        return;
    }
    let body = buffer.join("\n");
    let endpoint = format!("{}/api/v2/write", url.trim_end_matches('/'));

    let mut ok = false;
    for attempt in 0..=MAX_RETRIES {
        let resp = client
            .post(&endpoint)
            .query(&[("org", org), ("bucket", bucket), ("precision", "ns")])
            .header("Authorization", format!("Token {token}"))
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(body.clone())
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                ok = true;
                break;
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                error!(status = %status, error = %text, "InfluxDB 写入失败");
            }
            Err(e) => {
                error!(error = %e, "InfluxDB 写入失败");
            }
        }

        if attempt < MAX_RETRIES {
            tokio::time::sleep(Duration::from_millis(RETRY_INTERVAL_MS)).await;
        }
    }

    if !ok {
        // 仍失败：丢弃该批，不无限堆积
        error!(dropped_lines = buffer.len() as i64, "InfluxDB 批次重试耗尽，丢弃");
    }
    buffer.clear();
}
