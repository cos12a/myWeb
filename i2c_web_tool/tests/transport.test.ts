// 传输层单测：ByteQueue、TransportManager 互斥、BLE NUS 分片与被动断开。
//
// 这里使用最小的 Web Bluetooth / ByteTransport 替身，不依赖真实浏览器，
// 覆盖三类关键契约：
//   1. read(deadline) 只等待队列，不阻塞事件循环；
//   2. 打开新传输必须先关闭旧传输（串口/蓝牙互斥）；
//   3. NUS 通知按 20 字节分片写入、上行数据通过通知入队。
import { ByteQueue } from "../src/transport/byte_queue.ts";
import { TransportManager } from "../src/transport/manager.ts";
import type {
  ByteTransport,
  TransportEvent,
  TransportOpenOptions,
  TransportProvider,
} from "../src/transport/types.ts";
import {
  BLE_DEVICE_NAME_PREFIX,
  BleNusProvider,
  BleNusTransport,
  NUS_NOTIFY_CHARACTERISTIC,
  NUS_SERVICE,
  NUS_WRITE_CHARACTERISTIC,
} from "../src/serial/ble_nus_transport.ts";
import type {
  BluetoothDeviceLike,
  BluetoothGATTCharacteristicLike,
  BluetoothGATTServiceLike,
} from "../src/serial/ble_nus_transport.ts";

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

// —— ByteQueue ——

Deno.test("ByteQueue concatenates chunks and clears on close", async () => {
  const queue = new ByteQueue();
  queue.push(Uint8Array.of(0xaa, 0x01));
  queue.push(Uint8Array.of(0x55));
  const bytes = await queue.read(10);
  assert(
    bytes.join(",") === "170,1,85",
    `应按入队顺序拼接，实际 ${bytes.join(",")}`,
  );

  queue.push(Uint8Array.of(0x02));
  queue.close();
  const afterClose = await queue.read(10);
  assert(afterClose.length === 0, "关闭后队列应清空并立即返回空数据");
  queue.push(Uint8Array.of(0x03));
  assert(queue.buffered === 0, "关闭后 push 应被忽略");
});

Deno.test("ByteQueue read waits for the deadline when empty", async () => {
  const queue = new ByteQueue();
  const started = Date.now();
  const bytes = await queue.read(30);
  const elapsed = Date.now() - started;
  assert(bytes.length === 0, "空队列应返回空数组");
  assert(elapsed >= 20, `应至少等待接近 deadline，实际 ${elapsed}ms`);
  queue.close();
});

Deno.test("ByteQueue read wakes up as soon as data arrives", async () => {
  const queue = new ByteQueue();
  setTimeout(() => queue.push(Uint8Array.of(0x42)), 5);
  const bytes = await queue.read(200);
  assert(bytes[0] === 0x42, `应读到后续推送的字节，实际 ${bytes.join(",")}`);
  queue.close();
});

// —— TransportManager ——

function createProvider(
  kind: "serial" | "ble",
  label: string,
  log: string[],
): TransportProvider & { emitClosed: () => void } {
  let emitClosed = () => {};
  return {
    kind,
    label,
    supportsBaudRate: kind === "serial",
    isAvailable: () => true,
    listDevices: () => Promise.resolve([{ id: `${kind}-1`, label }]),
    requestDevice: () => Promise.resolve({ id: `${kind}-1`, label }),
    open: (deviceId: string, _options: TransportOpenOptions) => {
      const listeners = new Set<() => void>();
      emitClosed = () => {
        for (const listener of [...listeners]) listener();
      };
      const transport: ByteTransport = {
        write: () => Promise.resolve(),
        read: () => Promise.resolve(new Uint8Array(0)),
        purgeInput: () => Promise.resolve(),
        close: () => {
          log.push(`${kind}:close:${deviceId}`);
          return Promise.resolve();
        },
        onClosed: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      return Promise.resolve(transport);
    },
    emitClosed: () => emitClosed(),
  };
}

Deno.test("TransportManager enforces a single active transport", async () => {
  const log: string[] = [];
  const manager = new TransportManager();
  const serial = createProvider("serial", "串口", log);
  const ble = createProvider("ble", "蓝牙", log);
  manager.register(serial);
  manager.register(ble);

  const descriptors = manager.descriptors();
  assert(descriptors.length === 2, "应注册两种传输");
  assert(
    descriptors.find((item) => item.kind === "serial")?.supportsBaudRate ===
      true,
    "串口应声明支持波特率",
  );
  assert(
    descriptors.find((item) => item.kind === "ble")?.supportsBaudRate === false,
    "蓝牙不应显示波特率",
  );

  await manager.open("serial", "serial-1");
  assert(manager.active()?.kind === "serial", "第一次应打开串口传输");

  await manager.open("ble", "ble-1");
  assert(
    log.includes("serial:close:serial-1"),
    "打开蓝牙前必须关闭串口",
  );
  assert(manager.active()?.kind === "ble", "互斥后只保留蓝牙传输");

  await manager.close();
  assert(manager.active() === null, "关闭后不应有活跃传输");
  manager.dispose();
});

Deno.test("TransportManager reports passive disconnects", async () => {
  const log: string[] = [];
  const manager = new TransportManager();
  const ble = createProvider("ble", "蓝牙", log);
  manager.register(ble);
  const events: TransportEvent[] = [];
  manager.subscribe((event) => events.push(event));

  await manager.open("ble", "ble-1");
  ble.emitClosed();

  assert(manager.active() === null, "链路被动断开后应清空活跃传输");
  const event = events.find((item) => item.type === "disconnected");
  assert(Boolean(event), "应向 UI 广播 disconnected 事件");
  await manager.close();
  assert(log.includes("ble:close:ble-1"), "被动断开后应补一次 close 释放资源");
  manager.dispose();
});

// —— BLE NUS ——

class FakeCharacteristic implements BluetoothGATTCharacteristicLike {
  value: DataView | null = null;
  properties = { writeWithoutResponse: true, notify: true };
  writes: Uint8Array[] = [];
  #listeners = new Set<(event: Event) => void>();

  async startNotifications(): Promise<BluetoothGATTCharacteristicLike> {
    return this;
  }

  async stopNotifications(): Promise<BluetoothGATTCharacteristicLike> {
    return this;
  }

  async writeValueWithoutResponse(value: Uint8Array): Promise<void> {
    this.writes.push(value.slice());
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  addEventListener(
    type: "characteristicvaluechanged",
    listener: (event: Event) => void,
  ): void {
    if (type === "characteristicvaluechanged") this.#listeners.add(listener);
  }

  removeEventListener(
    type: "characteristicvaluechanged",
    listener: (event: Event) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  /** 模拟设备通知：浏览器复用 DataView，这里也复用同一块内存。 */
  emit(bytes: Uint8Array): void {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const listener of [...this.#listeners]) {
      listener({ target: this } as unknown as Event);
    }
  }
}

class FakeDevice implements BluetoothDeviceLike {
  id = "ble-1";
  name = `${BLE_DEVICE_NAME_PREFIX}-ESP32`;
  gatt: FakeGatt;
  write = new FakeCharacteristic();
  notify = new FakeCharacteristic();
  #listeners = new Set<() => void>();

  constructor() {
    const service: BluetoothGATTServiceLike = {
      getCharacteristic: (uuid: string) => {
        if (uuid === NUS_WRITE_CHARACTERISTIC) return Promise.resolve(this.write);
        if (uuid === NUS_NOTIFY_CHARACTERISTIC) {
          return Promise.resolve(this.notify);
        }
        return Promise.reject(new DOMException("missing", "NotFoundError"));
      },
    };
    this.gatt = new FakeGatt(this, service);
  }

  addEventListener(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void {
    if (type === "gattserverdisconnected") this.#listeners.add(listener);
  }

  removeEventListener(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void {
    this.#listeners.delete(listener);
  }

  emitDisconnected(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  get disconnectListenerCount(): number {
    return this.#listeners.size;
  }
}

class FakeGatt {
  connected = false;
  #device: FakeDevice;
  #service: BluetoothGATTServiceLike;

  constructor(device: FakeDevice, service: BluetoothGATTServiceLike) {
    this.#device = device;
    this.#service = service;
  }

  connect(): Promise<FakeGatt> {
    this.connected = true;
    return Promise.resolve(this);
  }

  disconnect(): void {
    this.connected = false;
    this.#device.emitDisconnected();
  }

  getPrimaryService(uuid: string): Promise<BluetoothGATTServiceLike> {
    if (uuid !== NUS_SERVICE) {
      return Promise.reject(new DOMException("missing", "NotFoundError"));
    }
    return Promise.resolve(this.#service);
  }
}

Deno.test("BleNusTransport splits writes into 20-byte ATT chunks", async () => {
  const device = new FakeDevice();
  const transport = await BleNusTransport.open(device);
  const payload = new Uint8Array(25).fill(0x5a);
  await transport.write(payload);
  assert(
    device.write.writes.length === 2,
    `25 字节应分 2 片，实际 ${device.write.writes.length} 片`,
  );
  assert(device.write.writes[0]?.length === 20, "首片应为 20 字节");
  assert(device.write.writes[1]?.length === 5, "尾片应为 5 字节");
  await transport.close();
  assert(!device.gatt.connected, "close 应断开 GATT");
});

Deno.test("BleNusTransport copies notifications into the read queue", async () => {
  const device = new FakeDevice();
  const transport = await BleNusTransport.open(device);
  const incoming = Uint8Array.of(0xaa, 0x55, 0x01);
  device.notify.emit(incoming);
  // 模拟浏览器复用底层缓冲：入队后修改原数据不应影响已读内容。
  incoming.fill(0);
  const bytes = await transport.read(50);
  assert(
    bytes.join(",") === "170,85,1",
    `应读到通知副本，实际 ${bytes.join(",")}`,
  );
  await transport.close();
});

Deno.test("BleNusTransport reports gattserverdisconnected once", async () => {
  const device = new FakeDevice();
  const transport = await BleNusTransport.open(device);
  let closed = 0;
  transport.onClosed?.(() => closed++);
  device.gatt.disconnect();
  assert(closed === 1, `被动断开应通知 1 次，实际 ${closed}`);
  assert(device.notify.listenerCount === 0, "被动断开后应移除通知监听");
  assert(
    device.disconnectListenerCount === 0,
    "被动断开后应移除 GATT 断开监听",
  );
  const bytes = await transport.read(10);
  assert(bytes.length === 0, "被动断开后 read 应立即返回空");
  await transport.close();
  assert(closed === 1, "close 不应重复触发 onClosed");
});

Deno.test("BleNusProvider authorizes and reopens a cached device", async () => {
  const device = new FakeDevice();
  const requested: Array<{
    acceptAllDevices?: boolean;
    filters?: Array<{ namePrefix?: string; services?: string[] }>;
    optionalServices?: string[];
  }> = [];
  const provider = new BleNusProvider({
    requestDevice: (options) => {
      requested.push(options);
      return Promise.resolve(device);
    },
    getDevices: () => Promise.resolve([device]),
  });
  const picked = await provider.requestDevice();
  assert(picked.id === "ble-1", "requestDevice 应返回设备 id");
  const options = requested[0];
  assert(
    options?.filters?.[0]?.namePrefix === BLE_DEVICE_NAME_PREFIX,
    "requestDevice 应按 BUS 前缀过滤设备名",
  );
  assert(
    options?.acceptAllDevices !== true,
    "启用名称过滤时不应接受所有设备",
  );
  assert(
    options?.optionalServices?.includes(NUS_SERVICE) === true,
    "requestDevice 应声明可访问 NUS 服务",
  );
  const listed = await provider.listDevices();
  assert(listed.length === 1, "getDevices 应枚举已授权设备");
  const transport = await provider.open(picked.id, {});
  assert(device.gatt.connected, "open 应建立 GATT 连接");
  await transport.close();
});

Deno.test("BleNusProvider hides non-BUS device names", async () => {
  const bus = new FakeDevice();
  const other = new FakeDevice();
  other.id = "ble-2";
  other.name = "Speaker";
  const provider = new BleNusProvider({
    requestDevice: () => Promise.resolve(bus),
    getDevices: () => Promise.resolve([bus, other]),
  });
  const listed = await provider.listDevices();
  assert(
    listed.length === 1 && listed[0]?.id === "ble-1",
    `应只列出 BUS 开头的设备，实际 ${listed.map((item) => item.label).join(",")}`,
  );
  await assertRejects(
    () => provider.open("ble-2", {}),
    /需以 BUS 开头/,
  );
});

Deno.test("BleNusProvider rejects unknown devices and missing service", async () => {
  const provider = new BleNusProvider({
    requestDevice: () =>
      Promise.reject(new DOMException("cancel", "NotFoundError")),
  });
  await assertRejects(
    () => provider.open("missing", {}),
    /未授权，请先点击「选择蓝牙设备」/,
  );

  const broken = new FakeDevice();
  broken.gatt.getPrimaryService = () =>
    Promise.reject(new DOMException("missing", "NotFoundError"));
  await assertRejects(
    () => BleNusTransport.open(broken),
    /未找到 NUS 服务或特征/,
  );
});
