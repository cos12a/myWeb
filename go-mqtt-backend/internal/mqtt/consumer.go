// Package mqtt 封装 MQTT 消费者（持久会话 + QoS 1 + 自动重连）。
// 对应 bun-mqtt-backend/src/consumer.ts。
package mqtt

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"go.uber.org/zap"

	"github.com/cos12a/go-mqtt-backend/internal/classifier"
	"github.com/cos12a/go-mqtt-backend/internal/config"
	"github.com/cos12a/go-mqtt-backend/internal/dedup"
	"github.com/cos12a/go-mqtt-backend/internal/logger"
	"github.com/cos12a/go-mqtt-backend/internal/sensor"
)

// MessageHandler 消息处理回调
type MessageHandler func(deviceID string, data map[string]any, ts *float64)

// Consumer MQTT 消费者，实现 health.MQTTStatusProvider 接口。
type Consumer struct {
	client       paho.Client
	cfg          *config.Config
	dedup        *dedup.MessageDeduplicator
	sensorWriter *sensor.Writer
	connected    bool
}

// NewConsumer 创建并连接 MQTT 消费者。
func NewConsumer(cfg *config.Config, d *dedup.MessageDeduplicator, sw *sensor.Writer) *Consumer {
	c := &Consumer{
		cfg:          cfg,
		dedup:        d,
		sensorWriter: sw,
	}

	opts := paho.NewClientOptions()
	opts.AddBroker(cfg.MQTTURL)
	opts.SetClientID(cfg.MQTTClientID)
	opts.SetUsername(cfg.MQTTUser)
	opts.SetPassword(cfg.MQTTPass)
	opts.SetCleanSession(false) // 持久会话
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(5 * time.Second)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetResumeSubs(true) // 重连后恢复订阅
	opts.SetMaxReconnectInterval(30 * time.Second)

	// 连接成功回调
	opts.SetOnConnectHandler(func(client paho.Client) {
		c.connected = true
		logger.Log.Info("已连接 MQTT Broker",
			zap.String("clientId", cfg.MQTTClientID),
			zap.String("url", cfg.MQTTURL),
		)
		// 每次连接/重连后重新订阅
		token := client.Subscribe(cfg.MQTTSubscribeTopic, 1, c.onMessage)
		token.Wait()
		if token.Error() != nil {
			logger.Log.Error("订阅失败", zap.Error(token.Error()))
		} else {
			logger.Log.Info("已订阅主题",
				zap.String("topic", cfg.MQTTSubscribeTopic),
				zap.Int("qos", 1),
			)
		}
	})

	// 断连回调
	opts.SetConnectionLostHandler(func(client paho.Client, err error) {
		c.connected = false
		logger.Log.Warn("MQTT 连接断开，将自动重连", zap.Error(err))
	})

	c.client = paho.NewClient(opts)

	// 发起连接（非阻塞，ConnectRetry 会自动重试）
	token := c.client.Connect()
	go func() {
		token.Wait()
		if token.Error() != nil {
			logger.Log.Error("MQTT 首次连接失败（将持续重试）", zap.Error(token.Error()))
		}
	}()

	return c
}

// onMessage MQTT 消息回调（核心流水线）
func (c *Consumer) onMessage(client paho.Client, msg paho.Message) {
	topic := msg.Topic()
	raw := msg.Payload()

	// 1) JSON 解析
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		logger.Log.Warn("JSON 解析失败，丢弃消息",
			zap.String("topic", topic),
			zap.String("raw", truncate(string(raw), 200)),
			zap.Error(err),
		)
		return
	}

	// 2) 基本结构校验（payload 必须是 JSON object 且非空）
	if len(data) == 0 {
		logger.Log.Warn("payload 为空对象，丢弃", zap.String("topic", topic))
		return
	}

	// 3) 去重
	dedupResult := dedup.ComputeDedupKey(topic, raw, data)
	if !c.dedup.CheckAndRecord(dedupResult.Key) {
		logger.Log.Debug("重复消息已丢弃",
			zap.String("topic", topic),
			zap.String("dedupKey", dedupResult.Key),
			zap.String("source", dedupResult.Source),
		)
		return
	}

	// 4) 提取 deviceId（从 topic: sensors/{deviceId}/...）
	deviceID := ParseDeviceIDFromTopic(topic)
	if deviceID == "" {
		// fallback: payload 里的 deviceId 字段
		if id, ok := data["deviceId"].(string); ok && id != "" {
			deviceID = id
		} else {
			deviceID = "unknown"
		}
	}

	// 5) Debug 模式：打印完整 payload + 分类预览
	if c.cfg.LogLevel == "debug" {
		classified := classifier.ClassifyPayload(data)
		fields := make([]map[string]any, 0, len(classified))
		for _, f := range classified {
			fields = append(fields, map[string]any{
				"field":   f.Key,
				"kind":    f.Kind.String(),
				"value":   f.Value,
				"coerced": f.Coerced,
			})
		}
		logger.Log.Debug("收到传感器数据",
			zap.String("topic", topic),
			zap.String("deviceId", deviceID),
			zap.String("dedupKey", dedupResult.Key),
			zap.Any("payload", data),
			zap.Any("fields", fields),
		)
	}

	// 6) 提取 timestamp（可选）
	var ts *float64
	if v, ok := data["timestamp"]; ok {
		switch n := v.(type) {
		case float64:
			ts = &n
		}
	}

	// 7) 写入 InfluxDB
	c.sensorWriter.WriteSensorData(deviceID, data, ts)
}

// Stop 优雅断开 MQTT 连接。
func (c *Consumer) Stop() {
	c.client.Disconnect(1000) // 1 秒等待发送 DISCONNECT 报文
	c.connected = false
	logger.Log.Info("MQTT 连接已关闭")
}

// ---------- health.MQTTStatusProvider 接口实现 ----------

func (c *Consumer) IsConnected() bool {
	return c.client.IsConnected()
}

func (c *Consumer) ClientID() string {
	return c.cfg.MQTTClientID
}

func (c *Consumer) SubscribeTopic() string {
	return c.cfg.MQTTSubscribeTopic
}

// ---------- 工具函数 ----------

// ParseDeviceIDFromTopic 从 MQTT topic 提取 deviceId。
// 规则：sensors/{deviceId}/... → deviceId
func ParseDeviceIDFromTopic(topic string) string {
	parts := strings.Split(topic, "/")
	if len(parts) >= 2 && parts[0] == "sensors" {
		return parts[1]
	}
	return ""
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + fmt.Sprintf("...(truncated, total %d bytes)", len(s))
}
