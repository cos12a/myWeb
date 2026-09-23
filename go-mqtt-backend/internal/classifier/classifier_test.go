package classifier

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------- SKIP_FIELDS 元字段黑名单（v2.1） ----------

func TestSkipFields_ContainsAllDedupIDFields(t *testing.T) {
	for _, f := range DedupIDFields {
		assert.True(t, SkipFields[f], "SkipFields 应包含 dedup ID 字段 %q", f)
	}
}

func TestSkipFields_ContainsTimestampAndDeviceID(t *testing.T) {
	assert.True(t, SkipFields["timestamp"])
	assert.True(t, SkipFields["deviceId"])
}

func TestSkipFields_IDFieldsAlwaysSkip(t *testing.T) {
	keys := []string{"messageId", "msgId", "message_id", "msg_id", "uuid", "id"}
	for _, k := range keys {
		// 字符串值
		s := ClassifyField(k, "abc-123")
		assert.Equal(t, KindSkip, s.Kind, "key=%q 字符串值应 skip", k)
		assert.Contains(t, s.Reason, "meta field")
		// 数值（如递增序号）
		n := ClassifyField(k, float64(42))
		assert.Equal(t, KindSkip, n.Kind, "key=%q 数值应 skip", k)
		// nil 也归为 skip
		assert.Equal(t, KindSkip, ClassifyField(k, nil).Kind)
	}
}

func TestSkipFields_Timestamp(t *testing.T) {
	r := ClassifyField("timestamp", float64(1758470400000))
	assert.Equal(t, KindSkip, r.Kind)
	assert.Contains(t, r.Reason, "meta field")
}

func TestSkipFields_DeviceID(t *testing.T) {
	r := ClassifyField("deviceId", "ESP32-7C2C6751DA00")
	assert.Equal(t, KindSkip, r.Kind)
}

func TestSkipFields_PriorityOverTagFields(t *testing.T) {
	// 即使 id 值像 tag，黑名单仍优先
	r := ClassifyField("id", "living-room")
	assert.Equal(t, KindSkip, r.Kind)
}

func TestSkipFields_PriorityOverNumericHints(t *testing.T) {
	// id 是数值字符串，但命中黑名单，仍应 skip（不强转入库）
	r := ClassifyField("id", "12345")
	assert.Equal(t, KindSkip, r.Kind)
}

func TestSkipFields_NonBlacklistUnaffected(t *testing.T) {
	assert.Equal(t, KindFloat, ClassifyField("voltage", 4.25).Kind)
	assert.Equal(t, KindString, ClassifyField("status", "ok").Kind)
	assert.Equal(t, KindTag, ClassifyField("location", "kitchen").Kind)
	assert.Equal(t, KindBoolean, ClassifyField("online", true).Kind)
}

func TestSkipFields_MixedPayload(t *testing.T) {
	result := ClassifyPayload(map[string]any{
		"messageId": "7C2C6751DA00-42",
		"timestamp": float64(1758470400000),
		"deviceId":  "ESP32-7C2C6751DA00",
		"voltage":   4.25,
		"status":    "ok",
		"location":  "living-room",
	})
	kinds := map[string]FieldKind{}
	for _, r := range result {
		kinds[r.Key] = r.Kind
	}
	assert.Equal(t, KindSkip, kinds["messageId"])
	assert.Equal(t, KindSkip, kinds["timestamp"])
	assert.Equal(t, KindSkip, kinds["deviceId"])
	assert.Equal(t, KindFloat, kinds["voltage"])
	assert.Equal(t, KindString, kinds["status"])
	assert.Equal(t, KindTag, kinds["location"])
}

func TestSkipFields_Size(t *testing.T) {
	// 6 个 ID + timestamp + deviceId
	assert.GreaterOrEqual(t, len(SkipFields), 8)
}

// ---------- TryParseNumericString ----------

func TestTryParseNumericString_Normal(t *testing.T) {
	cases := map[string]float64{
		"25.6": 25.6,
		"-10":  -10,
		"0":    0,
		"1e3":  1000,
	}
	for in, want := range cases {
		got, ok := TryParseNumericString(in)
		require.True(t, ok, "in=%q 应可解析", in)
		assert.Equal(t, want, got)
	}
}

func TestTryParseNumericString_Trim(t *testing.T) {
	got, ok := TryParseNumericString("  25.6  ")
	require.True(t, ok)
	assert.Equal(t, 25.6, got)

	got, ok = TryParseNumericString("\t42\n")
	require.True(t, ok)
	assert.Equal(t, float64(42), got)
}

func TestTryParseNumericString_Empty(t *testing.T) {
	_, ok := TryParseNumericString("")
	assert.False(t, ok)
	_, ok = TryParseNumericString("   ")
	assert.False(t, ok)
}

func TestTryParseNumericString_NonNumeric(t *testing.T) {
	for _, in := range []string{"ok", "1.2.3", "25.6abc"} {
		_, ok := TryParseNumericString(in)
		assert.False(t, ok, "in=%q 不应解析成功", in)
	}
}

func TestTryParseNumericString_NaNInfinity(t *testing.T) {
	for _, in := range []string{"NaN", "Infinity", "-Infinity", "Inf", "+Inf"} {
		_, ok := TryParseNumericString(in)
		assert.False(t, ok, "in=%q 应被拦截（非有限数）", in)
	}
}

// ---------- classifyField: nil ----------

func TestClassifyField_Nil(t *testing.T) {
	r := ClassifyField("temperature", nil)
	assert.Equal(t, KindSkip, r.Kind)
	assert.Equal(t, "null/undefined", r.Reason)
}

// ---------- classifyField: Tag ----------

func TestClassifyField_Tag_Location(t *testing.T) {
	r := ClassifyField("location", "living-room")
	assert.Equal(t, KindTag, r.Kind)
	assert.Equal(t, "living-room", r.Value)
}

func TestClassifyField_Tag_Type(t *testing.T) {
	r := ClassifyField("type", "dht22")
	assert.Equal(t, KindTag, r.Kind)
	assert.Equal(t, "dht22", r.Value)
}

func TestClassifyField_Tag_NumericFallsToFloat(t *testing.T) {
	r := ClassifyField("location", float64(42))
	assert.Equal(t, KindFloat, r.Kind)
}

func TestClassifyField_TagFieldsContent(t *testing.T) {
	assert.True(t, TagFields["location"])
	assert.True(t, TagFields["type"])
	assert.False(t, TagFields["status"])
}

// ---------- classifyField: 数值 ----------

func TestClassifyField_Float(t *testing.T) {
	r := ClassifyField("temperature", 25.6)
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, 25.6, r.Value)
	assert.False(t, r.Coerced)
}

func TestClassifyField_Integer(t *testing.T) {
	r := ClassifyField("count", float64(42))
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, float64(42), r.Value)
}

func TestClassifyField_Negative(t *testing.T) {
	r := ClassifyField("temperature", -5.5)
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, -5.5, r.Value)
}

func TestClassifyField_Zero(t *testing.T) {
	r := ClassifyField("temperature", float64(0))
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, float64(0), r.Value)
}

func TestClassifyField_NaN(t *testing.T) {
	r := ClassifyField("temperature", math.NaN())
	assert.Equal(t, KindSkip, r.Kind)
	assert.Equal(t, "non-finite number", r.Reason)
}

func TestClassifyField_Infinity(t *testing.T) {
	r := ClassifyField("temperature", math.Inf(1))
	assert.Equal(t, KindSkip, r.Kind)
}

// ---------- classifyField: 布尔 ----------

func TestClassifyField_Bool(t *testing.T) {
	rt := ClassifyField("online", true)
	assert.Equal(t, KindBoolean, rt.Kind)
	assert.Equal(t, true, rt.Value)

	rf := ClassifyField("online", false)
	assert.Equal(t, KindBoolean, rf.Kind)
	assert.Equal(t, false, rf.Value)
}

// ---------- classifyField: 字符串（非白名单） ----------

func TestClassifyField_String_NonHint(t *testing.T) {
	r := ClassifyField("status", "ok")
	assert.Equal(t, KindString, r.Kind)
	assert.Equal(t, "ok", r.Value)
	assert.False(t, r.Coerced)
}

func TestClassifyField_String_VersionLike(t *testing.T) {
	r := ClassifyField("firmware", "1.2.3")
	assert.Equal(t, KindString, r.Kind)
	assert.Equal(t, "1.2.3", r.Value)
}

func TestClassifyField_String_NumericButNotHint(t *testing.T) {
	r := ClassifyField("someRandomField", "25.6")
	assert.Equal(t, KindString, r.Kind)
	assert.Equal(t, "25.6", r.Value)
}

// ---------- classifyField: 字符串（白名单自动强转） ----------

func TestClassifyField_Coerce_Temperature(t *testing.T) {
	r := ClassifyField("temperature", "25.6")
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, 25.6, r.Value)
	assert.True(t, r.Coerced)
	assert.Equal(t, "25.6", r.Raw)
}

func TestClassifyField_Coerce_WithWhitespace(t *testing.T) {
	r := ClassifyField("humidity", " 60.2 ")
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, 60.2, r.Value)
	assert.True(t, r.Coerced)
}

func TestClassifyField_Coerce_Battery(t *testing.T) {
	r := ClassifyField("battery", "3.7")
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, 3.7, r.Value)
	assert.True(t, r.Coerced)
}

func TestClassifyField_Coerce_Negative(t *testing.T) {
	r := ClassifyField("rssi", "-65")
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, float64(-65), r.Value)
}

func TestClassifyField_Coerce_IntegerString(t *testing.T) {
	r := ClassifyField("pm25", "35")
	assert.Equal(t, KindFloat, r.Kind)
	assert.Equal(t, float64(35), r.Value)
}

func TestClassifyField_HintButNotParseable(t *testing.T) {
	r := ClassifyField("temperature", "error")
	assert.Equal(t, KindString, r.Kind)
	assert.Equal(t, "error", r.Value)
	assert.Equal(t, "numeric-hint but not parseable", r.Reason)
}

func TestClassifyField_HintEmptyString(t *testing.T) {
	r := ClassifyField("temperature", "")
	assert.Equal(t, KindString, r.Kind)
	assert.Equal(t, "numeric-hint but not parseable", r.Reason)
}

func TestClassifyField_NumericHintsContent(t *testing.T) {
	for _, f := range []string{"temperature", "humidity", "pressure", "battery", "rssi", "co2", "pm25"} {
		assert.True(t, NumericFieldHints[f], "%q 应在数值白名单", f)
	}
	for _, f := range []string{"status", "firmware", "name", "messageId"} {
		assert.False(t, NumericFieldHints[f], "%q 不应在数值白名单", f)
	}
}

// ---------- classifyField: 复杂类型 ----------

func TestClassifyField_Object(t *testing.T) {
	r := ClassifyField("meta", map[string]any{"a": 1})
	assert.Equal(t, KindSkip, r.Kind)
	assert.Contains(t, r.Reason, "unsupported type")
}

func TestClassifyField_Array(t *testing.T) {
	r := ClassifyField("list", []any{1, 2, 3})
	assert.Equal(t, KindSkip, r.Kind)
}

// ---------- classifyPayload ----------

func TestClassifyPayload_Full(t *testing.T) {
	payload := map[string]any{
		"temperature": 25.6,
		"humidity":    "60.2", // 字符串数字，白名单强转
		"online":      true,
		"status":      "ok",
		"location":    "living-room",
		"type":        "dht22",
		"meta":        map[string]any{"nested": true},
		"timestamp":   float64(1758470400000), // v2.1 SKIP_FIELDS
		"messageId":   "abc-123",              // v2.1 SKIP_FIELDS
	}
	results := ClassifyPayload(payload)
	byKey := map[string]ClassifiedField{}
	for _, r := range results {
		byKey[r.Key] = r
	}

	require.Contains(t, byKey, "temperature")
	assert.Equal(t, KindFloat, byKey["temperature"].Kind)
	assert.False(t, byKey["temperature"].Coerced)

	assert.Equal(t, KindFloat, byKey["humidity"].Kind)
	assert.True(t, byKey["humidity"].Coerced)
	assert.Equal(t, 60.2, byKey["humidity"].Value)

	assert.Equal(t, KindBoolean, byKey["online"].Kind)
	assert.Equal(t, KindString, byKey["status"].Kind)
	assert.Equal(t, KindTag, byKey["location"].Kind)
	assert.Equal(t, KindTag, byKey["type"].Kind)
	assert.Equal(t, KindSkip, byKey["meta"].Kind)
	// v2.1：timestamp 与 messageId 已列入 SKIP_FIELDS
	assert.Equal(t, KindSkip, byKey["timestamp"].Kind)
	assert.Contains(t, byKey["timestamp"].Reason, "meta field")
	assert.Equal(t, KindSkip, byKey["messageId"].Kind)
	assert.Contains(t, byKey["messageId"].Reason, "meta field")
}

func TestClassifyPayload_Empty(t *testing.T) {
	assert.Empty(t, ClassifyPayload(map[string]any{}))
}

func TestClassifyPayload_SortedOrder(t *testing.T) {
	results := ClassifyPayload(map[string]any{"a": float64(1), "b": float64(2), "c": float64(3)})
	keys := make([]string, 0, len(results))
	for _, r := range results {
		keys = append(keys, r.Key)
	}
	assert.Equal(t, []string{"a", "b", "c"}, keys)
}
