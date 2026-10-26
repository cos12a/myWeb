// 周期自动上报（REPORT_*，AR-1.0）纯逻辑：任务归一化、设备时间轴、丢帧统计。
// 不触碰浏览器 API，便于 Deno 直接测试；协议见 docs/AUTO_REPORT_PROTOCOL.md。

/** 与 lwpkt.mjs 的 REPORT_LIMITS 对齐，另补周期/计数的软范围。 */
export const AUTO_REPORT_LIMITS = {
  tasks: 16,
  length: 192,
  periodMinMs: 1,
  periodMaxMs: 60_000,
  countMax: 0xffff,
};

/** REPORT_START / REPORT_STOP 的「全部任务」编号。 */
export const AUTO_REPORT_ALL = 0xff;

function requireInt(value, label, min, max, range = `${min}–${max}`) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label}必须为 ${range} 的整数。`);
  }
  return value;
}

/**
 * 归一化一个上报任务：补齐 count/flags 默认值并做范围校验。
 * 越界立即抛 RangeError，避免发一帧才被固件拒绝。
 * @param {object} [task]
 */
export function normalizeReportTask(task = {}) {
  const {
    taskId = 0,
    address,
    register,
    length,
    periodMs,
    count = 0,
    flags = 0,
  } = task;
  requireInt(taskId, "上报任务编号", 0, 0xff);
  requireInt(address, "I²C 地址", 0x08, 0x77, "0x08–0x77");
  requireInt(register, "寄存器子地址", 0, 0xff, "0x00–0xFF");
  requireInt(length, "上报长度", 1, AUTO_REPORT_LIMITS.length);
  requireInt(
    periodMs,
    "上报周期（ms）",
    AUTO_REPORT_LIMITS.periodMinMs,
    AUTO_REPORT_LIMITS.periodMaxMs,
  );
  requireInt(count, "帧数上限", 0, AUTO_REPORT_LIMITS.countMax);
  requireInt(flags, "能力位", 0, 0xff, "0x00–0xFF");
  return { taskId, address, register, length, periodMs, count, flags };
}

/**
 * 设备时间轴差值：atMs 是 u32，约 49.7 天回绕一次；
 * 用无符号差值仍能得到真实采样间隔，不要改用主机到达时间。
 */
export function deviceDeltaMs(previousAtMs, atMs) {
  return (atMs - previousAtMs) >>> 0;
}

/**
 * 相邻 seq 之间丢掉的帧数；首帧、重复帧与乱序帧返回 0。
 * seq 是 u16，回绕在 65535 → 0，不能用 32 位差值。
 */
export function lostFrames(previousSeq, seq) {
  if (previousSeq === null || previousSeq === undefined) return 0;
  const gap = (seq - previousSeq) & 0xffff;
  // 差值落在后半区（≥0x8000）视为重传 / 乱序，不记丢帧
  return gap > 1 && gap < 0x8000 ? gap - 1 : 0;
}

/** 原始字节转 UI 用的十六进制串（大写、空格分隔）。 */
export function formatReportBytes(bytes) {
  return bytes
    .map((value) => value.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

/**
 * 按 taskId 汇总上报帧：帧数、丢帧、设备侧间隔与最近一次数据。
 * 只依赖帧自带字段（seq/atMs），因此与具体器件无关。
 */
export function createReportTracker() {
  const tasks = new Map();
  return {
    observe(frame) {
      const previous = tasks.get(frame.taskId);
      const next = {
        taskId: frame.taskId,
        address: frame.address,
        seq: frame.seq,
        atMs: frame.atMs,
        bytes: [...frame.bytes],
        frames: (previous?.frames ?? 0) + 1,
        lost: (previous?.lost ?? 0) + lostFrames(previous?.seq, frame.seq),
        intervalMs: previous ? deviceDeltaMs(previous.atMs, frame.atMs) : 0,
      };
      tasks.set(frame.taskId, next);
      return next;
    },
    snapshot(taskId) {
      return tasks.get(taskId) ?? null;
    },
    all() {
      return [...tasks.values()];
    },
    reset() {
      tasks.clear();
    },
  };
}
