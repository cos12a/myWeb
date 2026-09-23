package timestamp

import (
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fp(v float64) *float64 { return &v }

// ---------- DetectUnit ----------

func TestDetectUnit_Second(t *testing.T) {
	assert.Equal(t, UnitSecond, DetectUnit(1_758_470_400))
	assert.Equal(t, UnitSecond, DetectUnit(1))
	assert.Equal(t, UnitSecond, DetectUnit(9.9e10))
}

func TestDetectUnit_Millisecond(t *testing.T) {
	assert.Equal(t, UnitMillisecond, DetectUnit(1_758_470_400_000))
	assert.Equal(t, UnitMillisecond, DetectUnit(float64(time.Now().UnixMilli())))
	assert.Equal(t, UnitMillisecond, DetectUnit(1e11))
}

func TestDetectUnit_Microsecond(t *testing.T) {
	assert.Equal(t, UnitMicrosecond, DetectUnit(1_758_470_400_000_000))
	assert.Equal(t, UnitMicrosecond, DetectUnit(1e14))
}

func TestDetectUnit_Nanosecond(t *testing.T) {
	assert.Equal(t, UnitNanosecond, DetectUnit(1_758_470_400_000_000_000))
	assert.Equal(t, UnitNanosecond, DetectUnit(1e17))
}

func TestDetectUnit_Invalid(t *testing.T) {
	assert.Equal(t, UnitInvalid, DetectUnit(0))
	assert.Equal(t, UnitInvalid, DetectUnit(-1))
	assert.Equal(t, UnitInvalid, DetectUnit(math.NaN()))
	assert.Equal(t, UnitInvalid, DetectUnit(math.Inf(1)))
}

// ---------- NormalizeToNanoseconds ----------

func TestNormalize_Second(t *testing.T) {
	r := NormalizeToNanoseconds(fp(1_758_470_400))
	assert.Equal(t, UnitSecond, r.Unit)
	assert.False(t, r.UsedFallback)
	assert.Equal(t, int64(1_758_470_400_000_000_000), r.Nanos)
}

func TestNormalize_Millisecond(t *testing.T) {
	r := NormalizeToNanoseconds(fp(1_758_470_400_000))
	assert.Equal(t, UnitMillisecond, r.Unit)
	assert.Equal(t, int64(1_758_470_400_000_000_000), r.Nanos)
}

func TestNormalize_Microsecond(t *testing.T) {
	r := NormalizeToNanoseconds(fp(1_758_470_400_000_000))
	assert.Equal(t, UnitMicrosecond, r.Unit)
	assert.Equal(t, int64(1_758_470_400_000_000_000), r.Nanos)
}

func TestNormalize_Nanosecond(t *testing.T) {
	r := NormalizeToNanoseconds(fp(1_758_470_400_000_000_000))
	assert.Equal(t, UnitNanosecond, r.Unit)
	assert.Equal(t, int64(1_758_470_400_000_000_000), r.Nanos)
}

func TestNormalize_NilFallback(t *testing.T) {
	before := time.Now().UnixNano()
	r := NormalizeToNanoseconds(nil)
	after := time.Now().UnixNano()
	require.True(t, r.UsedFallback)
	assert.Equal(t, UnitInvalid, r.Unit)
	assert.GreaterOrEqual(t, r.Nanos, before)
	assert.LessOrEqual(t, r.Nanos, after)
}

func TestNormalize_NegativeFallback(t *testing.T) {
	r := NormalizeToNanoseconds(fp(-100))
	assert.True(t, r.UsedFallback)
}

func TestNormalize_AllUnitsEqual(t *testing.T) {
	seconds := 1_758_470_400.0
	expected := int64(1_758_470_400_000_000_000)
	assert.Equal(t, expected, NormalizeToNanoseconds(fp(seconds)).Nanos)
	assert.Equal(t, expected, NormalizeToNanoseconds(fp(seconds*1e3)).Nanos)
	assert.Equal(t, expected, NormalizeToNanoseconds(fp(seconds*1e6)).Nanos)
	assert.Equal(t, expected, NormalizeToNanoseconds(fp(seconds*1e9)).Nanos)
}
