// Package influx 封装 InfluxDB 2.x 批量写入客户端。
// 对应 bun-mqtt-backend/src/influx.ts。
package influx

import (
	"context"
	"fmt"
	"time"

	influxdb2 "github.com/influxdata/influxdb-client-go/v2"
	"github.com/influxdata/influxdb-client-go/v2/api"
	"github.com/influxdata/influxdb-client-go/v2/api/write"

	"github.com/cos12a/go-mqtt-backend/internal/config"
	"github.com/cos12a/go-mqtt-backend/internal/logger"
	"go.uber.org/zap"
)

// Writer 封装 InfluxDB 非阻塞批量写入 API。
type Writer struct {
	client   influxdb2.Client
	writeAPI api.WriteAPI
	org      string
	bucket   string
}

// NewWriter 创建 InfluxDB Writer（批量模式：BatchSize=500 / FlushInterval=1s / MaxRetries=3）。
func NewWriter(cfg *config.Config) *Writer {
	options := influxdb2.DefaultOptions()
	options.SetBatchSize(500)
	options.SetFlushInterval(1000) // ms
	options.SetRetryInterval(1000) // ms
	options.SetMaxRetries(3)
	options.SetPrecision(time.Nanosecond)

	client := influxdb2.NewClientWithOptions(cfg.InfluxURL, cfg.InfluxToken, options)
	writeAPI := client.WriteAPI(cfg.InfluxOrg, cfg.InfluxBucket)

	// 监听写入错误（异步回调）
	errCh := writeAPI.Errors()
	go func() {
		for err := range errCh {
			logger.Log.Error("InfluxDB 写入失败", zap.Error(err))
		}
	}()

	w := &Writer{
		client:   client,
		writeAPI: writeAPI,
		org:      cfg.InfluxOrg,
		bucket:   cfg.InfluxBucket,
	}

	logger.Log.Info("InfluxDB writeAPI 已就绪",
		zap.String("url", cfg.InfluxURL),
		zap.String("org", cfg.InfluxOrg),
		zap.String("bucket", cfg.InfluxBucket),
		zap.Int("batchSize", 500),
		zap.Int("flushIntervalMs", 1000),
	)

	return w
}

// WritePoint 将一个 Point 加入批量写入队列（非阻塞）。
func (w *Writer) WritePoint(p *write.Point) {
	w.writeAPI.WritePoint(p)
}

// NewPoint 创建一个带默认 tag 的 Point。
func (w *Writer) NewPoint(measurement string) *write.Point {
	p := write.NewPoint(measurement, nil, nil, time.Now())
	p.AddTag("app", "mqtt-consumer")
	return p
}

// Close 刷新缓冲区并关闭连接。
func (w *Writer) Close() error {
	w.writeAPI.Flush()
	w.client.Close()
	logger.Log.Info("InfluxDB 缓冲区已刷出，连接已关闭")
	return nil
}

// Ping 检查 InfluxDB 连通性（用于健康检查）。
func (w *Writer) Ping() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ok, err := w.client.Ping(ctx)
	if err != nil {
		return fmt.Errorf("influx ping failed: %w", err)
	}
	if !ok {
		return fmt.Errorf("influx ping returned false")
	}
	return nil
}
