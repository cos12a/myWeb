// 传输层共用的上行字节队列。
//
// 浏览器硬件 API 的读取 Promise 在无数据时会一直挂起，不能直接暴露给
// LWPKT 后端的 deadline 循环。Serial/BLE/USB 的传输实现都把数据搬进
// 这个队列，read(deadlineMs) 只等待“队列非空或超时”。
const EMPTY = new Uint8Array(0);

export class ByteQueue {
  #chunks: Uint8Array[] = [];
  #buffered = 0;
  #closed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #wake: (() => void) | null = null;

  get buffered(): number {
    return this.#buffered;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** 追加一段字节并唤醒等待者；调用方负责不要把同一块可变缓冲重复传入。 */
  push(bytes: Uint8Array): void {
    if (this.#closed || bytes.length === 0) return;
    this.#chunks.push(bytes);
    this.#buffered += bytes.length;
    this.#notify();
  }

  /** 丢弃尚未消费的数据。 */
  clear(): void {
    this.#chunks = [];
    this.#buffered = 0;
  }

  /** 标记队列关闭：等待者立即返回，后续 push 被忽略。 */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.clear();
    this.#notify();
  }

  /** 最多等待 deadlineMs，返回当前全部可读字节（可能为空）。 */
  async read(deadlineMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + Math.max(0, deadlineMs);
    while (this.#buffered === 0) {
      const remain = deadline - Date.now();
      if (remain <= 0 || this.#closed) return EMPTY;
      await this.#wait(remain);
    }
    const out = new Uint8Array(this.#buffered);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#chunks = [];
    this.#buffered = 0;
    return out;
  }

  #notify(): void {
    this.#wake?.();
  }

  #wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#wake = null;
        resolve();
      }, ms);
      this.#wake = () => {
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#wake = null;
        resolve();
      };
    });
  }
}
