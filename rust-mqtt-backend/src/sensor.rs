//! payload → InfluxDB Line Protocol 组装（对齐 go-mqtt-backend/internal/sensor）。
//!
//! ⚠️ 陷阱 9/10/11：Line Protocol 转义、无 field 不写、float 用 `{}` 格式化。

use serde_json::{Map, Value};
use tracing::{debug, warn};

use crate::classifier::{classify_payload, FieldKind};
use crate::influx::InfluxWriter;
use crate::timestamp::{normalize_to_nanos, Unit};

/// measurement 名（固定，对齐 2.2）。
const MEASUREMENT: &str = "sensor_reading";

/// tag/field key 转义：空格、逗号、等号前加反斜杠。
fn escape_key(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            ' ' => out.push_str("\\ "),
            ',' => out.push_str("\\,"),
            '=' => out.push_str("\\="),
            c => out.push(c),
        }
    }
    out
}

/// tag value 转义：空格、逗号、等号前加反斜杠。
fn escape_tag_value(s: &str) -> String {
    escape_key(s)
}

/// string field value 转义：反斜杠与双引号。
fn escape_string_value(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for ch in s.chars() {
        match ch {
            '\\' => {
                out.push('\\');
                out.push('\\');
            }
            '"' => {
                out.push('\\');
                out.push('"');
            }
            c => out.push(c),
        }
    }
    out
}

/// float 格式化：用 `{}`（42.0 → "42"，25.6 → "25.6"），符合 Line Protocol。
fn format_float(f: f64) -> String {
    format!("{f}")
}

/// 纯组装：把 payload 组装成一行 Line Protocol（不含日志）。
/// 若没有任何 field（全被 skip）返回 None（⚠️ 陷阱 10）。
pub(crate) fn build_line(device_id: &str, data: &Map<String, Value>, nanos: i64) -> Option<String> {
    let classified = classify_payload(data);

    // tags：app + device_id 固定，再加分类为 tag 的字段
    let mut tags: Vec<(String, String)> = vec![
        ("app".to_string(), "mqtt-consumer".to_string()),
        ("device_id".to_string(), device_id.to_string()),
    ];
    let mut fields: Vec<String> = Vec::new();

    for c in &classified {
        match c.kind {
            FieldKind::Tag => {
                if let Some(v) = c.value.as_ref().and_then(|v| v.as_str()) {
                    tags.push((c.key.clone(), v.to_string()));
                }
            }
            FieldKind::Float => {
                if let Some(f) = c.value.as_ref().and_then(|v| v.as_f64()) {
                    fields.push(format!("{}={}", escape_key(&c.key), format_float(f)));
                }
            }
            FieldKind::Boolean => {
                if let Some(b) = c.value.as_ref().and_then(|v| v.as_bool()) {
                    fields.push(format!("{}={}", escape_key(&c.key), if b { "t" } else { "f" }));
                }
            }
            FieldKind::String => {
                if let Some(s) = c.value.as_ref().and_then(|v| v.as_str()) {
                    let mut field = escape_key(&c.key);
                    field.push('=');
                    field.push('"');
                    field.push_str(&escape_string_value(s));
                    field.push('"');
                    fields.push(field);
                }
            }
            FieldKind::Skip => {}
        }
    }

    if fields.is_empty() {
        return None;
    }

    // 排序 tag 保证确定性输出（app < device_id < location < type ...）
    tags.sort_by(|a, b| a.0.cmp(&b.0));
    let tag_str = tags
        .iter()
        .map(|(k, v)| format!("{}={}", escape_key(k), escape_tag_value(v)))
        .collect::<Vec<_>>()
        .join(",");

    Some(format!(
        "{MEASUREMENT},{tag_str} {} {nanos}",
        fields.join(",")
    ))
}

/// 把 payload 组装成 Line Protocol 并入队写入（含分类日志与时间戳归一化）。
pub fn write_sensor_data(
    device_id: &str,
    data: &Map<String, Value>,
    ts: Option<f64>,
    influx: &InfluxWriter,
) {
    // 分类日志（coerced warn / 白名单不可解析 warn / skip debug）
    for c in classify_payload(data) {
        match c.kind {
            FieldKind::Float => {
                if c.coerced {
                    let coerced_to = c.value.as_ref().and_then(|v| v.as_f64()).unwrap_or(0.0);
                    warn!(
                        deviceId = %device_id,
                        field = %c.key,
                        raw = %c.raw,
                        coercedTo = coerced_to,
                        "字段本应是数值但收到字符串，已自动转为 float（建议修传感器固件）"
                    );
                }
            }
            FieldKind::String => {
                if c.reason == "numeric-hint but not parseable" {
                    warn!(
                        deviceId = %device_id,
                        field = %c.key,
                        "字段在数值白名单里但无法解析成数字，已按字符串写入"
                    );
                }
            }
            FieldKind::Skip => {
                debug!(
                    deviceId = %device_id,
                    field = %c.key,
                    reason = %c.reason,
                    "跳过字段"
                );
            }
            _ => {}
        }
    }

    // 时间戳归一化
    let result = normalize_to_nanos(ts);
    if result.used_fallback {
        debug!(deviceId = %device_id, "payload 未提供 timestamp，使用服务器当前时间");
    } else if result.unit != Unit::Nanosecond {
        debug!(
            deviceId = %device_id,
            unit = result.unit.as_str(),
            "已自动将时间戳转换为纳秒"
        );
    }

    match build_line(device_id, data, result.nanos) {
        Some(line) => influx.write_line(line),
        None => debug!(deviceId = %device_id, "无有效字段，跳过写入"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_line_basic() {
        let data = json!({"temperature": 25.6, "location": "lab"});
        let line = build_line("dev1", data.as_object().unwrap(), 1758470400000000000).unwrap();
        assert_eq!(
            "sensor_reading,app=mqtt-consumer,device_id=dev1,location=lab temperature=25.6 1758470400000000000",
            line
        );
    }

    #[test]
    fn build_line_no_fields_returns_none() {
        // 全被 skip：只剩黑名单字段
        let data = json!({"messageId": "x", "timestamp": 1758470400000.0});
        assert!(build_line("dev1", data.as_object().unwrap(), 1).is_none());
    }

    #[test]
    fn build_line_bool_and_string_fields() {
        let data = json!({"online": true, "status": "ok"});
        let line = build_line("dev1", data.as_object().unwrap(), 100).unwrap();
        // fields 按 key 排序：online 在 status 前
        assert!(line.contains("online=t"), "{line}");
        assert!(line.contains("status=\"ok\""), "{line}");
    }

    #[test]
    fn build_line_escapes_tag_and_device_id() {
        let data = json!({"temperature": 1.0});
        let line = build_line("a b,c=d", data.as_object().unwrap(), 5).unwrap();
        assert!(line.contains("device_id=a\\ b\\,c\\=d"), "{line}");
    }

    #[test]
    fn build_line_escapes_string_value() {
        let data = json!({"note": "he said \"hi\""});
        let line = build_line("d", data.as_object().unwrap(), 5).unwrap();
        assert!(line.contains(r#"note="he said \"hi\"""#), "{line}");
    }

    #[test]
    fn build_line_integer_float_no_decimal() {
        let data = json!({"count": 42});
        let line = build_line("d", data.as_object().unwrap(), 5).unwrap();
        assert!(line.contains("count=42 "), "{line}");
        assert!(!line.contains("count=42.0"), "{line}");
    }

    #[test]
    fn escape_key_spaces_commas_equals() {
        assert_eq!("a\\ b", escape_key("a b"));
        assert_eq!("a\\,b", escape_key("a,b"));
        assert_eq!("a\\=b", escape_key("a=b"));
    }

    #[test]
    fn escape_string_value_quotes_and_backslash() {
        assert_eq!("a\\\"b", escape_string_value("a\"b"));
        assert_eq!("a\\\\b", escape_string_value("a\\b"));
    }
}
