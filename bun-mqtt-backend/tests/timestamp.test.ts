import { describe, expect, test } from "bun:test";
import {
  detectTimestampUnit,
  normalizeToNanoseconds,
} from "../src/utils/timestamp";

describe("detectTimestampUnit", () => {
  test("识别秒级时间戳（10 位数）", () => {
    expect(detectTimestampUnit(1_758_470_400)).toBe("s");       // 2025-09-21 in seconds
    expect(detectTimestampUnit(1)).toBe("s");
    expect(detectTimestampUnit(9.9e10)).toBe("s");
  });

  test("识别毫秒级时间戳（13 位数）", () => {
    expect(detectTimestampUnit(1_758_470_400_000)).toBe("ms");
    expect(detectTimestampUnit(Date.now())).toBe("ms");
    expect(detectTimestampUnit(1e11)).toBe("ms");
  });

  test("识别微秒级时间戳（16 位数）", () => {
    expect(detectTimestampUnit(1_758_470_400_000_000)).toBe("us");
    expect(detectTimestampUnit(1e14)).toBe("us");
  });

  test("识别纳秒级时间戳（19 位数）", () => {
    expect(detectTimestampUnit(1_758_470_400_000_000_000)).toBe("ns");
    expect(detectTimestampUnit(1e17)).toBe("ns");
  });

  test("非法输入返回 invalid", () => {
    expect(detectTimestampUnit(0)).toBe("invalid");
    expect(detectTimestampUnit(-1)).toBe("invalid");
    expect(detectTimestampUnit(Number.NaN)).toBe("invalid");
    expect(detectTimestampUnit(Number.POSITIVE_INFINITY)).toBe("invalid");
  });
});

describe("normalizeToNanoseconds", () => {
  test("秒 → 纳秒", () => {
    const r = normalizeToNanoseconds(1_758_470_400);
    expect(r.unit).toBe("s");
    expect(r.usedFallback).toBe(false);
    expect(r.nanos).toBe(1_758_470_400_000_000_000);
  });

  test("毫秒 → 纳秒", () => {
    const r = normalizeToNanoseconds(1_758_470_400_000);
    expect(r.unit).toBe("ms");
    expect(r.nanos).toBe(1_758_470_400_000_000_000);
  });

  test("微秒 → 纳秒", () => {
    const r = normalizeToNanoseconds(1_758_470_400_000_000);
    expect(r.unit).toBe("us");
    expect(r.nanos).toBe(1_758_470_400_000_000_000);
  });

  test("纳秒 → 纳秒（保持不变）", () => {
    const r = normalizeToNanoseconds(1_758_470_400_000_000_000);
    expect(r.unit).toBe("ns");
    expect(r.nanos).toBe(1_758_470_400_000_000_000);
  });

  test("undefined → fallback 到当前时间", () => {
    const before = Date.now() * 1_000_000;
    const r = normalizeToNanoseconds(undefined);
    const after = Date.now() * 1_000_000;
    expect(r.usedFallback).toBe(true);
    expect(r.unit).toBe("invalid");
    expect(r.nanos).toBeGreaterThanOrEqual(before);
    expect(r.nanos).toBeLessThanOrEqual(after);
  });

  test("null → fallback", () => {
    const r = normalizeToNanoseconds(null);
    expect(r.usedFallback).toBe(true);
  });

  test("负数 → fallback", () => {
    const r = normalizeToNanoseconds(-100);
    expect(r.usedFallback).toBe(true);
  });

  test("四种单位归一化后应相等（同一时刻）", () => {
    const seconds = 1_758_470_400;
    const expected = 1_758_470_400_000_000_000;
    expect(normalizeToNanoseconds(seconds).nanos).toBe(expected);
    expect(normalizeToNanoseconds(seconds * 1e3).nanos).toBe(expected);
    expect(normalizeToNanoseconds(seconds * 1e6).nanos).toBe(expected);
    expect(normalizeToNanoseconds(seconds * 1e9).nanos).toBe(expected);
  });
});
