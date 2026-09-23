package classifier

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

// FieldKind 字段分类结果类型
type FieldKind int

const (
	KindSkip    FieldKind = iota // 不写入 InfluxDB
	KindTag                      // 写入为 Tag（索引）
	KindFloat                    // 写入为 FloatField
	KindBoolean                  // 写入为 BoolField
	KindString                   // 写入为 StringField
)

// String 返回 FieldKind 的可读名称（用于日志）
func (k FieldKind) String() string {
	switch k {
	case KindSkip:
		return "skip"
	case KindTag:
		return "tag"
	case KindFloat:
		return "float"
	case KindBoolean:
		return "boolean"
	case KindString:
		return "string"
	default:
		return "unknown"
	}
}

// ClassifiedField 单个字段的分类结果
type ClassifiedField struct {
	Kind    FieldKind
	Key     string
	Value   any    // KindFloat 时是 float64；KindTag/KindString 时是 string；KindBoolean 时是 bool
	Coerced bool   // 是否从字符串强转而来
	Raw     string // 强转前的原始字符串
	Reason  string // skip 或特殊情况的原因说明
}

// TryParseNumericString 尝试把字符串解析成有限数字；失败返回 (0, false)。
func TryParseNumericString(s string) (float64, bool) {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

// ClassifyField 把一个 (key, value) 分类成 InfluxDB 里应该走的路径。
//
// 分类规则（按优先级）：
//
//  0. key ∈ SkipFields                              → skip（元字段黑名单）
//  1. nil                                           → skip
//  2. key ∈ TagFields 且是字符串                     → tag
//  3. float64（有限）                                → float
//  4. float64（NaN / ±Inf）                         → skip
//  5. bool                                          → boolean
//  6. string:
//     6a. key ∈ NumericFieldHints 且能解析成数字     → float（coerced=true）
//     6b. key ∈ NumericFieldHints 但无法解析         → string（reason 标注）
//     6c. 其他                                       → string
//  7. 其他类型（map / slice / etc）                  → skip
func ClassifyField(key string, value any) ClassifiedField {
	// 第 0 层：元字段黑名单优先拦截
	if SkipFields[key] {
		return ClassifiedField{Kind: KindSkip, Key: key, Reason: "meta field (skip list)"}
	}

	// 第 1 层：nil
	if value == nil {
		return ClassifiedField{Kind: KindSkip, Key: key, Reason: "null/undefined"}
	}

	// 第 2 层：TagFields + string
	if TagFields[key] {
		if s, ok := value.(string); ok {
			return ClassifiedField{Kind: KindTag, Key: key, Value: s}
		}
	}

	// 第 3-4 层：数值（Go json.Unmarshal 到 any 时 number 统一为 float64）
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return ClassifiedField{Kind: KindSkip, Key: key, Reason: "non-finite number"}
		}
		return ClassifiedField{Kind: KindFloat, Key: key, Value: v}

	case int:
		return ClassifiedField{Kind: KindFloat, Key: key, Value: float64(v)}

	case int64:
		return ClassifiedField{Kind: KindFloat, Key: key, Value: float64(v)}

	// 第 5 层：布尔
	case bool:
		return ClassifiedField{Kind: KindBoolean, Key: key, Value: v}

	// 第 6 层：字符串
	case string:
		if NumericFieldHints[key] {
			if n, ok := TryParseNumericString(v); ok {
				return ClassifiedField{Kind: KindFloat, Key: key, Value: n, Coerced: true, Raw: v}
			}
			return ClassifiedField{Kind: KindString, Key: key, Value: v, Reason: "numeric-hint but not parseable"}
		}
		return ClassifiedField{Kind: KindString, Key: key, Value: v}

	// 第 7 层：其他类型（map / slice / struct / etc）
	default:
		return ClassifiedField{Kind: KindSkip, Key: key, Reason: "unsupported type"}
	}
}

// ClassifyPayload 对整份 payload 做分类预览。
// 返回结果按 key 字典序排列（保证稳定顺序，便于 golden test 对比）。
func ClassifyPayload(data map[string]any) []ClassifiedField {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	result := make([]ClassifiedField, 0, len(keys))
	for _, k := range keys {
		result = append(result, ClassifyField(k, data[k]))
	}
	return result
}
