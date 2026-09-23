// Package config 负责从环境变量加载并校验应用配置。
// 对应 bun-mqtt-backend/src/config.ts 的 Zod schema 校验逻辑。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config 应用全量配置（从环境变量解析）
type Config struct {
	// MQTT
	MQTTURL            string
	MQTTUser           string
	MQTTPass           string
	MQTTClientID       string
	MQTTSubscribeTopic string

	// InfluxDB
	InfluxURL    string
	InfluxToken  string
	InfluxOrg    string
	InfluxBucket string

	// 运行时
	LogLevel   string
	HealthPort int

	// 应用层去重
	DedupEnabled bool
	DedupMaxSize int
	DedupTTLMS   int
}

// Load 从环境变量加载配置，校验必填项，返回 Config 或错误列表。
// 校验失败时返回所有错误（不是只报第一个），方便一次性修复。
func Load() (*Config, []string) {
	var errs []string

	cfg := &Config{
		// MQTT
		MQTTURL:            getEnv("MQTT_URL", ""),
		MQTTUser:           getEnv("MQTT_USER", ""),
		MQTTPass:           getEnv("MQTT_PASS", ""),
		MQTTClientID:       getEnv("MQTT_CLIENT_ID", "go-mqtt-consumer"),
		MQTTSubscribeTopic: getEnv("MQTT_SUBSCRIBE_TOPIC", "sensors/#"),

		// InfluxDB
		InfluxURL:    getEnv("INFLUX_URL", ""),
		InfluxToken:  getEnv("INFLUX_TOKEN", ""),
		InfluxOrg:    getEnv("INFLUX_ORG", ""),
		InfluxBucket: getEnv("INFLUX_BUCKET", ""),

		// 运行时
		LogLevel:   strings.ToLower(getEnv("LOG_LEVEL", "info")),
		HealthPort: getEnvInt("HEALTH_PORT", 9002),

		// 去重
		DedupEnabled: getEnvBool("DEDUP_ENABLED", true),
		DedupMaxSize: getEnvInt("DEDUP_MAX_SIZE", 10000),
		DedupTTLMS:   getEnvInt("DEDUP_TTL_MS", 300000),
	}

	// 必填校验
	required := map[string]string{
		"MQTT_URL":      cfg.MQTTURL,
		"MQTT_USER":     cfg.MQTTUser,
		"MQTT_PASS":     cfg.MQTTPass,
		"INFLUX_URL":    cfg.InfluxURL,
		"INFLUX_TOKEN":  cfg.InfluxToken,
		"INFLUX_ORG":    cfg.InfluxOrg,
		"INFLUX_BUCKET": cfg.InfluxBucket,
	}
	for name, val := range required {
		if strings.TrimSpace(val) == "" {
			errs = append(errs, fmt.Sprintf("%s: 不能为空", name))
		}
	}

	// 范围校验
	if cfg.HealthPort < 1 || cfg.HealthPort > 65535 {
		errs = append(errs, fmt.Sprintf("HEALTH_PORT: 必须在 1~65535 之间，当前 %d", cfg.HealthPort))
	}
	if cfg.DedupMaxSize < 100 || cfg.DedupMaxSize > 1000000 {
		errs = append(errs, fmt.Sprintf("DEDUP_MAX_SIZE: 必须在 100~1000000 之间，当前 %d", cfg.DedupMaxSize))
	}
	if cfg.DedupTTLMS < 1000 || cfg.DedupTTLMS > 3600000 {
		errs = append(errs, fmt.Sprintf("DEDUP_TTL_MS: 必须在 1000~3600000 之间，当前 %d", cfg.DedupTTLMS))
	}

	validLevels := map[string]bool{
		"debug": true, "info": true, "warn": true, "error": true, "fatal": true,
	}
	if !validLevels[cfg.LogLevel] {
		errs = append(errs, fmt.Sprintf("LOG_LEVEL: 无效值 %q，可选 debug/info/warn/error/fatal", cfg.LogLevel))
	}

	if len(errs) > 0 {
		return nil, errs
	}
	return cfg, nil
}

// Snapshot 返回脱敏后的配置摘要（可安全写入日志）。
func (c *Config) Snapshot() map[string]any {
	return map[string]any{
		"mqtt": map[string]any{
			"url":            c.MQTTURL,
			"username":       c.MQTTUser,
			"clientId":       c.MQTTClientID,
			"subscribeTopic": c.MQTTSubscribeTopic,
			"qos":            1,
		},
		"influx": map[string]any{
			"url":    c.InfluxURL,
			"org":    c.InfluxOrg,
			"bucket": c.InfluxBucket,
		},
		"log": map[string]any{
			"level": c.LogLevel,
		},
		"health": map[string]any{
			"port": c.HealthPort,
		},
		"dedup": map[string]any{
			"enabled": c.DedupEnabled,
			"maxSize": c.DedupMaxSize,
			"ttlMs":   c.DedupTTLMS,
		},
	}
}

// ---------- 内部工具函数 ----------

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
