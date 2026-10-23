// 传输互斥管理器：同一时刻只允许一个已打开的 ByteTransport。
//
// 连接新传输（无论串口、BLE 还是未来的 USB）都会先关闭旧的传输，
// 从而避免“串口与蓝牙同时占用同一个固件”的状态。UI 的切换按钮在
// 已连接时会被禁用，但真正的互斥保证在这一层。
import type {
  ActiveTransport,
  TransportDescriptor,
  TransportDevice,
  TransportEvent,
  TransportKind,
  TransportOpenOptions,
  TransportProvider,
} from "./types.ts";

export class TransportManager {
  #providers = new Map<TransportKind, TransportProvider>();
  #active: ActiveTransport | null = null;
  #activeOff: (() => void) | null = null;
  /** 被动断开后的补清理：新连接必须等它完成，避免旧 reader/writer 锁未释放。 */
  #passiveClose: Promise<void> | null = null;
  #listeners = new Set<(event: TransportEvent) => void>();
  #watchOffs: Array<() => void> = [];

  /** 注册一种传输。重复注册同 kind 会覆盖旧 Provider。 */
  register(provider: TransportProvider): void {
    this.#providers.set(provider.kind, provider);
    if (provider.watch) {
      const off = provider.watch((change) => {
        this.#emit({ type: "devices-changed", kind: provider.kind, change });
      });
      this.#watchOffs.push(off);
    }
  }

  /** UI 用它渲染连接方式切换；未注册的传输不会出现。 */
  descriptors(): TransportDescriptor[] {
    return [...this.#providers.values()].map((provider) => ({
      kind: provider.kind,
      label: provider.label,
      available: provider.isAvailable(),
      supportsBaudRate: provider.supportsBaudRate,
    }));
  }

  provider(kind: TransportKind): TransportProvider {
    const provider = this.#providers.get(kind);
    if (!provider) throw new Error(`不支持的传输类型：${kind}`);
    return provider;
  }

  async listDevices(kind: TransportKind): Promise<TransportDevice[]> {
    return await this.provider(kind).listDevices();
  }

  async requestDevice(kind: TransportKind): Promise<TransportDevice> {
    return await this.provider(kind).requestDevice();
  }

  active(): ActiveTransport | null {
    return this.#active;
  }

  /**
   * 打开传输并成为唯一活跃连接。旧的活跃传输会先被关闭。
   * 打开失败时 manager 保持空闲，不会留下半开状态。
   */
  async open(
    kind: TransportKind,
    deviceId: string,
    options: TransportOpenOptions = {},
  ): Promise<ActiveTransport> {
    await this.close();
    const provider = this.provider(kind);
    let device: TransportDevice | undefined;
    try {
      device = (await provider.listDevices()).find((item) =>
        item.id === deviceId
      );
    } catch {
      // 枚举失败不阻塞打开；Provider.open 会给出更具体的错误。
    }
    const transport = await provider.open(deviceId, options);
    const active: ActiveTransport = {
      kind,
      device: device ?? { id: deviceId, label: deviceId },
      transport,
    };
    this.#active = active;
    this.#activeOff = transport.onClosed?.(() => {
      if (this.#active?.transport !== transport) return;
      this.#active = null;
      this.#activeOff = null;
      // 被动断开时传输层只关闭了内部队列；再执行一次幂等 close，
      // 释放 Web Serial 的 reader/writer 锁、BLE 事件监听与 GATT 资源。
      // 先登记清理 Promise，再广播事件，确保 UI 的 disconnect() 能等到清理完成。
      const cleanup = (async () => {
        try {
          await transport.close();
        } catch {
          // 拔出/重复关闭时 close 内部已尽量吞错；这里不让清理失败阻断 UI。
        }
      })();
      this.#passiveClose = cleanup;
      void cleanup.finally(() => {
        if (this.#passiveClose === cleanup) this.#passiveClose = null;
      });
      this.#emit({ type: "disconnected", kind, device: active.device });
    }) ?? null;
    return active;
  }

  /** 关闭当前活跃传输；没有连接时是空操作。 */
  async close(): Promise<void> {
    const active = this.#active;
    if (!active) {
      // 被动断开后的清理可能还在进行，等待它释放完端口再允许重连/断开。
      if (this.#passiveClose) await this.#passiveClose;
      return;
    }
    this.#active = null;
    this.#activeOff?.();
    this.#activeOff = null;
    await active.transport.close();
  }

  /** 订阅设备插拔与被动断开事件。 */
  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** 释放热插拔监听；页面生命周期结束时调用。 */
  dispose(): void {
    for (const off of this.#watchOffs) off();
    this.#watchOffs = [];
    this.#listeners.clear();
    void this.close();
  }

  #emit(event: TransportEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // 单个 UI 监听器异常不应中断其他订阅者。
      }
    }
  }
}
