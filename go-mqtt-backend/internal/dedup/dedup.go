// Package dedup 提供 LRU + TTL 消息去重器。
// 对应 bun-mqtt-backend/src/dedup.ts。
package dedup

import (
	"fmt"
	"math"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cespare/xxhash/v2"
	lru "github.com/hashicorp/golang-lru/v2"
)

// Stats 去重统计信息
type Stats struct {
	Enabled bool    `json:"enabled"`
	Size    int     `json:"size"`
	MaxSize int     `json:"maxSize"`
	TTLMS   int     `json:"ttlMs"`
	Hits    int64   `json:"hits"`
	Misses  int64   `json:"misses"`
	HitRate float64 `json:"hitRate"`
	Evicted int64   `json:"evicted"`
}

// MessageDeduplicator LRU + TTL 消息去重器。
// 线程安全，可在 MQTT 回调 goroutine 中并发使用。
type MessageDeduplicator struct {
	cache   *lru.Cache[string, time.Time]
	ttl     time.Duration
	enabled bool
	cap     int // 构造时传入的最大条目数

	hits    atomic.Int64
	misses  atomic.Int64
	evicted atomic.Int64

	stopCh chan struct{}
	once   sync.Once
}

// New 创建去重器。maxSize: LRU 最大条目数；ttlMS: 单条记录存活毫秒数。
func New(enabled bool, maxSize int, ttlMS int) *MessageDeduplicator {
	if maxSize < 1 {
		maxSize = 1
	}
	cache, _ := lru.New[string, time.Time](maxSize)
	d := &MessageDeduplicator{
		cache:   cache,
		ttl:     time.Duration(ttlMS) * time.Millisecond,
		enabled: enabled,
		cap:     maxSize,
		stopCh:  make(chan struct{}),
	}
	if enabled {
		go d.sweepLoop()
	}
	return d
}

// CheckAndRecord 检查 key 是否为新消息。
// 返回 true = 新消息（已记录）；false = 重复（应丢弃）。
func (d *MessageDeduplicator) CheckAndRecord(key string) bool {
	if !d.enabled {
		return true // 去重关闭时，所有消息都视为新消息
	}

	now := time.Now()

	// 惰性过期检查（Get 会刷新 LRU recency，命中即视为近期使用）
	if entry, ok := d.cache.Get(key); ok {
		if now.Sub(entry) < d.ttl {
			// 未过期 → 重复
			d.hits.Add(1)
			return false
		}
		// 已过期 → 移除后当新消息处理
		d.cache.Remove(key)
	}

	// 新消息 → 记录
	evicted := d.cache.Add(key, now)
	if evicted {
		d.evicted.Add(1)
	}
	d.misses.Add(1)
	return true
}

// GetStats 返回当前统计快照。
func (d *MessageDeduplicator) GetStats() Stats {
	hits := d.hits.Load()
	misses := d.misses.Load()
	total := hits + misses
	var hitRate float64
	if total > 0 {
		hitRate = float64(hits) / float64(total)
	}
	return Stats{
		Enabled: d.enabled,
		Size:    d.cache.Len(),
		MaxSize: d.maxSize(),
		TTLMS:   int(d.ttl.Milliseconds()),
		Hits:    hits,
		Misses:  misses,
		HitRate: math.Round(hitRate*10000) / 10000, // 保留 4 位小数
		Evicted: d.evicted.Load(),
	}
}

// Stop 停止周期清扫 goroutine。
func (d *MessageDeduplicator) Stop() {
	d.once.Do(func() { close(d.stopCh) })
}

// Clear 清空缓存与计数器（测试用）。
func (d *MessageDeduplicator) Clear() {
	d.cache.Purge()
	d.hits.Store(0)
	d.misses.Store(0)
	d.evicted.Store(0)
}

func (d *MessageDeduplicator) maxSize() int {
	return d.cap
}

// sweepLoop 周期清理过期条目（防止内存泄漏）。
func (d *MessageDeduplicator) sweepLoop() {
	interval := d.ttl / 2
	if interval < 30*time.Second {
		interval = 30 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			d.sweep()
		case <-d.stopCh:
			return
		}
	}
}

func (d *MessageDeduplicator) sweep() int {
	now := time.Now()
	var expired []string
	for _, key := range d.cache.Keys() {
		if entry, ok := d.cache.Peek(key); ok {
			if now.Sub(entry) >= d.ttl {
				expired = append(expired, key)
			}
		}
	}
	for _, key := range expired {
		d.cache.Remove(key)
	}
	return len(expired)
}

// ---------- ComputeDedupKey ----------

// ComputeDedupKeyResult 去重键计算结果
type ComputeDedupKeyResult struct {
	Key    string // 去重键
	Source string // "id" 或 "hash"
}

// ComputeDedupKey 根据 topic + 原始 payload + 解析后的对象，计算去重键。
// 优先使用 payload 里的显式 ID 字段；否则用 xxhash 快速哈希。
func ComputeDedupKey(topic string, raw []byte, data map[string]any) ComputeDedupKeyResult {
	// 优先查 ID 字段
	for _, field := range DedupIDFields {
		v, exists := data[field]
		if !exists {
			continue
		}
		switch val := v.(type) {
		case string:
			if val != "" {
				return ComputeDedupKeyResult{
					Key:    fmt.Sprintf("id:%s:%s", field, val),
					Source: "id",
				}
			}
		case float64:
			if !math.IsNaN(val) && !math.IsInf(val, 0) {
				return ComputeDedupKeyResult{
					Key:    fmt.Sprintf("id:%s:%s", field, strconv.FormatFloat(val, 'f', -1, 64)),
					Source: "id",
				}
			}
		}
	}

	// fallback: xxhash(topic + "|" + raw) → base36
	h := xxhash.Sum64(append([]byte(topic+"|"), raw...))
	return ComputeDedupKeyResult{
		Key:    "h:" + strconv.FormatUint(h, 36),
		Source: "hash",
	}
}

// DedupIDFields 与 classifier.DedupIDFields 保持一致（避免循环依赖，此处独立定义）
var DedupIDFields = []string{"messageId", "msgId", "message_id", "msg_id", "uuid", "id"}
