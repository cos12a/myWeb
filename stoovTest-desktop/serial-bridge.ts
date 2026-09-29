// ---------------------------------------------------------------------------
// 串口 WebSocket 桥：把 NativeSerialPort（Win32 FFI）暴露给浏览器前端。
//
// 协议（前端 -> 后端，JSON 文本帧）：
//   {op:"open", path:"COM3", baudRate, dataBits, stopBits, parity}
//   {op:"write", data:"<base64>"}
//   {op:"signals", dataTerminalReady?:boolean, requestToSend?:boolean}
//   {op:"close"}
// 协议（后端 -> 前端）：
//   {ev:"opened"} / {ev:"error", message} / {ev:"closed"} / {ev:"signals"}（拉线已生效回执）
//   二进制帧 = 串口收到的原始字节
//
// 桌面单用户场景：全局仅保留一个活动会话，新 open 会顶替旧会话；
// WebSocket 断开（浏览器关闭/刷新）时自动关闭串口，避免 COM 口被锁死。
// ---------------------------------------------------------------------------

import { listSerialPorts, NativeSerialPort } from "./serial-ffi.ts";

type Session = {
  socket: WebSocket;
  port: NativeSerialPort | null;
};

let active: Session | null = null;

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function closeSession(session: Session, reason?: string): void {
  if (active === session) active = null;
  if (session.port) {
    session.port.close();
    session.port = null;
  }
  if (reason) sendJson(session.socket, { ev: "error", message: reason });
  sendJson(session.socket, { ev: "closed" });
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function attach(session: Session): void {
  const { socket } = session;
  socket.binaryType = "arraybuffer";

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data);
    } catch {
      sendJson(socket, { ev: "error", message: "无效的 JSON 消息" });
      return;
    }

    try {
      switch (message.op) {
        case "open": {
          const path = String(message.path ?? "");
          if (!path) throw new Error("缺少串口路径");
          // 顶替旧会话（例如用户在第二个标签页重新选口）
          if (active && active !== session) {
            closeSession(active, "串口已被新的连接接管");
          }
          active = session;
          // 若当前会话已持有串口，先释放
          session.port?.close();

          const port = new NativeSerialPort(path);
          port.onData = (chunk) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
          };
          port.onError = (error) => closeSession(session, error.message);
          port.open({
            baudRate: Number(message.baudRate ?? 115200),
            dataBits: Number(message.dataBits ?? 8),
            stopBits: Number(message.stopBits ?? 1),
            parity: (message.parity as "none" | "even" | "odd") ?? "none",
          });
          session.port = port;
          sendJson(socket, { ev: "opened", path: port.path });
          break;
        }
        case "write": {
          if (!session.port) throw new Error("串口未打开");
          session.port.write(fromBase64(String(message.data ?? "")));
          break;
        }
        case "signals": {
          if (!session.port) throw new Error("串口未打开");
          session.port.setSignals({
            dataTerminalReady: message.dataTerminalReady as
              | boolean
              | undefined,
            requestToSend: message.requestToSend as boolean | undefined,
          });
          // 回执：前端据此对齐复位时序的delay起点，保证 DTR/RTS 时序确定性
          sendJson(socket, { ev: "signals" });
          break;
        }
        case "close": {
          closeSession(session);
          break;
        }
        default:
          sendJson(socket, {
            ev: "error",
            message: `未知操作: ${String(message.op)}`,
          });
      }
    } catch (error) {
      sendJson(socket, {
        ev: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  socket.onclose = () => closeSession(session);
  socket.onerror = () => closeSession(session);
}

/** 处理 /ws/serial 的 WebSocket 升级请求 */
export function upgradeSerialSocket(request: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(request);
  const session: Session = { socket, port: null };
  socket.onopen = () => attach(session);
  return response;
}

/** 处理 GET /api/serial/ports：返回当前系统可用 COM 口列表 */
export async function portsResponse(): Promise<Response> {
  const ports = await listSerialPorts();
  return new Response(
    JSON.stringify({ ports: ports.map((path) => ({ path })) }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
