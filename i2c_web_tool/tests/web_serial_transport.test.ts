// WebSerialTransport 单元测试：用内存 ReadableStream/WritableStream 模拟 SerialPort，
// 验证读泵、缓冲、超时与关闭行为（无需真实串口）。
import {
  WebSerialTransport,
  type WebSerialPortLike,
} from "../src/serial/web_serial_transport.ts";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakePort implements WebSerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  written: number[] = [];
  opened = false;
  closed = false;
  openOptions: { baudRate: number } | null = null;
  #controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(withStreams = true) {
    if (!withStreams) return;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(...chunk);
      },
    });
  }

  open(options: Parameters<WebSerialPortLike["open"]>[0]): Promise<void> {
    this.opened = true;
    this.openOptions = options;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  getInfo() {
    return { usbVendorId: 0x1a86, usbProductId: 0x7523 };
  }

  /** 模拟设备上行数据。 */
  push(bytes: number[]): void {
    this.#controller?.enqueue(Uint8Array.from(bytes));
  }

  /** 模拟拔出/底层读流异常。 */
  fail(error: unknown): void {
    this.#controller?.error(error);
  }
}

Deno.test("open applies 8N1 options and write forwards bytes", async () => {
  const port = new FakePort();
  const transport = new WebSerialTransport(port, 115200);
  await transport.open();
  assert(port.opened, "端口应已打开");
  assert(port.openOptions?.baudRate === 115200, "波特率应传给 open");
  await transport.write(Uint8Array.of(0xaa, 0x55));
  assert(port.written.join(",") === "170,85", "写入字节应到达端口");
  await transport.close();
  assert(port.closed, "close 应关闭端口");
});

Deno.test("read returns bytes collected by the background pump", async () => {
  const port = new FakePort();
  const transport = new WebSerialTransport(port, 115200);
  await transport.open();
  port.push([1, 2, 3]);
  const chunk = await transport.read(200);
  assert(chunk.join(",") === "1,2,3", `应读到 1,2,3，实际 ${chunk.join(",")}`);
  await transport.close();
});

Deno.test("read times out with an empty result when no data arrives", async () => {
  const port = new FakePort();
  const transport = new WebSerialTransport(port, 115200);
  await transport.open();
  const started = Date.now();
  const chunk = await transport.read(30);
  const elapsed = Date.now() - started;
  assert(chunk.length === 0, "超时应返回空数组");
  assert(elapsed >= 20, `应等待接近 30ms，实际 ${elapsed}ms`);
  await transport.close();
});

Deno.test("purgeInput drops buffered bytes before the next request", async () => {
  const port = new FakePort();
  const transport = new WebSerialTransport(port, 115200);
  await transport.open();
  port.push([9, 9]);
  await delay(5); // 让读泵把字节放进内部队列
  await transport.purgeInput();
  const chunk = await transport.read(0);
  assert(chunk.length === 0, "purge 后不应再读到旧字节");
  await transport.close();
});

Deno.test("close stops the pump and later reads return empty", async () => {
  const port = new FakePort();
  const transport = new WebSerialTransport(port, 115200);
  await transport.open();
  await transport.close();
  const chunk = await transport.read(10);
  assert(chunk.length === 0, "关闭后读取应返回空");
  await transport.close(); // 幂等
});

Deno.test("read errors report passive close and release the port", async () => {
  const port = new FakePort();
  const transport = new WebSerialTransport(port, 115200);
  await transport.open();
  let closed = 0;
  transport.onClosed(() => closed++);

  port.fail(new Error("device unplugged"));
  await delay(5);

  assert(closed === 1, `被动断开应通知 1 次，实际 ${closed}`);
  const chunk = await transport.read(10);
  assert(chunk.length === 0, "被动断开后读取应返回空");
  await transport.close();
  assert(closed === 1, "主动 close 不应重复通知");
  assert(port.closed, "被动断开后的 close 应关闭端口并释放读写锁");
});

Deno.test("open failure closes an already-opened port", async () => {
  const port = new FakePort(false);
  const transport = new WebSerialTransport(port, 115200);
  await assertRejects(() => transport.open(), /读写流不可用/);
  assert(port.closed, "取流失败时必须关闭已打开端口，避免半开占用");
});
