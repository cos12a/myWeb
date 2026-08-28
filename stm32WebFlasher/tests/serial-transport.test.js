import test from "node:test";
import assert from "node:assert/strict";
import {
  SerialTransport,
  bootloaderEntryStages,
  enterBootloader,
  resetToRun,
} from "../src/serial-transport.js";

// 模拟 Web Serial 端口：readable 为可读流，其余为异步桩
function makeFakePort(readable) {
  return {
    readable,
    writable: {
      getWriter() {
        return {
          write: async () => {},
          close: async () => {},
          releaseLock: () => {},
        };
      },
    },
    open: async () => {},
    close: async () => {},
    setSignals: async () => {},
  };
}

function erroringStream(message = "device unplugged") {
  return new ReadableStream({
    start(controller) {
      controller.error(new Error(message));
    },
  });
}

function neverEndingStream() {
  return new ReadableStream({
    pull() {}, // 永不入队
  });
}

test("bootloaderEntryStages returns CH340X direct preset", () => {
  const stages = bootloaderEntryStages("ch340x");

  assert.deepEqual(stages, [
    {
      name: "CH340X 直连电路",
      config: "ch340x",
    },
  ]);
});

test("bootloaderEntryStages keeps normal modes single-stage", () => {
  assert.deepEqual(bootloaderEntryStages("dtr-low-rts-high"), [
    { name: "default", config: "dtr-low-rts-high" },
  ]);
});

test("enterBootloader applies CH340X direct timing", async () => {
  const calls = [];
  const transport = {
    async setSignals(signals) {
      calls.push(["signals", signals]);
    },
  };

  await enterBootloader(
    transport,
    async (ms) => calls.push(["delay", ms]),
    "ch340x",
  );

  assert.deepEqual(calls, [
    ["signals", { requestToSend: false, dataTerminalReady: true }],
    ["delay", 150],
    ["signals", { requestToSend: true, dataTerminalReady: true }],
    ["delay", 150],
    ["signals", { requestToSend: true, dataTerminalReady: false }],
    ["delay", 150],
    ["signals", { requestToSend: true, dataTerminalReady: true }],
    ["delay", 1000],
  ]);
});

test("enterBootloader applies generic BOOT/RESET preset", async () => {
  const calls = [];
  const transport = {
    async setSignals(signals) {
      calls.push(["signals", signals]);
    },
  };

  await enterBootloader(
    transport,
    async (ms) => calls.push(["delay", ms]),
    "boot-dtr-high-reset-rts-low",
  );

  assert.deepEqual(calls, [
    ["signals", { dataTerminalReady: false }],
    ["delay", 100],
    ["signals", { requestToSend: true }],
    ["delay", 100],
    ["signals", { requestToSend: false }],
    ["delay", 800],
  ]);
});

test("resetToRun applies CH340X run timing", async () => {
  const calls = [];
  const transport = {
    async setSignals(signals) {
      calls.push(["signals", signals]);
    },
  };

  await resetToRun(
    transport,
    async (ms) => calls.push(["delay", ms]),
    "ch340x",
  );

  assert.deepEqual(calls, [
    ["signals", { requestToSend: false, dataTerminalReady: false }],
    ["delay", 250],
    ["signals", { requestToSend: false, dataTerminalReady: true }],
    ["delay", 250],
    ["signals", { requestToSend: false, dataTerminalReady: false }],
    ["delay", 1000],
  ]);
});

test("读错误时触发 onDisconnect 回调", async () => {
  const transport = new SerialTransport(
    makeFakePort(erroringStream()),
    () => {},
  );
  let disconnected = false;
  transport.onDisconnect = () => {
    disconnected = true;
  };

  await transport.open({});
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(disconnected, true);
});

test("主动 close 不触发 onDisconnect 回调", async () => {
  const transport = new SerialTransport(
    makeFakePort(neverEndingStream()),
    () => {},
  );
  let disconnected = false;
  transport.onDisconnect = () => {
    disconnected = true;
  };

  await transport.open({});
  await transport.close();

  assert.equal(disconnected, false);
});
