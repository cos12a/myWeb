// 周期自动上报纯逻辑测试：任务归一化、设备时间轴回绕、丢帧统计。
// 与具体器件无关，全部在内存中完成。
import {
  AUTO_REPORT_LIMITS,
  createReportTracker,
  deviceDeltaMs,
  formatReportBytes,
  lostFrames,
  normalizeReportTask,
} from "../src/serial/auto_report.mjs";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
}

function assertThrows(operation: () => unknown, expected: RegExp): void {
  try {
    operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.test(message)) {
      throw new Error(`错误信息不匹配：期望 ${expected}，实际 "${message}"`);
    }
    return;
  }
  throw new Error("Expected error to be thrown");
}

Deno.test("normalizeReportTask fills defaults and enforces the AR-1.0 ranges", () => {
  assertEquals(
    normalizeReportTask({
      taskId: 1,
      address: 0x5a,
      register: 0x07,
      length: 3,
      periodMs: 1000,
    }),
    {
      taskId: 1,
      address: 0x5a,
      register: 0x07,
      length: 3,
      periodMs: 1000,
      count: 0,
      flags: 0,
    },
  );
  assertEquals(AUTO_REPORT_LIMITS.length, 192);
  assertThrows(
    () =>
      normalizeReportTask({
        taskId: 0,
        address: 0x18,
        register: 0xa8,
        length: 0,
        periodMs: 100,
      }),
    /上报长度/,
  );
  assertThrows(
    () =>
      normalizeReportTask({
        taskId: 0,
        address: 0x18,
        register: 0xa8,
        length: 6,
        periodMs: 0,
      }),
    /上报周期/,
  );
  assertThrows(
    () =>
      normalizeReportTask({
        taskId: 0,
        address: 0x80,
        register: 0xa8,
        length: 6,
        periodMs: 100,
      }),
    /0x08/,
  );
});

Deno.test("deviceDeltaMs survives the u32 wrap without going negative", () => {
  assertEquals(deviceDeltaMs(1000, 1100), 100);
  // atMs 从 0xFFFF_FFF0 回绕到 0x10：真实间隔 32 ms
  assertEquals(deviceDeltaMs(0xffffffF0, 0x10), 32);
});

Deno.test("lostFrames counts sequence gaps and ignores duplicates", () => {
  assertEquals(lostFrames(null, 0), 0);
  assertEquals(lostFrames(4, 5), 0);
  assertEquals(lostFrames(4, 7), 2);
  // seq 是 u16：65534 → 1 之间丢了 65535 与 0 两帧
  assertEquals(lostFrames(0xfffe, 1), 2);
  // 重复帧（重传/回退）不记为丢帧
  assertEquals(lostFrames(7, 6), 0);
});

Deno.test("report tracker accumulates frames, losses and device interval", () => {
  const tracker = createReportTracker();
  const first = tracker.observe({
    taskId: 0,
    address: 0x18,
    seq: 0,
    atMs: 1234,
    bytes: [0x80, 0x3e, 0x00, 0x00, 0x80, 0x3e],
  });
  assertEquals(first.frames, 1);
  assertEquals(first.lost, 0);
  assertEquals(first.intervalMs, 0);

  const second = tracker.observe({
    taskId: 0,
    address: 0x18,
    seq: 3,
    atMs: 1534,
    bytes: [0x00, 0x00, 0x00, 0xc1, 0x00, 0x00],
  });
  assertEquals(second.frames, 2);
  // seq 0 → 3：中间丢 2 帧
  assertEquals(second.lost, 2);
  assertEquals(second.intervalMs, 300);
  assertEquals(formatReportBytes(second.bytes), "00 00 00 C1 00 00");

  // 另一任务独立统计
  const other = tracker.observe({
    taskId: 1,
    address: 0x5a,
    seq: 0,
    atMs: 1000,
    bytes: [0x0d, 0x2a],
  });
  assertEquals(other.frames, 1);
  assertEquals(tracker.all().length, 2);
  assertEquals(tracker.snapshot(0)?.lost, 2);
  tracker.reset();
  assertEquals(tracker.snapshot(0), null);
});
