// Package logger 提供全局 zap 结构化日志实例。
// 对应 bun-mqtt-backend/src/logger.ts 的 Pino 日志。
package logger

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Log 全局日志实例，由 Init() 初始化后供其他包使用。
var Log *zap.Logger = zap.NewNop()

// Init 根据日志级别初始化全局 Logger。
// level: debug / info / warn / error / fatal
func Init(level string) {
	var lvl zapcore.Level
	switch level {
	case "debug":
		lvl = zapcore.DebugLevel
	case "info":
		lvl = zapcore.InfoLevel
	case "warn":
		lvl = zapcore.WarnLevel
	case "error":
		lvl = zapcore.ErrorLevel
	case "fatal":
		lvl = zapcore.FatalLevel
	default:
		lvl = zapcore.InfoLevel
	}

	cfg := zap.Config{
		Level:            zap.NewAtomicLevelAt(lvl),
		Encoding:         "json",
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
		EncoderConfig: zapcore.EncoderConfig{
			TimeKey:        "time",
			LevelKey:       "level",
			NameKey:        "app",
			MessageKey:     "msg",
			CallerKey:      "",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.MillisDurationEncoder,
		},
	}
	cfg.InitialFields = map[string]any{"app": "go-mqtt-backend"}

	logger, err := cfg.Build()
	if err != nil {
		panic("logger init failed: " + err.Error())
	}
	Log = logger
}

// Sync 刷新日志缓冲区（程序退出前调用）。
func Sync() {
	_ = Log.Sync()
}
