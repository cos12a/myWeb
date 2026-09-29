// ---------------------------------------------------------------------------
// 桌面版：Web Serial 兼容层（覆盖进 static/src/，原项目不使用此文件）。
//
// 目的：stoov 的 main.js 直接按 Web Serial 形状操作端口对象
//   port = await navigator.serial.requestPort()
//   await port.open(options)
//   port.readable.getReader() / port.writable.getWriter() / port.close()
// 桌面版没有浏览器 Web Serial，改为 Win32 原生串口（经本地 /ws/serial 桥）。
// 为了让 main.js 尽量零改动，这里把“已打开的原生串口传输层”包装成一个
// 与 Web Serial SerialPort 接口形状一致的对象（open/close/readable/writable/getInfo）。
//
// 选口 + 参数设置弹窗复用 native-serial-dialog.js：点“确定”即真正打开，
// 成功关窗并交付已打开的 transport，失败留窗显示原因、可重试或取消。
// ---------------------------------------------------------------------------

import { NativeSerialTransport } from "./native-serial-transport.js?v=desktop";
import { openNativeSerialDialog } from "./native-serial-dialog.js?v=desktop";

function asBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return new Uint8Array(chunk);
}

/**
 * 替代 navigator.serial.requestPort()：弹出参数设置窗，点确定即真正打开原生串口，
 * 返回一个兼容 Web Serial 端口形状的对象（供 main.js 原有读写循环直接使用）。
 * @param {{ log?:Function, getDebugRaw?:Function, defaults?:object }} [opts]
 */
export async function requestNativeSerialPort(opts = {}) {
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const getDebugRaw =
    typeof opts.getDebugRaw === "function" ? opts.getDebugRaw : () => false;

  // 弹窗内部完成“确定 -> 真正打开”，成功时返回已 open 的 transport
  const { transport } = await openNativeSerialDialog({
    log,
    getDebugRaw,
    defaults: opts.defaults || {},
  });

  let readController = null;

  const readable = new ReadableStream({
    start(controller) {
      readController = controller;
      // 二进制帧到达即 enqueue，main.js 的 reader.read() 循环据此持续取数
      transport.setDataListener((bytes) => {
        try {
          controller.enqueue(bytes);
        } catch {
          /* 控制器已关闭，忽略 */
        }
      });
    },
    cancel() {
      transport.setDataListener(null);
    },
  });

  const writable = new WritableStream({
    write(chunk) {
      return transport.write(asBytes(chunk));
    },
  });

  // 串口被拔出 / 桥断开：让读循环以错误退出（对齐 Web Serial 断开语义）
  transport.onDisconnect = () => {
    transport.setDataListener(null);
    try {
      readController?.error(new Error("串口已断开"));
    } catch {
      /* 已关闭，忽略 */
    }
  };

  return {
    // 供调试/复用：真正的原生传输层
    __nativeTransport: transport,
    getInfo: () => ({}),
    // 弹窗已把串口打开，这里保持与 Web Serial 相同的调用形状但为空操作
    open: async () => {},
    readable,
    writable,
    close: async () => {
      transport.setDataListener(null);
      try {
        readController?.close();
      } catch {
        /* 已关闭，忽略 */
      }
      await transport.close();
    },
  };
}
