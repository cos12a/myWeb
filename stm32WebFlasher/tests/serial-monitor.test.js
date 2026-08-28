import test from "node:test";
import assert from "node:assert/strict";
import { SerialMonitor } from "../src/serial-monitor.js";

// 模拟传输层：只实现 setDataListener，用于把数据块喂给监听器
function makeTransport() {
  let listener = null;
  return {
    setDataListener(cb) {
      listener = typeof cb === "function" ? cb : null;
    },
    emit(chunk) {
      if (listener) listener(new Uint8Array(chunk));
    },
    hasListener() {
      return listener !== null;
    },
  };
}

test("超过批量阈值时输出一次", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
    mode: "text",
  });

  transport.emit([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" 5 个字符，未超过阈值
  assert.deepEqual(lines, []);

  transport.emit([0x0a]); // 第 6 个字符，超过阈值，批量输出
  assert.deepEqual(lines, ["Hello<0a>"]);
});

test("小于阈值时缓存不输出", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
    mode: "text",
  });

  transport.emit([0x68, 0x69]); // "hi" 2 个字符
  assert.deepEqual(lines, []);
});

test("flush 立即输出未达阈值的缓冲", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
    mode: "text",
  });

  transport.emit([0x68, 0x69]); // "hi"
  monitor.flush();
  assert.deepEqual(lines, ["hi"]);
});

test("编程期间暂停监听，结束后恢复", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
    mode: "text",
  });

  monitor.setProgramming(true);
  transport.emit([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x0a]); // "ABCDEF\n" 编程中不应输出
  assert.deepEqual(lines, []);

  monitor.setProgramming(false);
  transport.emit([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x0a]); // 恢复后输出
  assert.deepEqual(lines, ["ABCDEF<0a>"]);
});

test("监听关闭时静默", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: false,
    flushSize: 1,
    mode: "text",
  });

  transport.emit([0x41, 0x0a]);
  assert.deepEqual(lines, []);
});

test("控制字符转义为 <hex> 标记", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 1,
    mode: "text",
  });

  transport.emit([0x61, 0x0d, 0x0a]); // "a\r\n" 超过阈值 1，立即输出
  assert.deepEqual(lines, ["a<0d><0a>"]);
});

test("跨 chunk 的多字节 UTF-8 正确拼接", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 1,
    mode: "text",
  });

  // "你好" 的 UTF-8 编码拆成两段喂入
  transport.emit([0xe4, 0xbd]);
  transport.emit([0xa0, 0xe5, 0xa5, 0xbd]);

  assert.deepEqual(lines, ["你好"]);
});

test("setFlushSize 调整批量阈值", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
    mode: "text",
  });

  transport.emit([0x61, 0x62, 0x63]); // "abc" 3 个字符，未超过 5
  assert.deepEqual(lines, []);

  monitor.setFlushSize(2);
  transport.emit([0x64]); // "d"，缓冲 "abcd" 4 个字符，超过 2
  assert.deepEqual(lines, ["abcd"]);
});

test("默认 hex 模式按批量输出 [HEX] 数据", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
  });

  transport.emit([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // 5 字节，阈值 5*3=15，未超过
  assert.deepEqual(lines, []);

  transport.emit([0x0a]); // 追加 0A，总长 17 > 15
  assert.deepEqual(lines, ["[HEX] 48 65 6C 6C 6F 0A"]);
});

test("hex 模式 flush 立即输出十六进制缓冲", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
  });

  transport.emit([0x68, 0x69]); // "hi" -> "68 69"
  monitor.flush();
  assert.deepEqual(lines, ["[HEX] 68 69"]);
});

test("onData 回调收到原始字节", () => {
  const received = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: () => {},
    enabled: true,
    onData: (bytes) => received.push(Array.from(bytes)),
  });

  transport.emit([0x41, 0x42]);
  assert.deepEqual(received, [[0x41, 0x42]]);
});

test("detach 后不再输出", () => {
  const lines = [];
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: (text) => lines.push(text),
    enabled: true,
    mode: "text",
  });

  monitor.detach();
  transport.emit([0x41, 0x0a]);

  assert.deepEqual(lines, []);
  assert.equal(transport.hasListener(), false);
});

test("编程开始从传输层摘除监听器，结束后重新挂接", () => {
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: () => {},
    enabled: true,
  });

  assert.equal(transport.hasListener(), true);

  monitor.setProgramming(true);
  assert.equal(transport.hasListener(), false); // 数据流交还编程接口

  monitor.setProgramming(false);
  assert.equal(transport.hasListener(), true); // 恢复监听
});

test("关闭监听时从传输层摘除监听器，重新开启后挂接", () => {
  const transport = makeTransport();
  const monitor = new SerialMonitor({
    transport,
    log: () => {},
    enabled: true,
  });

  monitor.setEnabled(false);
  assert.equal(transport.hasListener(), false);

  monitor.setEnabled(true);
  assert.equal(transport.hasListener(), true);
});

test("attach 新传输层时丢弃上次会话残留的未换行残片", () => {
  const lines = [];
  const first = makeTransport();
  const monitor = new SerialMonitor({
    transport: first,
    log: (text) => lines.push(text),
    enabled: true,
    flushSize: 5,
    mode: "text",
  });

  first.emit([0x68, 0x69]); // "hi"（未达阈值，成为残片）
  const second = makeTransport();
  monitor.attach(second);

  second.emit([0x41, 0x42, 0x43, 0x44, 0x45, 0x46]); // "ABCDEF" 6 个字符，超过阈值
  assert.deepEqual(lines, ["ABCDEF"]); // 不含旧残片 "hi"
});
