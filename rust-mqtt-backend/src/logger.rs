//! 结构化日志初始化（对齐 go-mqtt-backend/internal/logger 的 zap JSON）。
//!
//! ⚠️ 全局 subscriber 只能设一次；main 里最先调用 init(&cfg.log_level)。

use tracing_subscriber::EnvFilter;

/// 按日志级别初始化全局 tracing subscriber（JSON 格式，输出 stdout）。
///
/// level ∈ {debug,info,warn,error,fatal}（fatal 映射到 error，tracing 无 fatal 级）。
pub fn init(level: &str) {
    let filter = match level {
        "debug" => "debug",
        "warn" => "warn",
        "error" | "fatal" => "error",
        _ => "info",
    };

    let _ = tracing_subscriber::fmt()
        .json()
        .with_target(false)
        .flatten_event(true)
        .with_current_span(false)
        .with_span_list(false)
        .with_env_filter(EnvFilter::new(filter))
        .try_init();
}

/// 刷新日志缓冲（tracing fmt 无显式缓冲，此函数为对齐 Go logger.Sync() 而保留）。
pub fn sync() {
    // tracing-subscriber 的 fmt 层直接写 stdout，无需手动 flush。
}
