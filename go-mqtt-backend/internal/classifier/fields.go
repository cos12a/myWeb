// Package classifier 提供传感器 payload 字段分类器。
// 对应 bun-mqtt-backend/src/services/fieldClassifier.ts。
package classifier

// DedupIDFields payload 里可能作为唯一 ID 的字段名（按优先级）。
// 这些字段仅用于服务端 LRU 去重计算 key，不写入 InfluxDB。
var DedupIDFields = []string{"messageId", "msgId", "message_id", "msg_id", "uuid", "id"}

// TagFields 会被识别为 Tag（索引字段）的 payload 键名。
// Tag 必须低基数（少量唯一值），否则会导致 InfluxDB series 爆炸。
var TagFields = map[string]bool{
	"location": true,
	"type":     true,
}

// SkipFields 元字段黑名单：无论值是什么类型，一律不写入 InfluxDB。
// 优先级高于 TagFields 与 NumericFieldHints。
var SkipFields = map[string]bool{
	// dedup ID 字段
	"messageId":  true,
	"msgId":      true,
	"message_id": true,
	"msg_id":     true,
	"uuid":       true,
	"id":         true,
	// 元信息字段
	"timestamp": true, // 已由 Point.SetTime() 处理
	"deviceId":  true, // 已由 topic 解析为 device_id tag
}

// NumericFieldHints 数值字段白名单：当 payload 里这些字段被误传成字符串时，
// 自动强转为 float，避免 InfluxDB 中该字段被锁死为 string 类型。
var NumericFieldHints = map[string]bool{
	// 温湿度气压
	"temperature": true, "humidity": true, "pressure": true, "dewPoint": true,
	// 电量
	"battery": true, "voltage": true, "current": true, "power": true, "energy": true,
	// 无线信号
	"rssi": true, "snr": true,
	// 环境
	"lux": true, "co2": true, "tvoc": true, "pm25": true, "pm10": true, "pm1": true,
	"altitude": true, "windSpeed": true, "windDirection": true, "rainfall": true,
	"soilMoisture": true, "soilTemperature": true, "waterLevel": true,
	// 通用数值
	"value": true, "count": true, "duration": true, "weight": true, "distance": true,
}
