// Package health 提供 HTTP 健康检查与运行时统计端点。
// 对应 bun-mqtt-backend/src/health.ts。
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/cos12a/go-mqtt-backend/internal/config"
	"github.com/cos12a/go-mqtt-backend/internal/dedup"
	"github.com/cos12a/go-mqtt-backend/internal/logger"
)

// MQTTStatusProvider 提供 MQTT 连接状态的接口（解耦 mqtt 包）
type MQTTStatusProvider interface {
	IsConnected() bool
	ClientID() string
	SubscribeTopic() string
}

// Server 健康检查 HTTP 服务器
type Server struct {
	httpServer *http.Server
	startTime  time.Time
	cfg        *config.Config
	mqtt       MQTTStatusProvider
	dedup      *dedup.MessageDeduplicator
}

// NewServer 创建健康检查服务器。
func NewServer(cfg *config.Config, mqtt MQTTStatusProvider, d *dedup.MessageDeduplicator) *Server {
	s := &Server{
		startTime: time.Now(),
		cfg:       cfg,
		mqtt:      mqtt,
		dedup:     d,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.handleRoot)
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /stats", s.handleStats)

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.HealthPort),
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	return s
}

// Start 在独立 goroutine 中启动 HTTP 服务器（非阻塞）。
func (s *Server) Start() {
	go func() {
		logger.Log.Info("健康检查端点已启动",
			zap.Int("port", s.cfg.HealthPort),
			zap.String("hostname", "localhost"),
		)
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Log.Error("健康检查服务器异常退出", zap.Error(err))
		}
	}()
}

// Stop 优雅关闭 HTTP 服务器。
func (s *Server) Stop(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// ---------- Handlers ----------

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":      "go-mqtt-backend",
		"version":   "2.1.0",
		"endpoints": []string{"/health", "/stats"},
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	connected := s.mqtt.IsConnected()
	status := "ok"
	code := http.StatusOK
	if !connected {
		status = "degraded"
		code = http.StatusServiceUnavailable
	}

	writeJSON(w, code, map[string]any{
		"status": status,
		"mqtt": map[string]any{
			"connected": connected,
		},
		"uptimeSec": int(time.Since(s.startTime).Seconds()),
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	dedupStats := s.dedup.GetStats()

	writeJSON(w, http.StatusOK, map[string]any{
		"uptimeSec": int(time.Since(s.startTime).Seconds()),
		"mqtt": map[string]any{
			"connected":      s.mqtt.IsConnected(),
			"clientId":       s.mqtt.ClientID(),
			"subscribeTopic": s.mqtt.SubscribeTopic(),
		},
		"influx": map[string]any{
			"url":    s.cfg.InfluxURL,
			"org":    s.cfg.InfluxOrg,
			"bucket": s.cfg.InfluxBucket,
		},
		"dedup": dedupStats,
	})
}

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}
