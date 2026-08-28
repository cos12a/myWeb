// =====================================================
// AutoTrigger — 串口数据触发自动编程
// 监听特定模式两次，满足间隔条件后触发回调（例如开始烧录）
// 支持状态管理、启用/禁用、编程期间暂停。
// =====================================================

/**
 * 创建自动触发器
 * @param {Object} options
 * @param {Uint8Array} options.pattern - 要匹配的字节模式
 * @param {number} [options.minInterval=800] - 两次匹配最小间隔（毫秒）
 * @param {number} [options.maxInterval=1200] - 两次匹配最大间隔（毫秒）
 * @param {number} [options.timeout=3000] - 第一次匹配后超时重置（毫秒）
 * @param {number} [options.triggerDelay=6000] - 触发成功后延迟执行回调（毫秒）
 * @param {Function} options.onTrigger - 触发后执行的回调函数
 * @param {Function} [options.log] - 日志输出函数（可选）
 * @returns {Object} 触发器实例
 */
export function createAutoTrigger({
  pattern,
  minInterval = 500,
  maxInterval = 1500,
  timeout = 3000,
  triggerDelay = 6000,
  onTrigger,
  log = console.log,
}) {
  // 参数校验
  if (!pattern || !(pattern instanceof Uint8Array) || pattern.length === 0) {
    throw new Error("pattern must be a non-empty Uint8Array");
  }
  if (typeof onTrigger !== "function") {
    throw new Error("onTrigger must be a function");
  }

  // 状态变量
  let enabled = true; // 总开关
  let paused = false; // 编程期间暂停
  let state = "idle"; // 'idle' | 'waiting_second'
  let firstMatchTime = 0;
  let timeoutTimer = null;
  let triggerTimer = null;
  let buffer = []; // 用于跨块匹配的滑动窗口

  // 辅助函数：比较两个 Uint8Array 是否相等
  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // 检测 buffer 中是否包含 pattern（从末尾向前滑动）
  function detectPattern(bufferArray, patternArray) {
    const bufLen = bufferArray.length;
    const patLen = patternArray.length;
    if (bufLen < patLen) return false;
    for (let i = bufLen - patLen; i >= 0; i--) {
      const slice = bufferArray.slice(i, i + patLen);
      if (arraysEqual(slice, patternArray)) {
        return true;
      }
    }
    return false;
  }

  // 重置触发器状态（不清除 enabled/paused）
  function resetState() {
    state = "idle";
    firstMatchTime = 0;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (triggerTimer) {
      clearTimeout(triggerTimer);
      triggerTimer = null;
    }
    buffer = [];
  }

  // 内部日志
  function logInfo(message, level = "info") {
    if (log) log(`[AutoTrigger] ${message}`, level);
  }

  // 处理串口数据（由外部调用）
  function onData(bytes) {
    // 检查是否启用或暂停
    if (!enabled || paused) return;

    // 将字节追加到缓冲区
    const newBytes =
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (newBytes.length === 0) return;
    buffer.push(...newBytes);
    // 限制缓冲区大小（防止无限增长，保留至少模式长度 + 一些余量）
    const maxBuffer = pattern.length * 2 + 16;
    if (buffer.length > maxBuffer) {
      buffer = buffer.slice(-maxBuffer);
    }

    // 检测是否包含模式
    if (!detectPattern(buffer, pattern)) {
      return; // 没有匹配，继续等待
    }

    // 匹配成功，根据当前状态处理
    if (state === "idle") {
      // 第一次匹配
      firstMatchTime = Date.now();
      state = "waiting_second";
      logInfo(
        `第一次匹配，等待第二次（需在 ${minInterval}~${maxInterval}ms 内）`,
        "warn",
      );

      // 清空缓冲区，避免同一数据重复匹配
      buffer = [];

      // 设置超时定时器
      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        logInfo(`等待第二次超时（${timeout}ms），重置状态`, "warn");
        resetState();
      }, timeout);
    } else if (state === "waiting_second") {
      // 第二次匹配
      const now = Date.now();
      const delta = now - firstMatchTime;

      // 清除超时定时器
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      // 检查间隔是否合法
      if (delta >= minInterval && delta <= maxInterval) {
        logInfo(
          `第二次匹配成功，间隔 ${delta}ms，将在 ${triggerDelay}ms 后触发`,
          "success",
        );
        // 重置状态，防止重复触发
        resetState();

        // 延迟执行触发回调
        if (triggerTimer) clearTimeout(triggerTimer);
        triggerTimer = setTimeout(() => {
          triggerTimer = null;
          logInfo("触发条件满足，执行 onTrigger", "info");
          // 调用外部回调，并传递可用的取消标识（可选）
          onTrigger();
        }, triggerDelay);
      } else {
        logInfo(`第二次匹配间隔 ${delta}ms 不在预期范围，重置状态`, "warn");
        resetState();
        // 注意：本次匹配的数据已消耗，我们已清空缓冲区，等待新数据
      }
    }
  }

  // 启用/禁用触发器
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
      // 禁用时清除所有定时器并重置状态
      resetState();
    }
  }

  // 暂停/恢复（编程期间使用）
  function setPaused(value) {
    paused = Boolean(value);
    if (paused) {
      // 暂停时清除挂起的定时器，但保留状态（可选择不清除状态）
      // 但根据业务逻辑，编程开始后应当重置状态，避免残留影响
      resetState();
    }
  }

  // 完全重置（包括启用状态）
  function reset() {
    resetState();
    enabled = true;
    paused = false;
  }

  // 返回控制接口
  return {
    onData,
    setEnabled,
    setPaused,
    reset,
    getState: () => ({ state, enabled, paused }),
  };
}

export default createAutoTrigger;
