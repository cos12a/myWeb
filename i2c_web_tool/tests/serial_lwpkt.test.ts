// SerialLwpktBackend 协议层测试：用 fake transport 走完整的帧编解码，
// 验证 ECHO 握手、寄存器读、扫描过滤、原始写与超时错误。
import { SerialLwpktBackend } from "../src/serial/serial_lwpkt.ts";
import type { SerialTransport } from "../src/serial/web_serial_transport.ts";
import {
  ADDR_DEVICE,
  ADDR_HOST,
  CMD,
  FrameDecoder,
  buildFrame,
  toHex,
} from "../src/serial/lwpkt.mjs";

const EMPTY = new Uint8Array(0);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertRejects(
  action: () => Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.test(message)) {
      throw new Error(`错误信息不匹配：期望 ${expected}，实际 "${message}"`);
    }
    return;
  }
  throw new Error("操作应失败但成功了。");
}

type Responder = (cmd: number, data: Uint8Array) => number[] | null;

/** 解析请求帧，并按 responder 生成同 CMD 的应答帧。 */
class FakeTransport implements SerialTransport {
  written: string[] = [];
  /** 模拟慢应答：命中的 CMD 延迟 delayMs 后才入队（默认关闭）。 */
  delayCmd = -1;
  delayMs = 0;
  #decoder = new FrameDecoder();
  #outbox: Uint8Array[] = [];
  #respond: Responder;

  constructor(respond: Responder) {
    this.#respond = respond;
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.written.push(toHex(bytes));
    for (const frame of this.#decoder.push(bytes)) {
      const payload = this.#respond(frame.cmd, frame.data);
      if (payload === null) continue;
      const reply = buildFrame(frame.cmd, Uint8Array.from(payload), {
        from: ADDR_DEVICE,
        to: ADDR_HOST,
      });
      if (frame.cmd === this.delayCmd && this.delayMs > 0) {
        setTimeout(() => this.#outbox.push(reply), this.delayMs);
      } else {
        this.#outbox.push(reply);
      }
    }
  }

  async read(deadlineMs: number): Promise<Uint8Array> {
    const next = this.#outbox.shift();
    if (next) return next;
    // 模拟串口空读：让出事件循环，避免超时用例忙等。
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(deadlineMs, 2))
    );
    return EMPTY;
  }

  async purgeInput(): Promise<void> {
    this.#outbox = [];
  }

  /** 模拟设备主动上报：把一帧直接投进接收队列（STREAM_DATA 等）。 */
  enqueue(frame: Uint8Array): void {
    this.#outbox.push(frame);
  }

  async close(): Promise<void> {}
}

function createBackend(
  respond: Responder,
  responseTimeoutMs = 200,
) {
  const transport = new FakeTransport(respond);
  const backend = new SerialLwpktBackend({
    transportFactory: () => Promise.resolve(transport),
    listPorts: () =>
      Promise.resolve([{ id: "port-1", label: "USB 串口 (VID:1A86)" }]),
    responseTimeoutMs,
  });
  return { backend, transport };
}

const respondAll: Responder = (cmd, data) => {
  if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
  if (cmd === CMD.SCAN) return [0x00, 0x02, 0x50, 0x5a];
  if (cmd === CMD.READ_REG) return [0x00, 0xab, 0x2a, 0x00, 0x00, 0x00];
  return [0x00];
};

Deno.test("connect performs the golden ECHO handshake", async () => {
  const { backend, transport } = createBackend(respondAll);
  const status = await backend.connect("port-1", 115200);
  assert(status.connected, "连接后应处于已连接状态");
  assert(status.baud === 115200, "应记录波特率");
  assert(
    transport.written[0] === "AA 02 01 81 02 02 DE AD D5 55",
    `ECHO 请求帧不符：${transport.written[0]}`,
  );
  assert(status.frames === 1, "握手应答应计入帧数");
  await backend.disconnect();
});

Deno.test("read decodes the READ_REG response value", async () => {
  const { backend, transport } = createBackend(respondAll);
  await backend.connect("port-1", 115200);
  const result = await backend.read(0x50, 0x00);
  assert(result.value === 0xab, `期望 0xAB，实际 0x${result.value.toString(16)}`);
  assert(
    transport.written[1].startsWith("AA 02 01 84 04 02 50 00"),
    `READ_REG 帧头不符：${transport.written[1]}`,
  );
  await backend.disconnect();
});

Deno.test("scan filters the firmware address list to the requested range", async () => {
  const { backend } = createBackend(respondAll);
  await backend.connect("port-1", 115200);
  const result = await backend.scan(0x50, 0x50);
  assert(result.addresses.join(",") === "80", `应只保留 0x50，实际 ${result.addresses}`);
  await backend.disconnect();
});

Deno.test("transfer with zero read length emits WRITE_RAW", async () => {
  const { backend, transport } = createBackend(respondAll);
  await backend.connect("port-1", 115200);
  await backend.transfer("A00001", 0);
  const last = transport.written.at(-1) ?? "";
  assert(
    last.startsWith("AA 02 01 89 04"),
    `WRITE_RAW 帧头不符：${last}`,
  );
  await backend.disconnect();
});

Deno.test("silent device raises a handshake failure on timeout", async () => {
  const { backend } = createBackend(() => null, 30);
  await assertRejects(
    () => backend.connect("port-1", 115200),
    /握手失败/,
  );
  const status = backend.status();
  assert(!status.connected, "握手失败后应回到未连接状态");
});

Deno.test("unconnected backend rejects with a friendly message", async () => {
  const { backend } = createBackend(respondAll);
  await assertRejects(() => backend.scan(), /请先连接串口后端/);
});

Deno.test("unknown port id is rejected before touching the device", async () => {
  const backend = new SerialLwpktBackend();
  await assertRejects(() => backend.connect("missing", 115200), /端口不存在/);
});

// CONFIG/CAPS/BUS_SELECT 的应答载荷；名字 “ESP32-S3” 用于验证长度前缀文本。
const BUS_RESPONSES: Responder = (cmd, data) => {
  if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
  if (cmd === CMD.CONFIG) {
    if ((data[0] ?? 0) === 0) return [0x00, 13, 12, 0xa0, 0x86, 0x01, 0x00];
    return [0x00, 8, 9, 0x80, 0x1a, 0x06, 0x00];
  }
  if (cmd === CMD.CAPS) {
    return [
      0x00, 0x02, 0x01, 0x00, 0x07,
      0xe8, 0x03, 0x00, 0x00,
      0x80, 0x1a, 0x06, 0x00, // freq_max = 400 kHz（ESP32 常见快速模式上限）
      0x08, 0x45, 0x53, 0x50, 0x33, 0x32, 0x2d, 0x53, 0x33,
      0x00, // bus_count
      0x04, // pin_count
      0x08, 0x87, 0x00, // GPIO8：默认 SDA + 内部上拉
      0x09, 0x8b, 0x00, // GPIO9：默认 SCL + 内部上拉
      0x07, 0x82, 0x00, // GPIO7：仅声明 SCL
      0x13, 0x50, 0x03, // GPIO19：保留（USB/JTAG 占用）
    ];
  }
  if (cmd === CMD.BUS_SELECT) {
    return [0x00, 23, 22, 0x80, 0x1a, 0x06, 0x00, 0x02, 0x01];
  }
  if (cmd === CMD.SWAP) return [0x00, 9, 8];
  if (cmd === CMD.RECOVER) return [0x00];
  return [0x00];
};

Deno.test("readBusConfig sends CONFIG flags=0 and decodes the readback", async () => {
  const { backend, transport } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  const config = await backend.readBusConfig();
  assert(
    config.sda === 13 && config.scl === 12 && config.freqHz === 100000,
    `CONFIG 回读不符：${JSON.stringify(config)}`,
  );
  const last = transport.written.at(-1) ?? "";
  assert(
    last.startsWith("AA 02 01 90 04 01 00"),
    `CONFIG 查询帧头不符：${last}`,
  );
  await backend.disconnect();
});

Deno.test("configureBus sends all changed fields in flags order", async () => {
  const { backend, transport } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  const config = await backend.configureBus({
    sda: 8,
    scl: 9,
    freqHz: 400000,
  });
  assert(
    config.sda === 8 && config.scl === 9 && config.freqHz === 400000,
    `CONFIG 设置回读不符：${JSON.stringify(config)}`,
  );
  const last = transport.written.at(-1) ?? "";
  assert(
    last.startsWith("AA 02 01 90 04 07 07 08 09 80 1A 06 00"),
    `CONFIG 设置帧头不符：${last}`,
  );
  await backend.disconnect();
});

Deno.test("configureBus rejects reserved pins, equal pins and bad frequency", async () => {
  const { backend } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  await assertRejects(() => backend.configureBus({ sda: 43 }), /GPIO43\/44/);
  await assertRejects(
    () => backend.configureBus({ sda: 8, scl: 8 }),
    /同一个引脚/,
  );
  await assertRejects(
    () => backend.configureBus({ freqHz: 500 }),
    /1,000–1,000,000/,
  );
  await backend.disconnect();
});

Deno.test("readBusCapabilities decodes a free-pin ESP32 report", async () => {
  const { backend } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  const caps = await backend.readBusCapabilities();
  assert(caps !== null, "应返回能力对象");
  assert(caps!.machine === "esp32", `平台应为 esp32，实际 ${caps!.machine}`);
  assert(caps!.pinMode === "free", `引脚模式应为 free，实际 ${caps!.pinMode}`);
  assert(caps!.name === "ESP32-S3", `芯片名不符：${caps!.name}`);
  assert(caps!.freqMax === 400000, "频率上限应为 400 kHz");
  assert(caps!.buses.length === 0, "自由引脚模式不应上报固定实例");
  assert(caps!.pins.length === 4, `引脚表条目数不符：${caps!.pins.length}`);
  assert(caps!.defaultSda === 8 && caps!.defaultScl === 9, "默认引脚不符");
  assert(
    caps!.pins[3].reserved && caps!.pins[3].reasonText.includes("USB"),
    "GPIO19 应被标记为保留（USB/JTAG）",
  );
  await backend.disconnect();
});

Deno.test("configureBus honors the firmware-reported pin table", async () => {
  const { backend } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  await backend.readBusCapabilities();
  await assertRejects(
    () => backend.configureBus({ sda: 5 }),
    /不在固件上报的可用引脚表/,
  );
  await assertRejects(
    () => backend.configureBus({ sda: 19 }),
    /USB\/JTAG/,
  );
  await assertRejects(
    () => backend.configureBus({ sda: 7 }),
    /未被固件声明为可用的 SDA/,
  );
  await assertRejects(
    () => backend.configureBus({ freqHz: 800000 }),
    /1000–400000/,
  );
  const config = await backend.configureBus({ sda: 8, scl: 9 });
  assert(
    config.sda === 8 && config.scl === 9,
    `合法引脚应被接受：${JSON.stringify(config)}`,
  );
  await backend.disconnect();
});

Deno.test("reconnecting clears the cached capability pin table", async () => {
  const { backend } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  await backend.readBusCapabilities();
  await backend.disconnect();
  await backend.connect("port-1", 115200);
  // 旧设备的引脚表不能残留：GPIO5 不在表内，但新连接尚未读 CAPS，应走兜底校验。
  const config = await backend.configureBus({ sda: 5, scl: 6 });
  assert(
    config.sda === 8 && config.scl === 9,
    `重连后不应沿用旧引脚表（应发出 CONFIG）：${JSON.stringify(config)}`,
  );
  await backend.disconnect();
});

Deno.test("readBusCapabilities returns null for older firmware", async () => {
  const { backend } = createBackend((cmd, data) => {
    if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
    if (cmd === CMD.CAPS) return [0x01]; // ERR_ARG
    return [0x00];
  });
  await backend.connect("port-1", 115200);
  const caps = await backend.readBusCapabilities();
  assert(caps === null, "旧固件应降级为 null");
  await backend.disconnect();
});

Deno.test("selectBus sends BUS_SELECT and returns the effective instance", async () => {
  const { backend, transport } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  const config = await backend.selectBus(2, 1, 400000);
  assert(
    config.busId === 2 && config.schemeId === 1 && config.sda === 23 &&
      config.scl === 22,
    `BUS_SELECT 回读不符：${JSON.stringify(config)}`,
  );
  const last = transport.written.at(-1) ?? "";
  assert(
    last.startsWith("AA 02 01 A1 04 06 02 01 80 1A 06 00"),
    `BUS_SELECT 帧头不符：${last}`,
  );
  await backend.disconnect();
});

Deno.test("swapBusPins and recoverBus use the dedicated commands", async () => {
  const { backend, transport } = createBackend(BUS_RESPONSES);
  await backend.connect("port-1", 115200);
  const swapped = await backend.swapBusPins();
  assert(
    swapped.sda === 9 && swapped.scl === 8,
    `SWAP 回读不符：${JSON.stringify(swapped)}`,
  );
  assert(
    (transport.written.at(-1) ?? "").startsWith("AA 02 01 92 04 00"),
    `SWAP 帧头不符：${transport.written.at(-1)}`,
  );
  await backend.recoverBus();
  assert(
    (transport.written.at(-1) ?? "").startsWith("AA 02 01 91 04 00"),
    `RECOVER 帧头不符：${transport.written.at(-1)}`,
  );
  await backend.disconnect();
});

// —— 设备主动上报（STREAM_START / STREAM_STOP / STREAM_DATA）——

const STREAM_RESPONSES: Responder = (cmd, data) => {
  if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
  if (cmd === CMD.READ_REG) return [0x00, 0xab, 0x2a, 0x00, 0x00, 0x00];
  if (cmd === CMD.STREAM_START) {
    return [0x00, 0x01, 0x0a, 0x00, 0x01]; // int 模式、10 ms、flags 声明中断可用
  }
  if (cmd === CMD.STREAM_STOP) return [0x00, 0x03, 0x00, 0x00, 0x00]; // 固件侧 3 帧
  return [0x00];
};

function streamRequest() {
  return {
    address: 0x18,
    register: 0xa8,
    length: 6,
    mode: "int" as const,
    periodMs: 0,
    intPin: 4,
    count: 0,
  };
}

Deno.test("startStream sends the plan and stopStream reports firmware frames", async () => {
  const { backend, transport } = createBackend(STREAM_RESPONSES);
  await backend.connect("port-1", 115200);
  const info = await backend.startStream(streamRequest());
  assert(info.supported && info.mode === "int", `模式应为 int：${JSON.stringify(info)}`);
  assert(info.periodMs === 10, `periodMs 应为 10，实际 ${info.periodMs}`);
  assert(/中断触发推送/.test(info.message), `提示应说明中断模式：${info.message}`);
  const last = transport.written.at(-1) ?? "";
  assert(
    last.startsWith("AA 02 01 B0 04 09 18 A8 06 01 00 00 04 00 00"),
    `STREAM_START 帧头不符：${last}`,
  );
  const stopped = await backend.stopStream();
  assert(stopped.frames === 3, `固件帧数应为 3，实际 ${stopped.frames}`);
  assert(
    (transport.written.at(-1) ?? "").startsWith("AA 02 01 B1 04 00"),
    `STREAM_STOP 帧头不符：${transport.written.at(-1)}`,
  );
  // 未启动时停止应幂等返回 0。
  const idle = await backend.stopStream();
  assert(idle.frames === 0, "未启动时 stopStream 应返回 0");
  await backend.disconnect();
});

Deno.test("stopStream waits for the in-flight request before sending STOP", async () => {
  const { backend, transport } = createBackend(STREAM_RESPONSES);
  await backend.connect("port-1", 115200);
  await backend.startStream(streamRequest());
  // 让 READ_REG 慢应答 80 ms：构造切模式时 configure 与 STOP 相撞的在途场景。
  transport.delayCmd = CMD.READ_REG;
  transport.delayMs = 80;
  const pending = backend.read(0x18, 0x0f);
  const stopped = await backend.stopStream();
  const read = await pending;
  assert(read.value === 0xab, `在途读应正常完成，实际 ${read.value}`);
  assert(stopped.frames === 3, `固件帧数应为 3，实际 ${stopped.frames}`);
  const readIndex = transport.written.findIndex((item) =>
    item.startsWith("AA 02 01 84 04")
  );
  const stopIndex = transport.written.findIndex((item) =>
    item.startsWith("AA 02 01 B1 04")
  );
  assert(readIndex >= 0, "应发出 READ_REG 请求");
  assert(stopIndex > readIndex, "STREAM_STOP 必须在在途 READ_REG 之后发出");
  await backend.disconnect();
});

Deno.test("stream pump dispatches STREAM_DATA frames to subscribers", async () => {
  const { backend, transport } = createBackend(STREAM_RESPONSES);
  await backend.connect("port-1", 115200);
  const received: Array<{ seq: number; bytes: number[] }> = [];
  const unsubscribe = backend.subscribeStream((frame) => {
    received.push({ seq: frame.seq, bytes: frame.bytes });
  });
  await backend.startStream(streamRequest());
  for (const seq of [0, 1, 2]) {
    transport.enqueue(
      buildFrame(
        CMD.STREAM_DATA,
        Uint8Array.of(0x18, seq, 0x00, 0x06, 0x80, 0x3e, 0x00, 0x00, 0x80, 0x3e),
        { from: ADDR_DEVICE, to: ADDR_HOST },
      ),
    );
  }
  // 等待接收泵分发（轮询读取，给足 1 秒窗口）。
  const deadline = Date.now() + 1000;
  while (received.length < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(received.length === 3, `应收到 3 帧，实际 ${received.length}`);
  assert(
    received[0].seq === 0 && received[2].seq === 2,
    `seq 应保持顺序：${received.map((item) => item.seq)}`,
  );
  assert(received[0].bytes.length === 6, "每帧应带 6 字节原始数据");
  unsubscribe();
  await backend.stopStream();
  await backend.disconnect();
});

Deno.test("old firmware rejecting STREAM_START surfaces a friendly error", async () => {
  const { backend } = createBackend((cmd, data) => {
    if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
    if (cmd === CMD.STREAM_START) return [0x02]; // ERR
    return [0x00];
  });
  await backend.connect("port-1", 115200);
  await assertRejects(
    () => backend.startStream(streamRequest()),
    /STREAM_START/,
  );
  await backend.disconnect();
});

Deno.test("startStream validates intPin against the firmware pin table", async () => {
  const responses: Responder = (cmd, data) => {
    if (cmd === CMD.STREAM_START) return [0x00, 0x01, 0x0a, 0x00, 0x01];
    if (cmd === CMD.STREAM_STOP) return [0x00, 0x00, 0x00, 0x00, 0x00];
    return BUS_RESPONSES(cmd, data);
  };
  const { backend } = createBackend(responses);
  await backend.connect("port-1", 115200);
  await backend.readBusCapabilities();
  await assertRejects(
    () => backend.startStream({ ...streamRequest(), intPin: 5 }),
    /不在固件上报的可用引脚表/,
  );
  await assertRejects(
    () => backend.startStream({ ...streamRequest(), intPin: 19 }),
    /USB\/JTAG/,
  );
  const info = await backend.startStream({ ...streamRequest(), intPin: 8 });
  assert(
    /GPIO8/.test(info.message),
    `合法引脚应使用 GPIO 名称提示：${info.message}`,
  );
  await backend.stopStream();
  await backend.disconnect();
});

// —— 周期自动上报（REPORT_CONFIG / START / STOP / STATUS / CLEAR / DATA）——

/** 固件任务表快照：task0 运行中 100 ms、task1 运行中 1000 ms、另两个空槽位。 */
const REPORT_TABLE = [
  0x00, 0x18, 0xa8, 0x06, 0x64, 0x00, 0x02,
  0x01, 0x5a, 0x07, 0x03, 0xe8, 0x03, 0x02,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

const REPORT_RESPONSES: Responder = (cmd, data) => {
  if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
  if (cmd === CMD.REPORT_CONFIG) {
    // 固件把 100 ms 钳到 tick 10 ms，并声明支持 ONLY_CHANGED
    return [0x00, data[0] ?? 0, 0x0a, 0x00, 0x01];
  }
  if (cmd === CMD.REPORT_START) {
    return [0x00, data[0] === 0xff ? 0x02 : 0x01, 0x0a, 0x00];
  }
  if (cmd === CMD.REPORT_STOP) {
    return [0x00, 0x02, 0x00, 0x78, 0x00, 0x00, 0x00, 0x01, 0x2c, 0x01, 0x00, 0x00];
  }
  if (cmd === CMD.REPORT_STATUS) {
    return [0x00, 0x01, 0x04, 0x02, 0x0a, 0x00, 0x04, ...REPORT_TABLE];
  }
  if (cmd === CMD.REPORT_CLEAR) return [0x00, 0x02];
  return [0x00];
};

function reportTask(overrides: Partial<{
  taskId: number;
  address: number;
  register: number;
  length: number;
  periodMs: number;
  count: number;
  flags: number;
}> = {}) {
  return {
    taskId: 0,
    address: 0x18,
    register: 0xa8,
    length: 6,
    periodMs: 100,
    count: 0,
    flags: 0,
    ...overrides,
  };
}

Deno.test("configureReport writes the golden task slot and reads back the clamped period", async () => {
  const { backend, transport } = createBackend(REPORT_RESPONSES);
  await backend.connect("port-1", 115200);
  const config = await backend.configureReport(reportTask());
  assert(
    transport.written.at(-1) ===
      "AA 02 01 C0 04 09 00 18 A8 06 64 00 00 00 00 B6 55",
    `REPORT_CONFIG 金帧不符：${transport.written.at(-1)}`,
  );
  assert(config.taskId === 0, `taskId 应回显 0，实际 ${config.taskId}`);
  assert(config.periodMs === 10, `周期应回显钳制后的 10 ms，实际 ${config.periodMs}`);
  assert(config.onlyChanged, "flags bit0 应解成 onlyChanged");
  await backend.disconnect();
});

Deno.test("startReport / stopReport / queryReport / clearReport cover the task table", async () => {
  const { backend, transport } = createBackend(REPORT_RESPONSES);
  await backend.connect("port-1", 115200);
  const info = await backend.startReport();
  assert(info.started === 2, `应启动 2 个任务，实际 ${info.started}`);
  assert(info.tickMs === 10, `tickMs 应为 10，实际 ${info.tickMs}`);
  assert(
    (transport.written.at(-1) ?? "").startsWith("AA 02 01 C1 04 01 FF"),
    `REPORT_START 帧头不符：${transport.written.at(-1)}`,
  );

  const status = await backend.queryReport();
  assert(status.maxTasks === 4, `maxTasks 应为 4，实际 ${status.maxTasks}`);
  assert(status.activeCount === 2, `activeCount 应为 2，实际 ${status.activeCount}`);
  assert(status.tasks.length === 4, `任务表应有 4 行，实际 ${status.tasks.length}`);
  assert(status.tasks[0].periodMs === 100, "task0 周期应为 100 ms");
  assert(status.tasks[0].stateText === "运行中", `状态文案不符：${status.tasks[0].stateText}`);
  assert(status.tasks[2].stateText === "未配置", "空槽位应标为未配置");

  const stopped = await backend.stopReport();
  assert(stopped.length === 2, `应返回 2 个任务统计，实际 ${stopped.length}`);
  assert(
    stopped[0].frames === 120 && stopped[1].frames === 300,
    `帧数统计不符：${JSON.stringify(stopped)}`,
  );
  const idle = await backend.stopReport();
  assert(idle.length === 0, "未启动时 stopReport 应返回空数组");

  const cleared = await backend.clearReport();
  assert(cleared === 2, `应清空 2 个槽位，实际 ${cleared}`);
  await backend.disconnect();
});

Deno.test("report pump dispatches REPORT_DATA frames with device timestamps", async () => {
  const { backend, transport } = createBackend(REPORT_RESPONSES);
  await backend.connect("port-1", 115200);
  const received: Array<{
    taskId: number;
    seq: number;
    atMs: number;
    bytes: number[];
  }> = [];
  const unsubscribe = backend.subscribeReport((frame) => {
    received.push({
      taskId: frame.taskId,
      seq: frame.seq,
      atMs: frame.atMs,
      bytes: frame.bytes,
    });
  });
  await backend.startReport(0x00);
  for (const [seq, atMs] of [[0, 1234], [1, 1334]] as const) {
    transport.enqueue(
      buildFrame(
        CMD.REPORT_DATA,
        Uint8Array.of(
          0x00,
          0x18,
          seq,
          0x00,
          0x06,
          atMs & 0xff,
          (atMs >> 8) & 0xff,
          (atMs >> 16) & 0xff,
          (atMs >>> 24) & 0xff,
          0x80,
          0x3e,
          0x00,
          0x00,
          0x80,
          0x3e,
        ),
        { from: ADDR_DEVICE, to: ADDR_HOST },
      ),
    );
  }
  const deadline = Date.now() + 1000;
  while (received.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(received.length === 2, `应收到 2 帧，实际 ${received.length}`);
  assert(received[0].taskId === 0, "帧应带任务编号");
  assert(received[1].seq === 1, `seq 应保持顺序，实际 ${received[1].seq}`);
  assert(
    received[1].atMs - received[0].atMs === 100,
    `atMs 差值应为配置周期 100 ms，实际 ${received[1].atMs - received[0].atMs}`,
  );
  assert(received[0].bytes.length === 6, "每帧应带 6 字节原始数据");
  unsubscribe();
  await backend.stopReport();
  await backend.disconnect();
});

Deno.test("REPORT rejects bad slots, old firmware and STREAM coexistence", async () => {
  const { backend } = createBackend((cmd, data) => {
    if (cmd === CMD.ECHO) return [0x00, data[0] ?? 0, data[1] ?? 0];
    if (cmd === CMD.REPORT_CONFIG) return [0x07]; // ERR_UNSUPPORTED
    if (cmd === CMD.STREAM_START) return [0x00, 0x01, 0x0a, 0x00, 0x01];
    if (cmd === CMD.STREAM_STOP) return [0x00, 0x00, 0x00, 0x00, 0x00];
    return [0x00];
  });
  await backend.connect("port-1", 115200);
  await assertRejects(
    () => backend.configureReport(reportTask({ periodMs: 0 })),
    /1–60000/,
  );
  await assertRejects(
    () => backend.configureReport(reportTask({ address: 0x80 })),
    /0x08–0x77/,
  );
  await assertRejects(
    () => backend.configureReport(reportTask({ taskId: 0x100 })),
    /0–255/,
  );
  await assertRejects(
    () => backend.configureReport(reportTask()),
    /REPORT_CONFIG/,
  );
  await backend.startStream(streamRequest());
  await assertRejects(() => backend.startReport(), /STREAM/);
  await backend.stopStream();
  await backend.disconnect();
});

