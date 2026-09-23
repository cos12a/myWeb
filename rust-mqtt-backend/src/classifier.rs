//! 传感器 payload 字段分类器（对齐 go-mqtt-backend/internal/classifier）。
//!
//! 7 层优先级分类：见 HANDOFF.md 第 2.3 节。

use serde_json::{Map, Number, Value};

/// SKIP_FIELDS 元字段黑名单：无论值是什么类型一律不入库（共 8 个，逐字对齐 2.4）。
pub const SKIP_FIELDS: [&str; 8] = [
    "messageId", "msgId", "message_id", "msg_id", "uuid", "id", "timestamp", "deviceId",
];

/// TAG_FIELDS：识别为 tag 的 key（低基数，共 2 个，对齐 2.5）。
pub const TAG_FIELDS: [&str; 2] = ["location", "type"];

/// NUMERIC_FIELD_HINTS：数值字段白名单（逐字对齐 2.5 的清单与 go fields.go）。
///
/// 注意：HANDOFF.md 2.5 概述写「28 项」，但其逐字清单与权威的 Go 源码
/// `fields.go` 实际都是 29 项（概述里「环境 12」应为 13）。行为以 Go 为准，
/// 故此处收录完整的 29 项。
pub const NUMERIC_FIELD_HINTS: [&str; 29] = [
    // 温湿度气压 4
    "temperature", "humidity", "pressure", "dewPoint",
    // 电量 5
    "battery", "voltage", "current", "power", "energy",
    // 无线信号 2
    "rssi", "snr",
    // 环境 13
    "lux", "co2", "tvoc", "pm25", "pm10", "pm1", "altitude", "windSpeed", "windDirection",
    "rainfall", "soilMoisture", "soilTemperature", "waterLevel",
    // 通用数值 5
    "value", "count", "duration", "weight", "distance",
];

/// 字段分类结果类型（对齐 2.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FieldKind {
    Skip,
    Tag,
    Float,
    Boolean,
    String,
}

impl FieldKind {
    /// 返回可读名称（用于日志），对齐 Go FieldKind.String()。
    pub fn as_str(&self) -> &'static str {
        match self {
            FieldKind::Skip => "skip",
            FieldKind::Tag => "tag",
            FieldKind::Float => "float",
            FieldKind::Boolean => "boolean",
            FieldKind::String => "string",
        }
    }
}

/// 单个字段的分类结果（对齐 Go ClassifiedField）。
#[derive(Debug, Clone)]
pub struct ClassifiedField {
    pub kind: FieldKind,
    pub key: String,
    /// Float -> Number；Tag/String -> String；Boolean -> Bool；Skip -> None
    pub value: Option<Value>,
    /// 是否从字符串强转而来
    pub coerced: bool,
    /// 强转前的原始字符串
    pub raw: String,
    /// skip 或特殊情况的原因说明
    pub reason: String,
}

impl ClassifiedField {
    fn skip(key: &str, reason: &str) -> Self {
        ClassifiedField {
            kind: FieldKind::Skip,
            key: key.to_string(),
            value: None,
            coerced: false,
            raw: String::new(),
            reason: reason.to_string(),
        }
    }
}

/// key 是否在黑名单里（8 项）。
pub fn is_skip_field(k: &str) -> bool {
    SKIP_FIELDS.contains(&k)
}

/// key 是否是 tag 字段（2 项）。
pub fn is_tag_field(k: &str) -> bool {
    TAG_FIELDS.contains(&k)
}

/// key 是否在数值白名单里（28 项）。
pub fn is_numeric_hint(k: &str) -> bool {
    NUMERIC_FIELD_HINTS.contains(&k)
}

/// 尝试把字符串解析成有限数字；失败返回 None。
///
/// ⚠️ 陷阱 1：Rust `"NaN".parse::<f64>()` / `"inf".parse::<f64>()` 会成功，
/// 必须在 parse 成功后再判 `is_finite()`（对齐 Go strconv.ParseFloat + IsNaN/IsInf）。
pub fn try_parse_numeric_string(s: &str) -> Option<f64> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    match trimmed.parse::<f64>() {
        Ok(v) if v.is_finite() => Some(v),
        _ => None,
    }
}

/// 数值有限性判定（抽出以便单测 NaN/Inf，因 serde_json::Number 无法持有非有限值）。
pub(crate) fn classify_number(key: &str, v: f64) -> ClassifiedField {
    if !v.is_finite() {
        return ClassifiedField::skip(key, "non-finite number");
    }
    ClassifiedField {
        kind: FieldKind::Float,
        key: key.to_string(),
        value: Number::from_f64(v).map(Value::Number),
        coerced: false,
        raw: String::new(),
        reason: String::new(),
    }
}

/// 把一个 (key, value) 分类成 InfluxDB 里应走的路径（严格按 2.3 的 7 层优先级）。
pub fn classify_field(key: &str, value: &Value) -> ClassifiedField {
    // 第 0 层：元字段黑名单最优先（不看 value 类型）
    if is_skip_field(key) {
        return ClassifiedField::skip(key, "meta field (skip list)");
    }

    match value {
        // 第 1 层：null
        Value::Null => ClassifiedField::skip(key, "null/undefined"),

        // 第 5 层：布尔
        Value::Bool(b) => ClassifiedField {
            kind: FieldKind::Boolean,
            key: key.to_string(),
            value: Some(Value::Bool(*b)),
            coerced: false,
            raw: String::new(),
            reason: String::new(),
        },

        // 第 3-4 层：数值
        Value::Number(n) => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            classify_number(key, f)
        }

        // 第 2 层（tag）+ 第 6 层（string / coerce）
        Value::String(s) => {
            // 第 2 层：TagFields + string
            if is_tag_field(key) {
                return ClassifiedField {
                    kind: FieldKind::Tag,
                    key: key.to_string(),
                    value: Some(Value::String(s.clone())),
                    coerced: false,
                    raw: String::new(),
                    reason: String::new(),
                };
            }
            // 第 6 层
            if is_numeric_hint(key) {
                if let Some(n) = try_parse_numeric_string(s) {
                    // 6a：强转 float
                    return ClassifiedField {
                        kind: FieldKind::Float,
                        key: key.to_string(),
                        value: Number::from_f64(n).map(Value::Number),
                        coerced: true,
                        raw: s.clone(),
                        reason: String::new(),
                    };
                }
                // 6b：白名单但无法解析
                return ClassifiedField {
                    kind: FieldKind::String,
                    key: key.to_string(),
                    value: Some(Value::String(s.clone())),
                    coerced: false,
                    raw: String::new(),
                    reason: "numeric-hint but not parseable".to_string(),
                };
            }
            // 6c：普通字符串
            ClassifiedField {
                kind: FieldKind::String,
                key: key.to_string(),
                value: Some(Value::String(s.clone())),
                coerced: false,
                raw: String::new(),
                reason: String::new(),
            }
        }

        // 第 7 层：对象 / 数组 / 其他
        Value::Array(_) | Value::Object(_) => ClassifiedField::skip(key, "unsupported type"),
    }
}

/// 对整份 payload 做分类，返回结果按 key 字典序排列（⚠️ 陷阱 3：Map 无序，必须显式排序）。
pub fn classify_payload(data: &Map<String, Value>) -> Vec<ClassifiedField> {
    let mut keys: Vec<&String> = data.keys().collect();
    keys.sort();
    keys.iter()
        .map(|k| classify_field(k, &data[*k]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn f(v: f64) -> Value {
        Value::Number(Number::from_f64(v).unwrap())
    }
    fn kind(r: &ClassifiedField) -> FieldKind {
        r.kind
    }
    fn as_f64(r: &ClassifiedField) -> f64 {
        r.value.as_ref().and_then(|v| v.as_f64()).unwrap()
    }
    fn as_str(r: &ClassifiedField) -> String {
        r.value.as_ref().and_then(|v| v.as_str()).unwrap().to_string()
    }
    fn as_bool(r: &ClassifiedField) -> bool {
        r.value.as_ref().and_then(|v| v.as_bool()).unwrap()
    }

    // ---------- SKIP_FIELDS 黑名单（10） ----------

    #[test]
    fn skip_fields_contains_all_dedup_id_fields() {
        for f in ["messageId", "msgId", "message_id", "msg_id", "uuid", "id"] {
            assert!(is_skip_field(f), "SKIP_FIELDS 应包含 dedup ID 字段 {f}");
        }
    }

    #[test]
    fn skip_fields_contains_timestamp_and_device_id() {
        assert!(is_skip_field("timestamp"));
        assert!(is_skip_field("deviceId"));
    }

    #[test]
    fn skip_fields_id_fields_always_skip() {
        for k in ["messageId", "msgId", "message_id", "msg_id", "uuid", "id"] {
            let s = classify_field(k, &json!("abc-123"));
            assert_eq!(FieldKind::Skip, s.kind, "key={k} 字符串值应 skip");
            assert!(s.reason.contains("meta field"));
            let n = classify_field(k, &f(42.0));
            assert_eq!(FieldKind::Skip, n.kind, "key={k} 数值应 skip");
            assert_eq!(FieldKind::Skip, classify_field(k, &Value::Null).kind);
        }
    }

    #[test]
    fn skip_fields_timestamp() {
        let r = classify_field("timestamp", &f(1758470400000.0));
        assert_eq!(FieldKind::Skip, r.kind);
        assert!(r.reason.contains("meta field"));
    }

    #[test]
    fn skip_fields_device_id() {
        let r = classify_field("deviceId", &json!("ESP32-7C2C6751DA00"));
        assert_eq!(FieldKind::Skip, r.kind);
    }

    #[test]
    fn skip_fields_priority_over_tag_fields() {
        let r = classify_field("id", &json!("living-room"));
        assert_eq!(FieldKind::Skip, r.kind);
    }

    #[test]
    fn skip_fields_priority_over_numeric_hints() {
        let r = classify_field("id", &json!("12345"));
        assert_eq!(FieldKind::Skip, r.kind);
    }

    #[test]
    fn skip_fields_non_blacklist_unaffected() {
        assert_eq!(FieldKind::Float, kind(&classify_field("voltage", &f(4.25))));
        assert_eq!(FieldKind::String, kind(&classify_field("status", &json!("ok"))));
        assert_eq!(FieldKind::Tag, kind(&classify_field("location", &json!("kitchen"))));
        assert_eq!(FieldKind::Boolean, kind(&classify_field("online", &json!(true))));
    }

    #[test]
    fn skip_fields_mixed_payload() {
        let data = json!({
            "messageId": "7C2C6751DA00-42",
            "timestamp": 1758470400000.0,
            "deviceId": "ESP32-7C2C6751DA00",
            "voltage": 4.25,
            "status": "ok",
            "location": "living-room",
        });
        let map = data.as_object().unwrap();
        let result = classify_payload(map);
        let mut kinds = std::collections::HashMap::new();
        for r in &result {
            kinds.insert(r.key.clone(), r.kind);
        }
        assert_eq!(FieldKind::Skip, kinds["messageId"]);
        assert_eq!(FieldKind::Skip, kinds["timestamp"]);
        assert_eq!(FieldKind::Skip, kinds["deviceId"]);
        assert_eq!(FieldKind::Float, kinds["voltage"]);
        assert_eq!(FieldKind::String, kinds["status"]);
        assert_eq!(FieldKind::Tag, kinds["location"]);
    }

    #[test]
    fn skip_fields_size() {
        assert!(SKIP_FIELDS.len() >= 8);
    }

    // ---------- try_parse_numeric_string（5） ----------

    #[test]
    fn try_parse_normal() {
        let cases = [("25.6", 25.6), ("-10", -10.0), ("0", 0.0), ("1e3", 1000.0)];
        for (inp, want) in cases {
            let got = try_parse_numeric_string(inp);
            assert!(got.is_some(), "in={inp} 应可解析");
            assert_eq!(want, got.unwrap());
        }
    }

    #[test]
    fn try_parse_trim() {
        assert_eq!(25.6, try_parse_numeric_string("  25.6  ").unwrap());
        assert_eq!(42.0, try_parse_numeric_string("\t42\n").unwrap());
    }

    #[test]
    fn try_parse_empty() {
        assert!(try_parse_numeric_string("").is_none());
        assert!(try_parse_numeric_string("   ").is_none());
    }

    #[test]
    fn try_parse_non_numeric() {
        for inp in ["ok", "1.2.3", "25.6abc"] {
            assert!(try_parse_numeric_string(inp).is_none(), "in={inp} 不应解析成功");
        }
    }

    #[test]
    fn try_parse_nan_infinity() {
        for inp in ["NaN", "Infinity", "-Infinity", "Inf", "+Inf"] {
            assert!(try_parse_numeric_string(inp).is_none(), "in={inp} 应被拦截（非有限数）");
        }
    }

    // ---------- classify_field nil/tag（5） ----------

    #[test]
    fn classify_field_nil() {
        let r = classify_field("temperature", &Value::Null);
        assert_eq!(FieldKind::Skip, r.kind);
        assert_eq!("null/undefined", r.reason);
    }

    #[test]
    fn classify_field_tag_location() {
        let r = classify_field("location", &json!("living-room"));
        assert_eq!(FieldKind::Tag, r.kind);
        assert_eq!("living-room", as_str(&r));
    }

    #[test]
    fn classify_field_tag_type() {
        let r = classify_field("type", &json!("dht22"));
        assert_eq!(FieldKind::Tag, r.kind);
        assert_eq!("dht22", as_str(&r));
    }

    #[test]
    fn classify_field_tag_numeric_falls_to_float() {
        let r = classify_field("location", &f(42.0));
        assert_eq!(FieldKind::Float, r.kind);
    }

    #[test]
    fn classify_field_tag_fields_content() {
        assert!(is_tag_field("location"));
        assert!(is_tag_field("type"));
        assert!(!is_tag_field("status"));
    }

    // ---------- classify_field 数值（6） ----------

    #[test]
    fn classify_field_float() {
        let r = classify_field("temperature", &f(25.6));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(25.6, as_f64(&r));
        assert!(!r.coerced);
    }

    #[test]
    fn classify_field_integer() {
        let r = classify_field("count", &json!(42));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(42.0, as_f64(&r));
    }

    #[test]
    fn classify_field_negative() {
        let r = classify_field("temperature", &f(-5.5));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(-5.5, as_f64(&r));
    }

    #[test]
    fn classify_field_zero() {
        let r = classify_field("temperature", &json!(0));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(0.0, as_f64(&r));
    }

    #[test]
    fn classify_field_nan() {
        // serde_json::Number 无法持有 NaN，直接测内部数值判定路径
        let r = classify_number("temperature", f64::NAN);
        assert_eq!(FieldKind::Skip, r.kind);
        assert_eq!("non-finite number", r.reason);
    }

    #[test]
    fn classify_field_infinity() {
        let r = classify_number("temperature", f64::INFINITY);
        assert_eq!(FieldKind::Skip, r.kind);
    }

    // ---------- classify_field 布尔/字符串（10） ----------

    #[test]
    fn classify_field_bool() {
        let rt = classify_field("online", &json!(true));
        assert_eq!(FieldKind::Boolean, rt.kind);
        assert!(as_bool(&rt));
        let rf = classify_field("online", &json!(false));
        assert_eq!(FieldKind::Boolean, rf.kind);
        assert!(!as_bool(&rf));
    }

    #[test]
    fn classify_field_string_non_hint() {
        let r = classify_field("status", &json!("ok"));
        assert_eq!(FieldKind::String, r.kind);
        assert_eq!("ok", as_str(&r));
        assert!(!r.coerced);
    }

    #[test]
    fn classify_field_string_version_like() {
        let r = classify_field("firmware", &json!("1.2.3"));
        assert_eq!(FieldKind::String, r.kind);
        assert_eq!("1.2.3", as_str(&r));
    }

    #[test]
    fn classify_field_string_numeric_but_not_hint() {
        let r = classify_field("someRandomField", &json!("25.6"));
        assert_eq!(FieldKind::String, r.kind);
        assert_eq!("25.6", as_str(&r));
    }

    #[test]
    fn classify_field_coerce_temperature() {
        let r = classify_field("temperature", &json!("25.6"));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(25.6, as_f64(&r));
        assert!(r.coerced);
        assert_eq!("25.6", r.raw);
    }

    #[test]
    fn classify_field_coerce_with_whitespace() {
        let r = classify_field("humidity", &json!(" 60.2 "));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(60.2, as_f64(&r));
        assert!(r.coerced);
    }

    #[test]
    fn classify_field_coerce_battery() {
        let r = classify_field("battery", &json!("3.7"));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(3.7, as_f64(&r));
        assert!(r.coerced);
    }

    #[test]
    fn classify_field_coerce_negative() {
        let r = classify_field("rssi", &json!("-65"));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(-65.0, as_f64(&r));
    }

    #[test]
    fn classify_field_coerce_integer_string() {
        let r = classify_field("pm25", &json!("35"));
        assert_eq!(FieldKind::Float, r.kind);
        assert_eq!(35.0, as_f64(&r));
    }

    #[test]
    fn classify_field_hint_but_not_parseable() {
        let r = classify_field("temperature", &json!("error"));
        assert_eq!(FieldKind::String, r.kind);
        assert_eq!("error", as_str(&r));
        assert_eq!("numeric-hint but not parseable", r.reason);
    }

    // ---------- classify_field 白名单内容/复杂类型（4） ----------

    #[test]
    fn classify_field_hint_empty_string() {
        let r = classify_field("temperature", &json!(""));
        assert_eq!(FieldKind::String, r.kind);
        assert_eq!("numeric-hint but not parseable", r.reason);
    }

    #[test]
    fn classify_field_numeric_hints_content() {
        for f in ["temperature", "humidity", "pressure", "battery", "rssi", "co2", "pm25"] {
            assert!(is_numeric_hint(f), "{f} 应在数值白名单");
        }
        for f in ["status", "firmware", "name", "messageId"] {
            assert!(!is_numeric_hint(f), "{f} 不应在数值白名单");
        }
    }

    #[test]
    fn classify_field_object() {
        let r = classify_field("meta", &json!({"a": 1}));
        assert_eq!(FieldKind::Skip, r.kind);
        assert!(r.reason.contains("unsupported type"));
    }

    #[test]
    fn classify_field_array() {
        let r = classify_field("list", &json!([1, 2, 3]));
        assert_eq!(FieldKind::Skip, r.kind);
    }

    // ---------- classify_payload（3） ----------

    #[test]
    fn classify_payload_full() {
        let data = json!({
            "temperature": 25.6,
            "humidity": "60.2",
            "online": true,
            "status": "ok",
            "location": "living-room",
            "type": "dht22",
            "meta": {"nested": true},
            "timestamp": 1758470400000.0,
            "messageId": "abc-123",
        });
        let results = classify_payload(data.as_object().unwrap());
        let mut by_key = std::collections::HashMap::new();
        for r in results {
            by_key.insert(r.key.clone(), r);
        }
        assert!(by_key.contains_key("temperature"));
        assert_eq!(FieldKind::Float, by_key["temperature"].kind);
        assert!(!by_key["temperature"].coerced);

        assert_eq!(FieldKind::Float, by_key["humidity"].kind);
        assert!(by_key["humidity"].coerced);
        assert_eq!(60.2, as_f64(&by_key["humidity"]));

        assert_eq!(FieldKind::Boolean, by_key["online"].kind);
        assert_eq!(FieldKind::String, by_key["status"].kind);
        assert_eq!(FieldKind::Tag, by_key["location"].kind);
        assert_eq!(FieldKind::Tag, by_key["type"].kind);
        assert_eq!(FieldKind::Skip, by_key["meta"].kind);
        assert_eq!(FieldKind::Skip, by_key["timestamp"].kind);
        assert!(by_key["timestamp"].reason.contains("meta field"));
        assert_eq!(FieldKind::Skip, by_key["messageId"].kind);
        assert!(by_key["messageId"].reason.contains("meta field"));
    }

    #[test]
    fn classify_payload_empty() {
        let data = json!({});
        assert!(classify_payload(data.as_object().unwrap()).is_empty());
    }

    #[test]
    fn classify_payload_sorted_order() {
        let data = json!({"a": 1, "b": 2, "c": 3});
        let results = classify_payload(data.as_object().unwrap());
        let keys: Vec<String> = results.iter().map(|r| r.key.clone()).collect();
        assert_eq!(vec!["a", "b", "c"], keys);
    }
}
