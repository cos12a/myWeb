//! 智能时间戳单位识别与纳秒归一化（对齐 go-mqtt-backend/internal/timestamp）。
//!
//! 阈值与倍率见 HANDOFF.md 第 2.6 节。

use std::time::{SystemTime, UNIX_EPOCH};

/// 时间戳单位（对齐 2.6）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Second,
    Millisecond,
    Microsecond,
    Nanosecond,
    Invalid,
}

impl Unit {
    pub fn as_str(&self) -> &'static str {
        match self {
            Unit::Second => "s",
            Unit::Millisecond => "ms",
            Unit::Microsecond => "us",
            Unit::Nanosecond => "ns",
            Unit::Invalid => "invalid",
        }
    }
}

/// 归一化结果（对齐 Go NormalizeResult）。
#[derive(Debug, Clone)]
pub struct NormalizeResult {
    pub nanos: i64,
    pub unit: Unit,
    pub used_fallback: bool,
}

/// 当前系统时间纳秒（⚠️ 陷阱 5：as_nanos 是 u128，2262 年前转 i64 不溢出）。
fn now_nanos() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0)
}

/// 根据数量级判定时间戳单位：<1e11 秒；<1e14 毫秒；<1e17 微秒；>=1e17 纳秒。
pub fn detect_unit(ts: f64) -> Unit {
    if ts.is_nan() || ts.is_infinite() || ts <= 0.0 {
        return Unit::Invalid;
    }
    if ts < 1e11 {
        Unit::Second
    } else if ts < 1e14 {
        Unit::Millisecond
    } else if ts < 1e17 {
        Unit::Microsecond
    } else {
        Unit::Nanosecond
    }
}

/// 将任意单位的时间戳归一化为纳秒；None 或无效则用当前时间兜底。
pub fn normalize_to_nanos(ts: Option<f64>) -> NormalizeResult {
    let fallback_nanos = now_nanos();

    let ts = match ts {
        Some(v) => v,
        None => {
            return NormalizeResult {
                nanos: fallback_nanos,
                unit: Unit::Invalid,
                used_fallback: true,
            }
        }
    };

    let unit = detect_unit(ts);
    if unit == Unit::Invalid {
        return NormalizeResult {
            nanos: fallback_nanos,
            unit: Unit::Invalid,
            used_fallback: true,
        };
    }

    // ⚠️ 陷阱：先 `ts as i64` 再乘整数倍率，避免 f64 精度丢失。
    let nanos = match unit {
        Unit::Second => (ts as i64) * 1_000_000_000,
        Unit::Millisecond => (ts as i64) * 1_000_000,
        Unit::Microsecond => (ts as i64) * 1_000,
        Unit::Nanosecond => ts as i64,
        Unit::Invalid => unreachable!(),
    };

    NormalizeResult {
        nanos,
        unit,
        used_fallback: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(v: f64) -> Option<f64> {
        Some(v)
    }

    // ---------- detect_unit（5） ----------

    #[test]
    fn detect_unit_second() {
        assert_eq!(Unit::Second, detect_unit(1_758_470_400.0));
        assert_eq!(Unit::Second, detect_unit(1.0));
        assert_eq!(Unit::Second, detect_unit(9.9e10));
    }

    #[test]
    fn detect_unit_millisecond() {
        assert_eq!(Unit::Millisecond, detect_unit(1_758_470_400_000.0));
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64;
        assert_eq!(Unit::Millisecond, detect_unit(now_ms));
        assert_eq!(Unit::Millisecond, detect_unit(1e11));
    }

    #[test]
    fn detect_unit_microsecond() {
        assert_eq!(Unit::Microsecond, detect_unit(1_758_470_400_000_000.0));
        assert_eq!(Unit::Microsecond, detect_unit(1e14));
    }

    #[test]
    fn detect_unit_nanosecond() {
        assert_eq!(Unit::Nanosecond, detect_unit(1_758_470_400_000_000_000.0));
        assert_eq!(Unit::Nanosecond, detect_unit(1e17));
    }

    #[test]
    fn detect_unit_invalid() {
        assert_eq!(Unit::Invalid, detect_unit(0.0));
        assert_eq!(Unit::Invalid, detect_unit(-1.0));
        assert_eq!(Unit::Invalid, detect_unit(f64::NAN));
        assert_eq!(Unit::Invalid, detect_unit(f64::INFINITY));
    }

    // ---------- normalize_to_nanos（7） ----------

    #[test]
    fn normalize_second() {
        let r = normalize_to_nanos(fp(1_758_470_400.0));
        assert_eq!(Unit::Second, r.unit);
        assert!(!r.used_fallback);
        assert_eq!(1_758_470_400_000_000_000i64, r.nanos);
    }

    #[test]
    fn normalize_millisecond() {
        let r = normalize_to_nanos(fp(1_758_470_400_000.0));
        assert_eq!(Unit::Millisecond, r.unit);
        assert_eq!(1_758_470_400_000_000_000i64, r.nanos);
    }

    #[test]
    fn normalize_microsecond() {
        let r = normalize_to_nanos(fp(1_758_470_400_000_000.0));
        assert_eq!(Unit::Microsecond, r.unit);
        assert_eq!(1_758_470_400_000_000_000i64, r.nanos);
    }

    #[test]
    fn normalize_nanosecond() {
        let r = normalize_to_nanos(fp(1_758_470_400_000_000_000.0));
        assert_eq!(Unit::Nanosecond, r.unit);
        assert_eq!(1_758_470_400_000_000_000i64, r.nanos);
    }

    #[test]
    fn normalize_nil_fallback() {
        let before = now_nanos();
        let r = normalize_to_nanos(None);
        let after = now_nanos();
        assert!(r.used_fallback);
        assert_eq!(Unit::Invalid, r.unit);
        assert!(r.nanos >= before);
        assert!(r.nanos <= after);
    }

    #[test]
    fn normalize_negative_fallback() {
        let r = normalize_to_nanos(fp(-100.0));
        assert!(r.used_fallback);
    }

    #[test]
    fn normalize_all_units_equal() {
        let seconds = 1_758_470_400.0f64;
        let expected = 1_758_470_400_000_000_000i64;
        assert_eq!(expected, normalize_to_nanos(fp(seconds)).nanos);
        assert_eq!(expected, normalize_to_nanos(fp(seconds * 1e3)).nanos);
        assert_eq!(expected, normalize_to_nanos(fp(seconds * 1e6)).nanos);
        assert_eq!(expected, normalize_to_nanos(fp(seconds * 1e9)).nanos);
    }
}
