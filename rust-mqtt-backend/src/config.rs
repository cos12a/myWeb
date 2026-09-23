//! 环境变量配置加载与校验（对齐 go-mqtt-backend/internal/config）。
//!
//! 密钥只从环境变量 / .env 读取，绝不硬编码（见 HANDOFF.md 0 节硬性要求）。

use serde_json::{json, Value};

/// 应用全量配置。
#[derive(Debug, Clone)]
pub struct Config {
    // MQTT
    pub mqtt_url: String,
    pub mqtt_user: String,
    pub mqtt_pass: String,
    pub mqtt_client_id: String,
    pub mqtt_subscribe_topic: String,
    // InfluxDB
    pub influx_url: String,
    pub influx_token: String,
    pub influx_org: String,
    pub influx_bucket: String,
    // 运行时
    pub log_level: String,
    pub health_port: u16,
    // 去重
    pub dedup_enabled: bool,
    pub dedup_max_size: usize,
    pub dedup_ttl_ms: u64,
}

impl Config {
    /// 从环境变量加载并校验；返回所有错误（不是只第一个）。
    pub fn load() -> Result<Self, Vec<String>> {
        let mut errs: Vec<String> = Vec::new();

        let mqtt_url = get_env("MQTT_URL", "");
        let mqtt_user = get_env("MQTT_USER", "");
        let mqtt_pass = get_env("MQTT_PASS", "");
        let mqtt_client_id = get_env("MQTT_CLIENT_ID", "rust-mqtt-consumer");
        let mqtt_subscribe_topic = get_env("MQTT_SUBSCRIBE_TOPIC", "sensors/#");

        let influx_url = get_env("INFLUX_URL", "");
        let influx_token = get_env("INFLUX_TOKEN", "");
        let influx_org = get_env("INFLUX_ORG", "");
        let influx_bucket = get_env("INFLUX_BUCKET", "");

        let log_level = get_env("LOG_LEVEL", "info").to_lowercase();
        let health_port_i = get_env_int("HEALTH_PORT", 9004i64);
        let dedup_enabled = get_env_bool("DEDUP_ENABLED", true);
        let dedup_max_size_i = get_env_int("DEDUP_MAX_SIZE", 10000i64);
        let dedup_ttl_ms_i = get_env_int("DEDUP_TTL_MS", 300000i64);

        // 必填校验（trim 后为空）
        let required: [(&str, &str); 7] = [
            ("MQTT_URL", &mqtt_url),
            ("MQTT_USER", &mqtt_user),
            ("MQTT_PASS", &mqtt_pass),
            ("INFLUX_URL", &influx_url),
            ("INFLUX_TOKEN", &influx_token),
            ("INFLUX_ORG", &influx_org),
            ("INFLUX_BUCKET", &influx_bucket),
        ];
        for (name, val) in required {
            if val.trim().is_empty() {
                errs.push(format!("{name}: 不能为空"));
            }
        }

        // 范围校验
        if !(1..=65535).contains(&health_port_i) {
            errs.push(format!(
                "HEALTH_PORT: 必须在 1~65535 之间，当前 {health_port_i}"
            ));
        }
        if !(100..=1000000).contains(&dedup_max_size_i) {
            errs.push(format!(
                "DEDUP_MAX_SIZE: 必须在 100~1000000 之间，当前 {dedup_max_size_i}"
            ));
        }
        if !(1000..=3600000).contains(&dedup_ttl_ms_i) {
            errs.push(format!(
                "DEDUP_TTL_MS: 必须在 1000~3600000 之间，当前 {dedup_ttl_ms_i}"
            ));
        }

        // 日志级别校验
        if !matches!(log_level.as_str(), "debug" | "info" | "warn" | "error" | "fatal") {
            errs.push(format!(
                "LOG_LEVEL: 无效值 \"{log_level}\"，可选 debug/info/warn/error/fatal"
            ));
        }

        if !errs.is_empty() {
            return Err(errs);
        }

        Ok(Config {
            mqtt_url,
            mqtt_user,
            mqtt_pass,
            mqtt_client_id,
            mqtt_subscribe_topic,
            influx_url,
            influx_token,
            influx_org,
            influx_bucket,
            log_level,
            // 已通过范围校验，安全转换
            health_port: health_port_i as u16,
            dedup_enabled,
            dedup_max_size: dedup_max_size_i as usize,
            dedup_ttl_ms: dedup_ttl_ms_i as u64,
        })
    }

    /// 脱敏快照（不含 password / token），用于启动日志。结构对齐 Go config.Snapshot()。
    pub fn snapshot(&self) -> Value {
        json!({
            "mqtt": {
                "url": self.mqtt_url,
                "username": self.mqtt_user,
                "clientId": self.mqtt_client_id,
                "subscribeTopic": self.mqtt_subscribe_topic,
                "qos": 1,
            },
            "influx": {
                "url": self.influx_url,
                "org": self.influx_org,
                "bucket": self.influx_bucket,
            },
            "log": { "level": self.log_level },
            "health": { "port": self.health_port },
            "dedup": {
                "enabled": self.dedup_enabled,
                "maxSize": self.dedup_max_size,
                "ttlMs": self.dedup_ttl_ms,
            },
        })
    }
}

/// 读环境变量；空字符串或未设置时用 fallback（对齐 Go getEnv）。
fn get_env(key: &str, fallback: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => fallback.to_string(),
    }
}

/// 读整数环境变量；未设置或解析失败时静默用 fallback（对齐 Go getEnvInt）。
fn get_env_int(key: &str, fallback: i64) -> i64 {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v.trim().parse::<i64>().unwrap_or(fallback),
        _ => fallback,
    }
}

/// 读 bool 环境变量；接受 1/t/T/TRUE/true/True 与 0/f/F/FALSE/false/False，
/// 其他值用 fallback（对齐 Go strconv.ParseBool）。
fn get_env_bool(key: &str, fallback: bool) -> bool {
    let v = match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => return fallback,
    };
    match v.as_str() {
        "1" | "t" | "T" | "TRUE" | "true" | "True" => true,
        "0" | "f" | "F" | "FALSE" | "false" | "False" => false,
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_bool_parsing_variants() {
        for v in ["1", "t", "T", "TRUE", "true", "True"] {
            std::env::set_var("__T_BOOL", v);
            assert!(get_env_bool("__T_BOOL", false), "{v} 应为 true");
        }
        for v in ["0", "f", "F", "FALSE", "false", "False"] {
            std::env::set_var("__T_BOOL", v);
            assert!(!get_env_bool("__T_BOOL", true), "{v} 应为 false");
        }
        std::env::set_var("__T_BOOL", "garbage");
        assert!(get_env_bool("__T_BOOL", true), "非法值应回退默认 true");
        std::env::remove_var("__T_BOOL");
    }

    #[test]
    fn env_int_silent_fallback() {
        std::env::set_var("__T_INT", "not-a-number");
        assert_eq!(9004, get_env_int("__T_INT", 9004));
        std::env::set_var("__T_INT", "8080");
        assert_eq!(8080, get_env_int("__T_INT", 9004));
        std::env::remove_var("__T_INT");
    }

    #[test]
    fn snapshot_excludes_secrets() {
        let cfg = Config {
            mqtt_url: "mqtt://127.0.0.1:1883".into(),
            mqtt_user: "user".into(),
            mqtt_pass: "SUPER-SECRET-PASS".into(),
            mqtt_client_id: "rust-mqtt-consumer".into(),
            mqtt_subscribe_topic: "sensors/#".into(),
            influx_url: "http://127.0.0.1:8086".into(),
            influx_token: "SUPER-SECRET-TOKEN".into(),
            influx_org: "org".into(),
            influx_bucket: "bucket".into(),
            log_level: "info".into(),
            health_port: 9004,
            dedup_enabled: true,
            dedup_max_size: 10000,
            dedup_ttl_ms: 300000,
        };
        let snap = cfg.snapshot().to_string();
        // 密钥绝不出现在快照里
        assert!(!snap.contains("SUPER-SECRET-PASS"));
        assert!(!snap.contains("SUPER-SECRET-TOKEN"));
        // 非敏感字段应存在
        assert!(snap.contains("rust-mqtt-consumer"));
        assert!(snap.contains("9004"));
    }
}
