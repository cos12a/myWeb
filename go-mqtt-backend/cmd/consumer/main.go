// go-mqtt-backend 统一入口：装配所有模块 + 优雅关闭。
// 对应 bun-mqtt-backend/src/index.ts。
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"go.uber.org/zap"

	"github.com/cos12a/go-mqtt-backend/internal/config"
	"github.com/cos12a/go-mqtt-backend/internal/dedup"
	"github.com/cos12a/go-mqtt-backend/internal/health"
	"github.com/cos12a/go-mqtt-backend/internal/influx"
	"github.com/cos12a/go-mqtt-backend/internal/logger"
	"github.com/cos12a/go-mqtt-backend/internal/mqtt"
	"github.com/cos12a/go-mqtt-backend/internal/sensor"
)

func main() {
	// ---------- 命令行参数 ----------
	envFile := flag.String("env-file", ".env", "环境变量文件路径")
	flag.Parse()

	// ---------- 加载 .env 文件 ----------
	if err := godotenv.Load(*envFile); err != nil {
		// .env 文件不存在时不 fatal（可能通过系统环境变量传入）
		fmt.Fprintf(os.Stderr, "⚠️  无法加载 %s: %v（将使用系统环境变量）\n", *envFile, err)
	}

	// ---------- 配置校验 ----------
	cfg, errs := config.Load()
	if len(errs) > 0 {
		fmt.Fprintln(os.Stderr, "❌ 环境变量校验失败:")
		for _, e := range errs {
			fmt.Fprintf(os.Stderr, "   - %s\n", e)
		}
		os.Exit(1)
	}

	// ---------- 日志初始化 ----------
	logger.Init(cfg.LogLevel)
	defer logger.Sync()

	logger.Log.Info("启动 go-mqtt-backend", zap.Any("config", cfg.Snapshot()))

	// ---------- InfluxDB ----------
	influxWriter := influx.NewWriter(cfg)

	// ---------- 去重器 ----------
	deduplicator := dedup.New(cfg.DedupEnabled, cfg.DedupMaxSize, cfg.DedupTTLMS)

	// ---------- Sensor Writer ----------
	sensorWriter := sensor.NewWriter(influxWriter)

	// ---------- MQTT Consumer ----------
	mqttConsumer := mqtt.NewConsumer(cfg, deduplicator, sensorWriter)

	// ---------- Health Server ----------
	healthServer := health.NewServer(cfg, mqttConsumer, deduplicator)
	healthServer.Start()

	// ---------- 优雅关闭 ----------
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	sig := <-quit
	logger.Log.Info("收到信号，正在关闭...", zap.String("signal", sig.String()))

	// 5 秒兜底强制退出
	forceExit := time.AfterFunc(5*time.Second, func() {
		logger.Log.Warn("优雅关闭超时，强制退出")
		os.Exit(1)
	})
	defer forceExit.Stop()

	// 按依赖顺序关闭
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 1) 停止健康检查服务器
	if err := healthServer.Stop(ctx); err != nil {
		logger.Log.Error("健康检查服务器关闭失败", zap.Error(err))
	}

	// 2) 停止去重器清扫 goroutine
	deduplicator.Stop()

	// 3) 断开 MQTT
	mqttConsumer.Stop()

	// 4) 刷新 InfluxDB 缓冲区
	if err := influxWriter.Close(); err != nil {
		logger.Log.Error("InfluxDB 关闭失败", zap.Error(err))
	}

	// 5) 刷新日志
	logger.Sync()

	fmt.Println("👋 已安全退出")
}
