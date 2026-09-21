/**
 * 应用层消息去重（LRU + TTL）。
 *
 * 使用场景：
 *   1. MQTT QoS 1/2 可能重复投递同一条消息
 *   2. 传感器可能因网络重发多次上报同一读数
 *   3. payload 不带 timestamp 时，InfluxDB 内置去重无法生效
 *
 * 去重键策略（优先级从高到低）：
 *   ① payload 显式 ID 字段：messageId / msgId / message_id / msg_id / uuid / id
 *   ② Bun.hash(topic + "|" + rawPayload) —— 快速非加密哈希（wyhash）
 *
 * 内存控制：
 *   - maxSize：缓存条目上限（默认 10000）
 *   - ttlMs：单条记录存活时间（默认 5 分钟）
 *   - 双重淘汰：命中 TTL 时惰性删除 + 达到 maxSize 时按插入序淘汰最旧
 */

export interface DedupOptions {
  maxSize?: number;
  ttlMs?: number;
  enabled?: boolean;
}

export interface DedupStats {
  enabled: boolean;
  size: number;
  maxSize: number;
  ttlMs: number;
  hits: number;
  misses: number;
  hitRate: number;
  evicted: number;
}

export class MessageDeduplicator {
  /** key → 过期时间戳（ms）；Map 保留插入顺序，天然可做 LRU */
  private readonly cache = new Map<string, number>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly enabled: boolean;

  private hits = 0;
  private misses = 0;
  private evicted = 0;

  constructor(opts: DedupOptions = {}) {
    this.maxSize = opts.maxSize ?? 10_000;
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 检查是否为重复消息。
   * @returns true = 新消息（应处理）；false = 重复（应丢弃）
   */
  checkAndRecord(key: string): boolean {
    if (!this.enabled) return true;

    const now = Date.now();
    const existing = this.cache.get(key);

    if (existing !== undefined) {
      if (existing > now) {
        // 命中且未过期 → 刷新 LRU 位置
        this.cache.delete(key);
        this.cache.set(key, existing);
        this.hits++;
        return false;
      }
      // 命中但已过期 → 视为新消息
      this.cache.delete(key);
    }

    // 达到上限时淘汰最旧（Map.keys() 首个）
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
      this.evicted++;
    }

    this.cache.set(key, now + this.ttlMs);
    this.misses++;
    return true;
  }

  /** 惰性清理所有已过期条目（可在定时器里周期调用） */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, expireAt] of this.cache) {
      if (expireAt <= now) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getStats(): DedupStats {
    const total = this.hits + this.misses;
    return {
      enabled: this.enabled,
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evicted: this.evicted,
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evicted = 0;
  }
}

/** payload 里可能作为唯一 ID 的字段名（按优先级） */
const ID_FIELDS = ["messageId", "msgId", "message_id", "msg_id", "uuid", "id"] as const;

/**
 * 根据 topic + 原始 payload + 解析后的对象，计算去重键。
 * - 优先使用 payload 里的显式 ID
 * - 否则用 Bun.hash 快速哈希（wyhash，非加密但足够抗碰撞）
 */
export function computeDedupKey(
  topic: string,
  raw: string,
  data: unknown,
): { key: string; source: "id" | "hash" } {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const field of ID_FIELDS) {
      const v = obj[field];
      if (typeof v === "string" && v.length > 0) {
        return { key: `id:${field}:${v}`, source: "id" };
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        return { key: `id:${field}:${v}`, source: "id" };
      }
    }
  }
  // Bun.hash 返回 bigint（wyhash 64-bit），转 36 进制字符串缩短 key 长度
  const h = Bun.hash(topic + "|" + raw).toString(36);
  return { key: `h:${h}`, source: "hash" };
}
