package dedup

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// ---------- MessageDeduplicator ----------

func TestDedup_FirstSeenReturnsTrue(t *testing.T) {
	d := New(true, 100, 60_000)
	defer d.Stop()
	assert.True(t, d.CheckAndRecord("k1"))
}

func TestDedup_SecondSameKeyReturnsFalse(t *testing.T) {
	d := New(true, 100, 60_000)
	defer d.Stop()
	assert.True(t, d.CheckAndRecord("k1"))
	assert.False(t, d.CheckAndRecord("k1"))
	assert.False(t, d.CheckAndRecord("k1"))
}

func TestDedup_DifferentKeysIndependent(t *testing.T) {
	d := New(true, 100, 60_000)
	defer d.Stop()
	assert.True(t, d.CheckAndRecord("k1"))
	assert.True(t, d.CheckAndRecord("k2"))
	assert.True(t, d.CheckAndRecord("k3"))
	assert.False(t, d.CheckAndRecord("k1"))
	assert.False(t, d.CheckAndRecord("k2"))
}

func TestDedup_LRUEviction(t *testing.T) {
	d := New(true, 3, 60_000)
	defer d.Stop()
	d.CheckAndRecord("k1")
	d.CheckAndRecord("k2")
	d.CheckAndRecord("k3")
	// 缓存已满，插入 k4 淘汰 k1
	assert.True(t, d.CheckAndRecord("k4"))
	// k1 已被淘汰 → 新消息
	assert.True(t, d.CheckAndRecord("k1"))
	// k2 也被淘汰
	assert.True(t, d.CheckAndRecord("k2"))
}

func TestDedup_HitRefreshesRecency(t *testing.T) {
	d := New(true, 3, 60_000)
	defer d.Stop()
	d.CheckAndRecord("k1")
	d.CheckAndRecord("k2")
	d.CheckAndRecord("k3")
	// 命中 k1 → k1 变最近使用
	assert.False(t, d.CheckAndRecord("k1"))
	// 插入 k4 → 淘汰 k2（现在最旧）
	d.CheckAndRecord("k4")
	// k1 仍在缓存
	assert.False(t, d.CheckAndRecord("k1"))
	// k2 已被淘汰
	assert.True(t, d.CheckAndRecord("k2"))
}

func TestDedup_TTLExpiry(t *testing.T) {
	d := New(true, 100, 50)
	defer d.Stop()
	assert.True(t, d.CheckAndRecord("k1"))
	assert.False(t, d.CheckAndRecord("k1"))
	time.Sleep(80 * time.Millisecond)
	assert.True(t, d.CheckAndRecord("k1"))
}

func TestDedup_DisabledAlwaysTrue(t *testing.T) {
	d := New(false, 100, 60_000)
	defer d.Stop()
	assert.True(t, d.CheckAndRecord("k1"))
	assert.True(t, d.CheckAndRecord("k1"))
	assert.True(t, d.CheckAndRecord("k1"))
}

func TestDedup_SweepRemovesExpired(t *testing.T) {
	d := New(true, 100, 30)
	defer d.Stop()
	d.CheckAndRecord("k1")
	d.CheckAndRecord("k2")
	assert.Equal(t, 2, d.GetStats().Size)
	time.Sleep(60 * time.Millisecond)
	removed := d.sweep()
	assert.Equal(t, 2, removed)
	assert.Equal(t, 0, d.GetStats().Size)
}

func TestDedup_StatsHitRate(t *testing.T) {
	d := New(true, 100, 60_000)
	defer d.Stop()
	d.CheckAndRecord("k1") // miss
	d.CheckAndRecord("k1") // hit
	d.CheckAndRecord("k1") // hit
	d.CheckAndRecord("k2") // miss
	s := d.GetStats()
	assert.Equal(t, int64(2), s.Hits)
	assert.Equal(t, int64(2), s.Misses)
	assert.InDelta(t, 0.5, s.HitRate, 1e-9)
}

func TestDedup_Clear(t *testing.T) {
	d := New(true, 100, 60_000)
	defer d.Stop()
	d.CheckAndRecord("k1")
	d.CheckAndRecord("k1")
	d.Clear()
	s := d.GetStats()
	assert.Equal(t, 0, s.Size)
	assert.Equal(t, int64(0), s.Hits)
	assert.Equal(t, int64(0), s.Misses)
	assert.True(t, d.CheckAndRecord("k1"))
}

// ---------- ComputeDedupKey ----------

func TestComputeDedupKey_PreferMessageID(t *testing.T) {
	r := ComputeDedupKey("t", []byte("raw"), map[string]any{"messageId": "abc123"})
	assert.Equal(t, "id", r.Source)
	assert.Equal(t, "id:messageId:abc123", r.Key)
}

func TestComputeDedupKey_MultipleIDFields(t *testing.T) {
	assert.Equal(t, "id:msgId:x", ComputeDedupKey("t", []byte("r"), map[string]any{"msgId": "x"}).Key)
	assert.Equal(t, "id:uuid:u", ComputeDedupKey("t", []byte("r"), map[string]any{"uuid": "u"}).Key)
	assert.Equal(t, "id:id:42", ComputeDedupKey("t", []byte("r"), map[string]any{"id": float64(42)}).Key)
	assert.Equal(t, "id:message_id:m", ComputeDedupKey("t", []byte("r"), map[string]any{"message_id": "m"}).Key)
}

func TestComputeDedupKey_MessageIDPriorityOverMsgID(t *testing.T) {
	r := ComputeDedupKey("t", []byte("r"), map[string]any{"msgId": "b", "messageId": "a"})
	assert.Equal(t, "id:messageId:a", r.Key)
}

func TestComputeDedupKey_FallbackToHash(t *testing.T) {
	r := ComputeDedupKey("sensors/x", []byte(`{"temperature":25}`), map[string]any{"temperature": float64(25)})
	assert.Equal(t, "hash", r.Source)
	assert.True(t, len(r.Key) > 2 && r.Key[:2] == "h:")
}

func TestComputeDedupKey_HashIdempotent(t *testing.T) {
	k1 := ComputeDedupKey("t", []byte("same-raw"), map[string]any{"foo": float64(1)}).Key
	k2 := ComputeDedupKey("t", []byte("same-raw"), map[string]any{"foo": float64(1)}).Key
	assert.Equal(t, k1, k2)
}

func TestComputeDedupKey_DifferentTopicOrRaw(t *testing.T) {
	k1 := ComputeDedupKey("t1", []byte("raw"), map[string]any{}).Key
	k2 := ComputeDedupKey("t2", []byte("raw"), map[string]any{}).Key
	k3 := ComputeDedupKey("t1", []byte("raw2"), map[string]any{}).Key
	assert.NotEqual(t, k1, k2)
	assert.NotEqual(t, k1, k3)
}

func TestComputeDedupKey_NilOrEmptyPayloadUsesHash(t *testing.T) {
	assert.Equal(t, "hash", ComputeDedupKey("t", []byte("r"), nil).Source)
	assert.Equal(t, "hash", ComputeDedupKey("t", []byte("r"), map[string]any{}).Source)
}

func TestComputeDedupKey_EmptyStringIDIgnored(t *testing.T) {
	r := ComputeDedupKey("t", []byte("r"), map[string]any{"messageId": ""})
	assert.Equal(t, "hash", r.Source)
}
