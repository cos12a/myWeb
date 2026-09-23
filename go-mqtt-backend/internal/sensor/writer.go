// Package sensor 负责把 MQTT payload 转换为 InfluxDB Point 并写入。
// 对应 bun-mqtt-backend/src/services/sensorData.ts。
package sensor

import (
	"time"

	"github.com/influxdata/influxdb-client-go/v2/api/write"
	"go.uber.org/zap"

	"github.com/cos12a/go-mqtt-backend/internal/classifier"
	"github.com/cos12a/go-mqtt-backend/internal/influx"
	"github.com/cos12a/go-mqtt-backend/internal/logger"
	"github.com/cos12a/go-mqtt-backend/internal/timestamp"
)

// Writer 把传感器 payload 转换成 InfluxDB Point 并入队写入。
type Writer struct {
	influx *influx.Writer
}

// NewWriter 创建 sensor Writer。
func NewWriter(iw *influx.Writer) *Writer {
	return &Writer{influx: iw}
}

// WriteSensorData 把传感器 payload 转换成 InfluxDB Point 并入队写入。
//
// 落库规则：
//   - deviceId 来自 topic，永远作为 tag "device_id"
//   - location / type 作为 tag（低基数、常用作过滤）
//   - 数字 → FloatField；布尔 → BoolField；字符串 → StringField
//   - 白名单里的数值字段如果被误传成字符串，会自动强转 + warn 日志
//   - SKIP_FIELDS 黑名单字段（messageId / timestamp / deviceId 等）不写入
//   - 嵌套对象暂不处理
func (w *Writer) WriteSensorData(deviceID string, data map[string]any, ts *float64) {
	point := write.NewPoint(
		"sensor_reading",
		map[string]string{
			"app":       "mqtt-consumer",
			"device_id": deviceID,
		},
		nil, // fields 后面逐个添加
		time.Now(),
	)

	// 分类所有字段
	classified := classifier.ClassifyPayload(data)

	for _, c := range classified {
		switch c.Kind {
		case classifier.KindTag:
			point.AddTag(c.Key, c.Value.(string))

		case classifier.KindFloat:
			point.AddField(c.Key, c.Value.(float64))
			if c.Coerced {
				logger.Log.Warn("字段本应是数值但收到字符串，已自动转为 float（建议修传感器固件）",
					zap.String("deviceId", deviceID),
					zap.String("field", c.Key),
					zap.String("raw", c.Raw),
					zap.Float64("coercedTo", c.Value.(float64)),
				)
			}

		case classifier.KindBoolean:
			point.AddField(c.Key, c.Value.(bool))

		case classifier.KindString:
			point.AddField(c.Key, c.Value.(string))
			if c.Reason == "numeric-hint but not parseable" {
				logger.Log.Warn("字段在数值白名单里但无法解析成数字，已按字符串写入",
					zap.String("deviceId", deviceID),
					zap.String("field", c.Key),
					zap.Any("value", c.Value),
				)
			}

		case classifier.KindSkip:
			logger.Log.Debug("跳过字段",
				zap.String("deviceId", deviceID),
				zap.String("field", c.Key),
				zap.String("reason", c.Reason),
			)
		}
	}

	// 时间戳：智能识别单位并归一化为纳秒
	result := timestamp.NormalizeToNanoseconds(ts)
	if result.UsedFallback {
		logger.Log.Debug("payload 未提供 timestamp，使用服务器当前时间",
			zap.String("deviceId", deviceID))
	} else if result.Unit != timestamp.UnitNanosecond {
		logger.Log.Debug("已自动将时间戳转换为纳秒",
			zap.String("deviceId", deviceID),
			zap.String("unit", string(result.Unit)))
	}
	point.SetTime(time.Unix(0, result.Nanos))

	w.influx.WritePoint(point)
}
