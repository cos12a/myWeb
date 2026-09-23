// Package timestamp 提供智能时间戳单位识别与纳秒归一化。
// 对应 bun-mqtt-backend/src/utils/timestamp.ts。
package timestamp

import (
	"math"
	"time"
)

// Unit 时间戳单位
type Unit string

const (
	UnitSecond      Unit = "s"
	UnitMillisecond Unit = "ms"
	UnitMicrosecond Unit = "us"
	UnitNanosecond  Unit = "ns"
	UnitInvalid     Unit = "invalid"
)

// NormalizeResult 归一化结果
type NormalizeResult struct {
	Nanos        int64
	Unit         Unit
	UsedFallback bool
}

// DetectUnit 根据数量级判定时间戳单位。
// 阈值：< 1e11 → 秒；< 1e14 → 毫秒；< 1e17 → 微秒；>= 1e17 → 纳秒。
func DetectUnit(ts float64) Unit {
	if math.IsNaN(ts) || math.IsInf(ts, 0) || ts <= 0 {
		return UnitInvalid
	}
	if ts < 1e11 {
		return UnitSecond
	}
	if ts < 1e14 {
		return UnitMillisecond
	}
	if ts < 1e17 {
		return UnitMicrosecond
	}
	return UnitNanosecond
}

// NormalizeToNanoseconds 将任意单位的时间戳归一化为纳秒。
// 如果 ts 为 nil 或无效，使用当前时间作为 fallback。
func NormalizeToNanoseconds(ts *float64) NormalizeResult {
	fallbackNanos := time.Now().UnixNano()

	if ts == nil {
		return NormalizeResult{Nanos: fallbackNanos, Unit: UnitInvalid, UsedFallback: true}
	}

	unit := DetectUnit(*ts)
	if unit == UnitInvalid {
		return NormalizeResult{Nanos: fallbackNanos, Unit: UnitInvalid, UsedFallback: true}
	}

	var nanos int64
	switch unit {
	case UnitSecond:
		nanos = int64(*ts) * 1_000_000_000
	case UnitMillisecond:
		nanos = int64(*ts) * 1_000_000
	case UnitMicrosecond:
		nanos = int64(*ts) * 1_000
	case UnitNanosecond:
		nanos = int64(*ts)
	}

	return NormalizeResult{Nanos: nanos, Unit: unit, UsedFallback: false}
}
