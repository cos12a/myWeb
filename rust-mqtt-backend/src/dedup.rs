//! LRU + TTL 消息去重（对齐 go-mqtt-backend/internal/dedup）。
//!
//! 手写 `Mutex<lru::LruCache>` + TTL 判定 + evicted 计数 + sweep，
//! 以便 1:1 对齐 Go `hashicorp/golang-lru` 的行为（见 HANDOFF.md 5.5 陷阱）。

use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lru::LruCache;
use serde_json::{Map, Number, Value};
use xxhash_rust::xxh64::xxh64;

/// payload 里可能作为唯一 ID 的字段名（按固定优先级，对齐 2.7）。
pub const DEDUP_ID_FIELDS: [&str; 6] =
    ["messageId", "msgId", "message_id", "msg_id", "uuid", "id"];

/// 去重键计算结果。source ∈ {"id","hash"}。
#[derive(Debug, Clone, PartialEq)]
pub struct DedupKeyResult {
    pub key: String,
    pub source: String,
}

/// 去重统计信息（JSON 字段名逐字对齐 2.7 的 Stats）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub enabled: bool,
    pub size: usize,
    pub max_size: usize,
    pub ttl_ms: u64,
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
    pub evicted: u64,
}

/// LRU + TTL 消息去重器。线程安全，可跨任务共享（Arc）。
pub struct MessageDeduplicator {
    cache: Mutex<LruCache<String, Instant>>,
    ttl: Duration,
    enabled: bool,
    cap: usize,
    hits: AtomicU64,
    misses: AtomicU64,
    evicted: AtomicU64,
    stop_flag: AtomicBool,
    handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl MessageDeduplicator {
    /// 创建去重器。max_size<1 时强制为 1（对齐 Go 守卫）。不在此处 spawn 后台任务。
    pub fn new(enabled: bool, max_size: usize, ttl_ms: u64) -> Self {
        let cap = if max_size < 1 { 1 } else { max_size };
        MessageDeduplicator {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(cap).unwrap())),
            ttl: Duration::from_millis(ttl_ms),
            enabled,
            cap,
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            evicted: AtomicU64::new(0),
            stop_flag: AtomicBool::new(false),
            handle: Mutex::new(None),
        }
    }

    /// 启动周期 sweep 后台任务（间隔 = max(30s, ttl/2)）。仅由 main 在运行时内调用。
    pub fn spawn_sweep(self: &Arc<Self>) {
        if !self.enabled {
            return;
        }
        let interval = {
            let half = self.ttl / 2;
            if half < Duration::from_secs(30) {
                Duration::from_secs(30)
            } else {
                half
            }
        };
        let this = Arc::clone(self);
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                if this.stop_flag.load(Ordering::SeqCst) {
                    break;
                }
                this.sweep();
            }
        });
        *self.handle.lock().unwrap() = Some(handle);
    }

    /// 检查 key 是否为新消息。true=新消息（已记录）；false=重复（应丢弃）。
    /// 同步方法：加锁与计算在此完成，不跨 await 持锁（⚠️ 陷阱 7）。
    pub fn check_and_record(&self, key: &str) -> bool {
        if !self.enabled {
            return true;
        }
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap();

        // 命中路径用 get（刷新 LRU recency，⚠️ 陷阱：不能用 peek）
        let existing = cache.get(key).copied();
        if let Some(entry) = existing {
            if now.duration_since(entry) < self.ttl {
                self.hits.fetch_add(1, Ordering::SeqCst);
                return false;
            }
            // 惰性过期：移除后当新消息处理
            cache.pop(key);
        }

        // 新消息 → 记录
        let evicted = cache.put(key.to_string(), now);
        if evicted.is_some() {
            self.evicted.fetch_add(1, Ordering::SeqCst);
        }
        self.misses.fetch_add(1, Ordering::SeqCst);
        true
    }

    /// 返回当前统计快照。
    pub fn get_stats(&self) -> Stats {
        let hits = self.hits.load(Ordering::SeqCst);
        let misses = self.misses.load(Ordering::SeqCst);
        let total = hits + misses;
        let hit_rate = if total > 0 {
            let raw = hits as f64 / total as f64;
            (raw * 10000.0).round() / 10000.0
        } else {
            0.0
        };
        let size = self.cache.lock().unwrap().len();
        Stats {
            enabled: self.enabled,
            size,
            max_size: self.cap,
            ttl_ms: self.ttl.as_millis() as u64,
            hits,
            misses,
            hit_rate,
            evicted: self.evicted.load(Ordering::SeqCst),
        }
    }

    /// 停止周期 sweep 后台任务。
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.lock().unwrap().take() {
            h.abort();
        }
    }

    /// 清空缓存与计数器（测试用；亦为公开 API）。
    #[allow(dead_code)]
    pub fn clear(&self) {
        self.cache.lock().unwrap().clear();
        self.hits.store(0, Ordering::SeqCst);
        self.misses.store(0, Ordering::SeqCst);
        self.evicted.store(0, Ordering::SeqCst);
    }

    /// 清理过期条目，返回移除数量（测试直接调）。
    pub(crate) fn sweep(&self) -> usize {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap();
        let expired: Vec<String> = cache
            .iter()
            .filter(|(_, v)| now.duration_since(**v) >= self.ttl)
            .map(|(k, _)| k.clone())
            .collect();
        for k in &expired {
            cache.pop(k);
        }
        expired.len()
    }
}

/// u64 → base36 字符串（字符集 0-9a-z）；n==0 返回 "0"。手写（标准库无 base36）。
fn to_base36(mut n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out: Vec<u8> = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

/// 数字格式化：整数不带小数点（对齐 Go strconv.FormatFloat(v,'f',-1,64)）。
/// 如 42 → "42"，42.5 → "42.5"。
fn format_number(n: &Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    if let Some(f) = n.as_f64() {
        return format!("{f}"); // Rust `{}` 对 f64 输出最短十进制、无指数
    }
    String::new()
}

/// 根据 topic + 原始 payload + 解析后的对象计算去重键。
/// 优先显式 ID 字段；否则 xxhash(topic+"|"+raw) → base36。
pub fn compute_dedup_key(topic: &str, raw: &[u8], data: &Map<String, Value>) -> DedupKeyResult {
    for field in DEDUP_ID_FIELDS {
        let v = match data.get(field) {
            Some(v) => v,
            None => continue,
        };
        match v {
            Value::String(s) => {
                if !s.is_empty() {
                    return DedupKeyResult {
                        key: format!("id:{field}:{s}"),
                        source: "id".to_string(),
                    };
                }
            }
            Value::Number(n) => {
                if let Some(fv) = n.as_f64() {
                    if fv.is_finite() {
                        return DedupKeyResult {
                            key: format!("id:{field}:{}", format_number(n)),
                            source: "id".to_string(),
                        };
                    }
                }
            }
            _ => {}
        }
    }

    // fallback: xxhash(topic + "|" + raw) → base36
    let mut buf = Vec::with_capacity(topic.len() + 1 + raw.len());
    buf.extend_from_slice(topic.as_bytes());
    buf.push(b'|');
    buf.extend_from_slice(raw);
    let h = xxh64(&buf, 0);
    DedupKeyResult {
        key: format!("h:{}", to_base36(h)),
        source: "hash".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::thread::sleep;

    // ---------- MessageDeduplicator（10） ----------

    #[test]
    fn first_seen_returns_true() {
        let d = MessageDeduplicator::new(true, 100, 60_000);
        assert!(d.check_and_record("k1"));
        d.stop();
    }

    #[test]
    fn second_same_key_returns_false() {
        let d = MessageDeduplicator::new(true, 100, 60_000);
        assert!(d.check_and_record("k1"));
        assert!(!d.check_and_record("k1"));
        assert!(!d.check_and_record("k1"));
        d.stop();
    }

    #[test]
    fn different_keys_independent() {
        let d = MessageDeduplicator::new(true, 100, 60_000);
        assert!(d.check_and_record("k1"));
        assert!(d.check_and_record("k2"));
        assert!(d.check_and_record("k3"));
        assert!(!d.check_and_record("k1"));
        assert!(!d.check_and_record("k2"));
        d.stop();
    }

    #[test]
    fn lru_eviction() {
        let d = MessageDeduplicator::new(true, 3, 60_000);
        d.check_and_record("k1");
        d.check_and_record("k2");
        d.check_and_record("k3");
        // 缓存已满，插入 k4 淘汰 k1
        assert!(d.check_and_record("k4"));
        // k1 已被淘汰 → 新消息
        assert!(d.check_and_record("k1"));
        // k2 也被淘汰
        assert!(d.check_and_record("k2"));
        d.stop();
    }

    #[test]
    fn hit_refreshes_recency() {
        let d = MessageDeduplicator::new(true, 3, 60_000);
        d.check_and_record("k1");
        d.check_and_record("k2");
        d.check_and_record("k3");
        // 命中 k1 → k1 变最近使用
        assert!(!d.check_and_record("k1"));
        // 插入 k4 → 淘汰 k2（现在最旧）
        d.check_and_record("k4");
        // k1 仍在缓存
        assert!(!d.check_and_record("k1"));
        // k2 已被淘汰
        assert!(d.check_and_record("k2"));
        d.stop();
    }

    #[test]
    fn ttl_expiry() {
        let d = MessageDeduplicator::new(true, 100, 50);
        assert!(d.check_and_record("k1"));
        assert!(!d.check_and_record("k1"));
        sleep(Duration::from_millis(80));
        assert!(d.check_and_record("k1"));
        d.stop();
    }

    #[test]
    fn disabled_always_true() {
        let d = MessageDeduplicator::new(false, 100, 60_000);
        assert!(d.check_and_record("k1"));
        assert!(d.check_and_record("k1"));
        assert!(d.check_and_record("k1"));
        d.stop();
    }

    #[test]
    fn sweep_removes_expired() {
        let d = MessageDeduplicator::new(true, 100, 30);
        d.check_and_record("k1");
        d.check_and_record("k2");
        assert_eq!(2, d.get_stats().size);
        sleep(Duration::from_millis(60));
        let removed = d.sweep();
        assert_eq!(2, removed);
        assert_eq!(0, d.get_stats().size);
        d.stop();
    }

    #[test]
    fn stats_hit_rate() {
        let d = MessageDeduplicator::new(true, 100, 60_000);
        d.check_and_record("k1"); // miss
        d.check_and_record("k1"); // hit
        d.check_and_record("k1"); // hit
        d.check_and_record("k2"); // miss
        let s = d.get_stats();
        assert_eq!(2, s.hits);
        assert_eq!(2, s.misses);
        assert!((0.5 - s.hit_rate).abs() < 1e-9);
        d.stop();
    }

    #[test]
    fn clear() {
        let d = MessageDeduplicator::new(true, 100, 60_000);
        d.check_and_record("k1");
        d.check_and_record("k1");
        d.clear();
        let s = d.get_stats();
        assert_eq!(0, s.size);
        assert_eq!(0, s.hits);
        assert_eq!(0, s.misses);
        assert!(d.check_and_record("k1"));
        d.stop();
    }

    // ---------- compute_dedup_key（8） ----------

    #[test]
    fn prefer_message_id() {
        let data = json!({"messageId": "abc123"});
        let r = compute_dedup_key("t", b"raw", data.as_object().unwrap());
        assert_eq!("id", r.source);
        assert_eq!("id:messageId:abc123", r.key);
    }

    #[test]
    fn multiple_id_fields() {
        let m = |v: Value| v.as_object().unwrap().clone();
        assert_eq!(
            "id:msgId:x",
            compute_dedup_key("t", b"r", &m(json!({"msgId": "x"}))).key
        );
        assert_eq!(
            "id:uuid:u",
            compute_dedup_key("t", b"r", &m(json!({"uuid": "u"}))).key
        );
        assert_eq!(
            "id:id:42",
            compute_dedup_key("t", b"r", &m(json!({"id": 42}))).key
        );
        assert_eq!(
            "id:message_id:m",
            compute_dedup_key("t", b"r", &m(json!({"message_id": "m"}))).key
        );
    }

    #[test]
    fn message_id_priority_over_msg_id() {
        let data = json!({"msgId": "b", "messageId": "a"});
        let r = compute_dedup_key("t", b"r", data.as_object().unwrap());
        assert_eq!("id:messageId:a", r.key);
    }

    #[test]
    fn fallback_to_hash() {
        let data = json!({"temperature": 25});
        let r = compute_dedup_key("sensors/x", br#"{"temperature":25}"#, data.as_object().unwrap());
        assert_eq!("hash", r.source);
        assert!(r.key.len() > 2 && r.key.starts_with("h:"));
    }

    #[test]
    fn hash_idempotent() {
        let data = json!({"foo": 1});
        let k1 = compute_dedup_key("t", b"same-raw", data.as_object().unwrap()).key;
        let k2 = compute_dedup_key("t", b"same-raw", data.as_object().unwrap()).key;
        assert_eq!(k1, k2);
    }

    #[test]
    fn different_topic_or_raw() {
        let empty = json!({});
        let k1 = compute_dedup_key("t1", b"raw", empty.as_object().unwrap()).key;
        let k2 = compute_dedup_key("t2", b"raw", empty.as_object().unwrap()).key;
        let k3 = compute_dedup_key("t1", b"raw2", empty.as_object().unwrap()).key;
        assert_ne!(k1, k2);
        assert_ne!(k1, k3);
    }

    #[test]
    fn nil_or_empty_payload_uses_hash() {
        let empty = json!({});
        assert_eq!(
            "hash",
            compute_dedup_key("t", b"r", empty.as_object().unwrap()).source
        );
    }

    #[test]
    fn empty_string_id_ignored() {
        let data = json!({"messageId": ""});
        let r = compute_dedup_key("t", b"r", data.as_object().unwrap());
        assert_eq!("hash", r.source);
    }

    // ---------- base36 辅助 ----------

    #[test]
    fn base36_zero_and_roundtrip() {
        assert_eq!("0", to_base36(0));
        assert_eq!("1", to_base36(1));
        assert_eq!("z", to_base36(35));
        assert_eq!("10", to_base36(36));
    }
}
