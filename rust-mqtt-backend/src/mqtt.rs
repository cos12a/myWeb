//! MQTT 消费者与消息流水线（对齐 go-mqtt-backend/internal/mqtt）。
//!
//! ⚠️ 陷阱 6：rumqttc EventLoop 必须持续 poll，否则不收发也不重连。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

use crate::classifier::classify_payload;
use crate::config::Config;
use crate::dedup::{compute_dedup_key, MessageDeduplicator};
use crate::influx::InfluxWriter;
use crate::sensor::write_sensor_data;

/// MQTT 消费者。
pub struct MqttConsumer {
    client: AsyncClient,
    connected: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

/// 从 mqtt://host:port 解析 host 与 port（默认 1883）。
fn parse_host_port(url: &str) -> (String, u16) {
    let without_scheme = url.split("://").nth(1).unwrap_or(url);
    let without_slash = without_scheme.trim_end_matches('/');
    match without_slash.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(1883)),
        None => (without_slash.to_string(), 1883),
    }
}

/// 从 topic 解析 deviceId：sensors/{id}/... → id，否则空字符串（对齐 2.2）。
pub fn parse_device_id_from_topic(topic: &str) -> String {
    let parts: Vec<&str> = topic.split('/').collect();
    if parts.len() >= 2 && parts[0] == "sensors" {
        parts[1].to_string()
    } else {
        String::new()
    }
}

/// 按 char 边界安全截断（避免 UTF-8 边界 panic）。
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let head: String = s.chars().take(max_chars).collect();
        format!("{head}...(truncated, total {} bytes)", s.len())
    }
}

/// 单条消息流水线（对齐 2.1）。同步执行，快速入队，不阻塞 poll。
fn handle_message(
    topic: &str,
    raw: &[u8],
    dedup: &MessageDeduplicator,
    influx: &InfluxWriter,
    log_level: &str,
) {
    // 1) JSON 解析 + 结构校验（必须是 object）
    let value: Value = match serde_json::from_slice(raw) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                topic = %topic,
                raw = %truncate(&String::from_utf8_lossy(raw), 200),
                error = %e,
                "JSON 解析失败，丢弃消息"
            );
            return;
        }
    };
    let obj = match value.as_object() {
        Some(o) => o,
        None => {
            warn!(
                topic = %topic,
                raw = %truncate(&String::from_utf8_lossy(raw), 200),
                "JSON 解析失败，丢弃消息"
            );
            return;
        }
    };

    // 2) 空对象丢弃
    if obj.is_empty() {
        warn!(topic = %topic, "payload 为空对象，丢弃");
        return;
    }

    // 3) 去重
    let dk = compute_dedup_key(topic, raw, obj);
    if !dedup.check_and_record(&dk.key) {
        debug!(topic = %topic, dedupKey = %dk.key, source = %dk.source, "重复消息已丢弃");
        return;
    }

    // 4) deviceId 回退链：topic → payload.deviceId → "unknown"
    let mut device_id = parse_device_id_from_topic(topic);
    if device_id.is_empty() {
        device_id = obj
            .get("deviceId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("unknown")
            .to_string();
    }

    // 5) debug 级别：打印完整 payload + 分类快照
    if log_level == "debug" {
        let fields: Vec<Value> = classify_payload(obj)
            .iter()
            .map(|f| {
                json!({
                    "field": f.key,
                    "kind": f.kind.as_str(),
                    "value": f.value,
                    "coerced": f.coerced,
                })
            })
            .collect();
        debug!(
            topic = %topic,
            deviceId = %device_id,
            dedupKey = %dk.key,
            payload = %value,
            fields = ?fields,
            "收到传感器数据"
        );
    }

    // 6) timestamp（可选，数字时）
    let ts = obj.get("timestamp").and_then(|v| v.as_f64());

    // 7) 组装并写入
    write_sensor_data(&device_id, obj, ts, influx);
}

impl MqttConsumer {
    /// 建连 + spawn EventLoop 驱动任务；返回自身与连接状态句柄。
    pub async fn start(
        cfg: Arc<Config>,
        dedup: Arc<MessageDeduplicator>,
        influx: Arc<InfluxWriter>,
    ) -> anyhow::Result<(Self, Arc<AtomicBool>)> {
        let (host, port) = parse_host_port(&cfg.mqtt_url);
        let mut opts = MqttOptions::new(cfg.mqtt_client_id.clone(), host, port);
        opts.set_credentials(cfg.mqtt_user.clone(), cfg.mqtt_pass.clone());
        opts.set_clean_session(false); // 持久会话
        opts.set_keep_alive(Duration::from_secs(60));

        let (client, mut eventloop) = AsyncClient::new(opts, 10);
        let connected = Arc::new(AtomicBool::new(false));

        let c_task = client.clone();
        let cfg_task = cfg.clone();
        let conn_task = connected.clone();
        let topic = cfg.mqtt_subscribe_topic.clone();
        let log_level = cfg.log_level.clone();

        let handle = tokio::spawn(async move {
            // prev_connected 用于仅在状态跃迁时打 warn，避免重试时刷屏。
            let mut prev_connected = false;
            let mut first_error_logged = false;
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        prev_connected = true;
                        conn_task.store(true, Ordering::SeqCst);
                        info!(
                            clientId = %cfg_task.mqtt_client_id,
                            url = %cfg_task.mqtt_url,
                            "已连接 MQTT Broker"
                        );
                        // 每次连接/重连后显式重新订阅（更稳）
                        match c_task.subscribe(topic.clone(), QoS::AtLeastOnce).await {
                            Ok(_) => info!(topic = %topic, qos = 1, "已订阅主题"),
                            Err(e) => error!(error = %e, "订阅失败"),
                        }
                    }
                    Ok(Event::Incoming(Packet::Publish(p))) => {
                        handle_message(&p.topic, &p.payload, &dedup, &influx, &log_level);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        conn_task.store(false, Ordering::SeqCst);
                        // 从已连接跌到断开，或首次连接失败：打一次 warn；其余重试降为 debug。
                        if prev_connected || !first_error_logged {
                            warn!(error = %e, "MQTT 连接断开，将自动重连");
                        } else {
                            debug!(error = %e, "MQTT 重连中");
                        }
                        prev_connected = false;
                        first_error_logged = true;
                        // ⚠️ 陷阱 6：连接失败时 poll 会立即返回 Err，必须显式延迟，
                        // 否则 EventLoop 会 busy-loop 刷屏（重试间隔 5s，对齐 2.2）。
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        });

        Ok((
            MqttConsumer {
                client,
                connected: connected.clone(),
                handle: Mutex::new(Some(handle)),
            },
            connected,
        ))
    }

    /// 优雅断开：发送 DISCONNECT，停止 EventLoop 任务。
    pub async fn stop(&self) {
        let _ = self.client.disconnect().await;
        self.connected.store(false, Ordering::SeqCst);
        if let Some(h) = self.handle.lock().unwrap().take() {
            h.abort();
        }
        info!("MQTT 连接已关闭");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_id_from_topic() {
        assert_eq!("ESP32-1", parse_device_id_from_topic("sensors/ESP32-1/data"));
        assert_eq!("dev", parse_device_id_from_topic("sensors/dev"));
        assert_eq!("", parse_device_id_from_topic("other/dev/data"));
        assert_eq!("", parse_device_id_from_topic("sensors"));
    }

    #[test]
    fn host_port_parsing() {
        assert_eq!(
            ("127.0.0.1".to_string(), 1883),
            parse_host_port("mqtt://127.0.0.1:1883")
        );
        assert_eq!(
            ("broker.local".to_string(), 1884),
            parse_host_port("mqtt://broker.local:1884")
        );
        assert_eq!(
            ("broker.local".to_string(), 1883),
            parse_host_port("mqtt://broker.local")
        );
    }

    #[test]
    fn truncate_long_string() {
        assert_eq!("abc", truncate("abc", 200));
        let long = "x".repeat(300);
        let t = truncate(&long, 200);
        assert!(t.starts_with(&"x".repeat(200)));
        assert!(t.contains("truncated"));
    }
}
