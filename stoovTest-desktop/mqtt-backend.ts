// ---------------------------------------------------------------------------
// 桌面版后台 MQTT：由 Deno 后台持有一条到 EMQX broker 的原生连接（npm:mqtt），
// 前端通过本地 /ws/mqtt 与后台通信，实现「前端 UI 与 broker 解耦」。
//
// 中继职责：
//   1) 把前端的 publish 原样转发到 broker（上云）；
//   2) 拦截“保存结果”主题，顺带写入本地 SQLite（写本地库）——
//      于是同一次 publish 既上云又落盘，正好满足“两者都要”，前端零改动；
//   3) 把 broker 的连接状态广播给所有前端，用于页面“MQTT 连接成功”指示。
// ---------------------------------------------------------------------------

import mqtt, { type MqttClient } from "mqtt";
import { StoovStore, type SavePayload } from "./sqlite-store.ts";

export type MqttConfig = {
  url: string;
  username?: string;
  password?: string;
  reconnectPeriod?: number;
  connectTimeout?: number;
};

// 保存结果主题 -> 本地库模式（对齐 saveTest 里的两处 publish）
const SAVE_TOPICS: Record<string, "external" | "internal"> = {
  "/unito/stoov/heating-bed/save/yaokong": "external",
  "/unito/stoov/heating-bed/save/heating": "internal",
};

let broker: MqttClient | null = null;
const status = {
  connected: false,
  reconnecting: false,
  offline: true,
  error: "",
};
const sockets = new Set<WebSocket>();

function broadcast(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const socket of [...sockets]) {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }
}

function pushStatus(): void {
  broadcast({ ev: "status", ...status });
}

/** 启动后台 broker 连接（进程内单例）。 */
export function initMqttBackend(config: MqttConfig): void {
  if (broker) return;
  broker = mqtt.connect(config.url, {
    username: config.username,
    password: config.password,
    clientId: "stoov-desktop-" + Math.random().toString(16).substring(2, 10),
    clean: true,
    reconnectPeriod: config.reconnectPeriod ?? 5000,
    connectTimeout: config.connectTimeout ?? 10000,
  });

  broker.on("connect", () => {
    status.connected = true;
    status.offline = false;
    status.reconnecting = false;
    status.error = "";
    console.log("✅ [mqtt] broker 已连接");
    pushStatus();
  });
  broker.on("reconnect", () => {
    status.reconnecting = true;
    status.connected = false;
    console.log("🔄 [mqtt] 重连中...");
    pushStatus();
  });
  broker.on("close", () => {
    status.connected = false;
    pushStatus();
  });
  broker.on("offline", () => {
    status.connected = false;
    status.offline = true;
    pushStatus();
  });
  broker.on("error", (error: Error) => {
    status.error = error.message;
    console.error("❌ [mqtt] 错误:", error.message);
    pushStatus();
  });
}

export function mqttBackendStatus() {
  return { ...status };
}

/** 处理 /ws/mqtt 的 WebSocket 升级：前端发布 -> 上云 (+ save 主题落本地库)。 */
export function upgradeMqttSocket(
  request: Request,
  store: StoovStore,
): Response {
  const { socket, response } = Deno.upgradeWebSocket(request);

  socket.onopen = () => {
    sockets.add(socket);
    // 立刻回一帧当前状态，让前端指示器与实际连接一致
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ ev: "status", ...status }));
    }
  };
  socket.onclose = () => sockets.delete(socket);
  socket.onerror = () => sockets.delete(socket);

  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.op !== "publish") return;

    const topic = String(msg.topic ?? "");
    const payload =
      typeof msg.payload === "string" ? msg.payload : String(msg.payload ?? "");

    // 1) save 主题：写本地 SQLite（失败不影响上云）
    const mode = SAVE_TOPICS[topic];
    if (mode) {
      try {
        const data = JSON.parse(payload) as SavePayload;
        data.mode = mode;
        store.save(data);
        console.log(`💾 [store] 已写入本地 ${mode} 测试记录`);
      } catch (error) {
        console.error(
          "💾 [store] 写入失败:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // 2) 转发上云，并回执前端（用于 mqttClient.publish 的回调）
    const ack = (ok: boolean, err: string) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ ev: "published", id: msg.id, ok, error: err }));
      }
    };
    if (broker) {
      broker.publish(
        topic,
        payload,
        { qos: (Number(msg.qos ?? 0) === 1 ? 1 : Number(msg.qos ?? 0) === 2 ? 2 : 0) as 0 | 1 | 2 },
        (error) => ack(!error, error ? String(error.message ?? error) : ""),
      );
    } else {
      ack(false, "broker 未连接");
    }
  };

  return response;
}
