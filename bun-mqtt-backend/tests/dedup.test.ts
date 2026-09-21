import { describe, expect, test } from "bun:test";
import {
  MessageDeduplicator,
  computeDedupKey,
} from "../src/dedup";

describe("MessageDeduplicator", () => {
  test("首次出现返回 true（应处理）", () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 60_000 });
    expect(d.checkAndRecord("k1")).toBe(true);
  });

  test("第二次相同 key 返回 false（重复）", () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 60_000 });
    expect(d.checkAndRecord("k1")).toBe(true);
    expect(d.checkAndRecord("k1")).toBe(false);
    expect(d.checkAndRecord("k1")).toBe(false);
  });

  test("不同 key 互不干扰", () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 60_000 });
    expect(d.checkAndRecord("k1")).toBe(true);
    expect(d.checkAndRecord("k2")).toBe(true);
    expect(d.checkAndRecord("k3")).toBe(true);
    expect(d.checkAndRecord("k1")).toBe(false);
    expect(d.checkAndRecord("k2")).toBe(false);
  });

  test("达到 maxSize 时按 LRU 淘汰最旧条目", () => {
    const d = new MessageDeduplicator({ maxSize: 3, ttlMs: 60_000 });
    d.checkAndRecord("k1");
    d.checkAndRecord("k2");
    d.checkAndRecord("k3");
    // 缓存已满，插入 k4 时应淘汰 k1
    expect(d.checkAndRecord("k4")).toBe(true);
    // k1 已被淘汰，再来一次应视为新消息
    expect(d.checkAndRecord("k1")).toBe(true);
    // k2 应该也被淘汰了（因为 k1 淘汰后 k2 变最旧，插入 k1 又淘汰 k2）
    expect(d.checkAndRecord("k2")).toBe(true);
  });

  test("命中会刷新 LRU 位置（近期使用的不会被淘汰）", () => {
    const d = new MessageDeduplicator({ maxSize: 3, ttlMs: 60_000 });
    d.checkAndRecord("k1");
    d.checkAndRecord("k2");
    d.checkAndRecord("k3");
    // 命中 k1 → k1 变成最近使用
    expect(d.checkAndRecord("k1")).toBe(false);
    // 插入 k4 → 淘汰 k2（现在最旧）
    d.checkAndRecord("k4");
    // k1 应该还在缓存里
    expect(d.checkAndRecord("k1")).toBe(false);
    // k2 应该已被淘汰
    expect(d.checkAndRecord("k2")).toBe(true);
  });

  test("TTL 过期后同 key 视为新消息", async () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 50 });
    expect(d.checkAndRecord("k1")).toBe(true);
    expect(d.checkAndRecord("k1")).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(d.checkAndRecord("k1")).toBe(true);
  });

  test("disabled 时永远返回 true", () => {
    const d = new MessageDeduplicator({ enabled: false });
    expect(d.checkAndRecord("k1")).toBe(true);
    expect(d.checkAndRecord("k1")).toBe(true);
    expect(d.checkAndRecord("k1")).toBe(true);
  });

  test("sweep() 清理过期条目", async () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 30 });
    d.checkAndRecord("k1");
    d.checkAndRecord("k2");
    expect(d.getStats().size).toBe(2);
    await new Promise((r) => setTimeout(r, 60));
    const removed = d.sweep();
    expect(removed).toBe(2);
    expect(d.getStats().size).toBe(0);
  });

  test("getStats 返回正确的命中率", () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 60_000 });
    d.checkAndRecord("k1");  // miss
    d.checkAndRecord("k1");  // hit
    d.checkAndRecord("k1");  // hit
    d.checkAndRecord("k2");  // miss
    const s = d.getStats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(2);
    expect(s.hitRate).toBeCloseTo(0.5);
  });

  test("clear() 重置所有状态", () => {
    const d = new MessageDeduplicator({ maxSize: 100, ttlMs: 60_000 });
    d.checkAndRecord("k1");
    d.checkAndRecord("k1");
    d.clear();
    const s = d.getStats();
    expect(s.size).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    // clear 之后同 key 又变成新消息
    expect(d.checkAndRecord("k1")).toBe(true);
  });
});

describe("computeDedupKey", () => {
  test("优先使用 messageId 字段", () => {
    const r = computeDedupKey("t", "raw", { messageId: "abc123" });
    expect(r.source).toBe("id");
    expect(r.key).toBe("id:messageId:abc123");
  });

  test("按优先级尝试多个 ID 字段", () => {
    expect(computeDedupKey("t", "r", { msgId: "x" }).key).toBe("id:msgId:x");
    expect(computeDedupKey("t", "r", { uuid: "u" }).key).toBe("id:uuid:u");
    expect(computeDedupKey("t", "r", { id: 42 }).key).toBe("id:id:42");
    expect(computeDedupKey("t", "r", { message_id: "m" }).key).toBe("id:message_id:m");
  });

  test("messageId 优先于 msgId", () => {
    const r = computeDedupKey("t", "r", { msgId: "b", messageId: "a" });
    expect(r.key).toBe("id:messageId:a");
  });

  test("无 ID 字段时回退到 hash", () => {
    const r = computeDedupKey("sensors/x", '{"temperature":25}', { temperature: 25 });
    expect(r.source).toBe("hash");
    expect(r.key.startsWith("h:")).toBe(true);
  });

  test("相同 topic+raw 产生相同 hash key（幂等）", () => {
    const k1 = computeDedupKey("t", "same-raw", { foo: 1 }).key;
    const k2 = computeDedupKey("t", "same-raw", { foo: 1 }).key;
    expect(k1).toBe(k2);
  });

  test("不同 topic 或 raw 产生不同 hash key", () => {
    const k1 = computeDedupKey("t1", "raw", {}).key;
    const k2 = computeDedupKey("t2", "raw", {}).key;
    const k3 = computeDedupKey("t1", "raw2", {}).key;
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  test("空对象 / 非对象 payload 走 hash", () => {
    expect(computeDedupKey("t", "r", null).source).toBe("hash");
    expect(computeDedupKey("t", "r", undefined).source).toBe("hash");
    expect(computeDedupKey("t", "r", "string").source).toBe("hash");
    expect(computeDedupKey("t", "r", 42).source).toBe("hash");
  });

  test("空字符串 ID 会被忽略，回退到 hash", () => {
    const r = computeDedupKey("t", "r", { messageId: "" });
    expect(r.source).toBe("hash");
  });
});
