export const ACK = 0x79;
export const NACK = 0x1f;
export const SYNC = 0x7f;

export const COMMANDS = {
  GET: 0x00,
  GET_ID: 0x02,
  READ_MEMORY: 0x11,
  GO: 0x21,
  WRITE_MEMORY: 0x31,
  ERASE: 0x43,
  EXTENDED_ERASE: 0x44,
  READOUT_UNPROTECT: 0x92,
};

export function xor(bytes) {
  return bytes.reduce((sum, byte) => sum ^ byte, 0);
}

export function commandPacket(command) {
  return [command, command ^ 0xff];
}

export function addressPacket(address) {
  const bytes = [
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
  ];
  return [...bytes, xor(bytes)];
}

export function writePacket(chunk) {
  if (chunk.length < 1 || chunk.length > 256) {
    throw new Error("Write packet must contain 1-256 bytes");
  }
  const body = [chunk.length - 1, ...chunk];
  return [...body, xor(body)];
}

export function readLengthPacket(length) {
  if (length < 1 || length > 256) {
    throw new Error("Read length must be 1-256 bytes");
  }
  const value = length - 1;
  return [value, value ^ 0xff];
}

export function padForWrite(bytes) {
  const out = Array.from(bytes);
  while (out.length % 4 !== 0) out.push(0xff);
  return new Uint8Array(out);
}

export function toHex(value, width = 2) {
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

export class Stm32Bootloader {
  constructor(transport, { timeout = 2000, onProgress = () => {} } = {}) {
    this.transport = transport;
    this.timeout = timeout;
    this.onProgress = onProgress;
    this.supportedCommands = new Set();
  }

  async sync() {
    await this.transport.write([SYNC]);
    await this.expectAck(1000);
  }

  async getCommands() {
    await this.sendCommand(COMMANDS.GET);
    const countMinusOne = (await this.transport.readExact(1, this.timeout))[0];
    const payload = await this.transport.readExact(
      countMinusOne + 1,
      this.timeout,
    );
    await this.expectAck();
    const version = payload[0];
    const commands = payload.slice(1);
    this.supportedCommands = new Set(commands);
    return { version, commands };
  }

  async getId() {
    await this.sendCommand(COMMANDS.GET_ID);
    const countMinusOne = (await this.transport.readExact(1, this.timeout))[0];
    const bytes = await this.transport.readExact(
      countMinusOne + 1,
      this.timeout,
    );
    await this.expectAck();
    return bytes.reduce((value, byte) => (value << 8) | byte, 0);
  }

  async massErase() {
    if (this.supportedCommands.has(COMMANDS.EXTENDED_ERASE)) {
      await this.sendCommand(COMMANDS.EXTENDED_ERASE);
      await this.transport.write([0xff, 0xff, 0x00]);
      await this.expectAck(60000);
      return "extended";
    }

    await this.sendCommand(COMMANDS.ERASE);
    await this.transport.write([0xff, 0x00]);
    await this.expectAck(60000);
    return "legacy";
  }

  /**
   * 按页码范围擦除（仅适用于支持 EXTENDED_ERASE 的芯片，如 STM32G0）
   * @param {number} startPage - 起始页码（从0开始）
   * @param {number} endPage   - 结束页码（包含）
   */
  /**
   * 擦除指定范围的 Flash 页
   * @param {number} startPage - 起始页码
   * @param {number} pageCount - 要擦除的页数
   * @returns {Promise<string>} 擦除结果状态
   */
  async erasePages(startPage, pageCount) {
    // N = pageCount - 1（STM32 Extended Erase 协议要求）
    const nValue = pageCount - 1;

    const body = [];
    body.push((nValue >> 8) & 0xff);
    body.push(nValue & 0xff);

    // 页码列表（双字节 MSB first）
    for (let p = startPage; p < startPage + pageCount; p++) {
      body.push((p >> 8) & 0xff);
      body.push(p & 0xff);
    }

    // XOR 校验覆盖整个 body（不含校验字节本身）
    body.push(xor(body));

    await this.sendCommand(COMMANDS.EXTENDED_ERASE);
    await this.transport.write(body);
    await this.expectAck(pageCount * 2000);

    return "partial";
  }
  /**
   * 擦除 STM32 Flash 指定页范围（Extended Erase 0x44）
   * @param {number} startPage - 起始页码（从 0 开始）
   * @param {number} pageCount - 要擦除的页数（>= 1）
   * @returns {Promise<string>}
   */
  async erasePages(startPage, pageCount) {
    if (pageCount < 1 || startPage < 0) {
      throw new Error(
        `Invalid erase range: start=${startPage}, count=${pageCount}`,
      );
    }

    // ★ 关键：N = pageCount - 1（协议规定，不是原始页数）
    const nValue = pageCount - 1;

    const body = [];

    // 1. 写入 N（双字节，MSB first）
    body.push((nValue >> 8) & 0xff);
    body.push(nValue & 0xff);

    // 2. 写入页码列表（每个页码双字节，MSB first）
    for (let p = startPage; p < startPage + pageCount; p++) {
      body.push((p >> 8) & 0xff);
      body.push(p & 0xff);
    }

    // 3. 计算并追加 XOR 校验（覆盖上面所有字节）
    let checksum = 0;
    for (let i = 0; i < body.length; i++) {
      checksum ^= body[i];
    }
    body.push(checksum);

    // 4. 发送扩展擦除命令 + 数据体
    await this.sendCommand(0x44);
    await this.transport.write(new Uint8Array(body));

    // 5. 等待 ACK（超时按页数动态计算，每页预留 2s）
    await this.expectAck(pageCount * 2000);

    return "partial";
  }

  // stm32.js

  // /**
  //  * 擦除指定范围的 Flash 页面
  //  * @param {number} startPage - 起始页码
  //  * @param {number} pageCount - 要擦除的页数
  //  * @param {number} [batchSize=511] - 每批最大页数（某些芯片限制，默认511）
  //  * @returns {Promise<void>}
  //  */
  // async erasePages2(startPage, pageCount, batchSize = 511) {
  //   if (pageCount === 0) return;
  //   if (startPage < 0 || pageCount < 0) {
  //     throw new Error("起始页和页数必须为非负数");
  //   }

  //   // 检查芯片支持的命令
  //   const hasExtErase = this.supportedCommands.has(COMMANDS.EXTENDED_ERASE); // 0x44
  //   const hasLegacyErase = this.supportedCommands.has(COMMANDS.ERASE); // 0x43

  //   if (!hasExtErase && !hasLegacyErase) {
  //     throw new Error("芯片不支持任何擦除命令 (0x43/0x44)");
  //   }

  //   // 优先使用扩展擦除（0x44），它支持更多页数且页码为2字节
  //   const useExt = hasExtErase;
  //   const eraseCmd = useExt ? COMMANDS.EXTENDED_ERASE : COMMANDS.ERASE;

  //   // 分批处理
  //   let remaining = pageCount;
  //   let currentPage = startPage;

  //   while (remaining > 0) {
  //     const batch = Math.min(remaining, batchSize);
  //     await this._erasePagesBatch(currentPage, batch, eraseCmd, useExt);
  //     currentPage += batch;
  //     remaining -= batch;
  //   }
  // }

  // /**
  //  * 擦除单批页面（内部方法）
  //  * @param {number} startPage - 本批起始页
  //  * @param {number} count - 本批页数
  //  * @param {number} cmd - 擦除命令 (0x43 或 0x44)
  //  * @param {boolean} extended - 是否扩展擦除（影响页码编码长度）
  //  * @private
  //  */
  // async _erasePagesBatch(startPage, count, cmd, extended) {
  //   // 构造 payload
  //   const payload = [];

  //   if (extended) {
  //     // 扩展擦除：页数-1 用2字节（大端）
  //     const pagesMinusOne = count - 1;
  //     payload.push((pagesMinusOne >> 8) & 0xff);
  //     payload.push(pagesMinusOne & 0xff);
  //     // 页码：每个2字节（大端）
  //     for (let i = 0; i < count; i++) {
  //       const page = startPage + i;
  //       payload.push((page >> 8) & 0xff);
  //       payload.push(page & 0xff);
  //     }
  //   } else {
  //     // 常规擦除：页数-1 用1字节（页码0~255，否则报错）
  //     if (count > 256) throw new Error("常规擦除单批最多256页");
  //     payload.push(count - 1);
  //     for (let i = 0; i < count; i++) {
  //       const page = startPage + i;
  //       if (page > 255)
  //         throw new Error(`常规擦除页码不能超过255，当前 ${page}`);
  //       payload.push(page);
  //     }
  //   }

  //   // 计算校验和（除校验和自身外所有字节的异或）
  //   const checksum = payload.reduce((a, b) => a ^ b, 0);
  //   payload.push(checksum);

  //   console.log(
  //     `[Erase] 起始页 ${startPage}, 数量 ${count}, 命令 0x${cmd.toString(16)}, 扩展: ${extended}`,
  //   );
  //   console.log(
  //     `[Erase] Payload: ${payload.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ")}`,
  //   );

  //   // 发送命令
  //   await this.sendCommand(cmd);
  //   await this.transport.write(new Uint8Array(payload));
  //   // 擦除时间 = 每页约 20ms，但实际可能更长，设置足够超时
  //   const timeoutMs = Math.max(10000, count * 50); // 至少10秒，每页50ms
  //   await this.expectAck(timeoutMs);
  // }

  async readoutUnprotect() {
    await this.sendCommand(COMMANDS.READOUT_UNPROTECT);
    await this.expectAck();
    await this.expectAck(15000);
  }

  async go(address) {
    await this.sendCommand(COMMANDS.GO);
    await this.transport.write(addressPacket(address));
    await this.expectAck();
  }

  async writeMemory(address, bytes, packetSize = 256) {
    let offset = 0;
    while (offset < bytes.length) {
      const rawChunk = bytes.slice(offset, offset + packetSize);
      const chunk = padForWrite(rawChunk);
      await this.sendCommand(COMMANDS.WRITE_MEMORY);
      await this.transport.write(addressPacket(address + offset));
      await this.expectAck();
      await this.transport.write(writePacket(chunk));
      await this.expectAck();
      offset += rawChunk.length;
      this.onProgress({ phase: "write", offset, total: bytes.length });
    }
  }

  async readMemory(address, length, packetSize = 256) {
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const size = Math.min(packetSize, length - offset);
      await this.sendCommand(COMMANDS.READ_MEMORY);
      await this.transport.write(addressPacket(address + offset));
      await this.expectAck();
      await this.transport.write(readLengthPacket(size));
      await this.expectAck();
      result.set(await this.transport.readExact(size, this.timeout), offset);
      offset += size;
      this.onProgress({ phase: "verify", offset, total: length });
    }
    return result;
  }

  async verify(address, expected, packetSize = 256) {
    const actual = await this.readMemory(address, expected.length, packetSize);
    for (let i = 0; i < expected.length; i += 1) {
      if (actual[i] !== expected[i]) {
        throw new Error(
          `Verify failed at ${toHex(address + i, 8)}: expected ${toHex(expected[i])}, got ${toHex(actual[i])}`,
        );
      }
    }
  }

  async sendCommand(command) {
    await this.transport.write(commandPacket(command));
    await this.expectAck();
  }

  async expectAck(timeout = this.timeout) {
    const byte = (await this.transport.readExact(1, timeout))[0];
    if (byte === ACK) return;
    if (byte === NACK) throw new Error("Bootloader returned NACK");
    throw new Error(`Unexpected response ${toHex(byte)}`);
  }
}
