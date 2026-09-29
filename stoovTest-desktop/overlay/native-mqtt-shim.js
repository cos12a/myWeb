// ---------------------------------------------------------------------------
// 桌面版：MQTT 前端垫片（classic 脚本，覆盖 index.html 里原来的 mqtt.min.js）。
//
// 提供与浏览器 mqtt.js 同名、同调用形状的全局 `mqtt`，但真正连 broker 的动作
// 在 Deno 后台完成（后台持有一条 EMQX 连接，前端与 broker 解耦）：
//   前端 --/ws/mqtt--> 本地后台 --原生 MQTT--> EMQX broker
//
// main.js 现有用法全部兼容，无需改动：
//   mqtt.connect(url, opts)            -> 返回 client（url/opts 由后台自行读取配置，前端忽略）
//   client.on("connect"|"error"|"close"|"reconnect"|"offline", cb)
//   client.publish(topic, payload, {qos}, cb)
//   client.end(force, cb)
// ---------------------------------------------------------------------------

(function initNativeMqttShim() {
  class MqttClientShim {
    constructor() {
      this._handlers = {};
      this._ws = null;
      this._pending = {};
      this._seq = 0;
      this._connected = false;
    }

    on(event, cb) {
      (this._handlers[event] || (this._handlers[event] = [])).push(cb);
      return this;
    }

    _emit(event, ...args) {
      (this._handlers[event] || []).forEach((cb) => {
        try {
          cb(...args);
        } catch (err) {
          console.error("mqtt shim handler error:", err);
        }
      });
    }

    _bridgeUrl() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${location.host}/ws/mqtt`;
    }

    _open() {
      this._ws = new WebSocket(this._bridgeUrl());

      this._ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.ev === "status") {
          if (msg.error) this._emit("error", { message: msg.error });
          const was = this._connected;
          this._connected = !!msg.connected;
          if (msg.connected) {
            this._emit("connect");
          } else {
            if (was) this._emit("close");
            if (msg.offline) this._emit("offline");
            else if (msg.reconnecting) this._emit("reconnect");
          }
        } else if (msg.ev === "published") {
          const p = this._pending[msg.id];
          if (p) {
            delete this._pending[msg.id];
            if (p.cb) p.cb(null);
          }
        }
      };

      this._ws.onclose = () => {
        const was = this._connected;
        this._connected = false;
        if (was) this._emit("close");
        this._emit("offline");
      };

      this._ws.onerror = () =>
        this._emit("error", { message: "本地 MQTT 桥连接失败" });
    }

    publish(topic, payload, options, cb) {
      if (typeof options === "function") {
        cb = options;
        options = {};
      }
      options = options || {};
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        if (cb) cb(new Error("MQTT 桥未就绪"));
        return this;
      }
      const id = ++this._seq;
      if (cb) this._pending[id] = { cb };
      this._ws.send(
        JSON.stringify({
          op: "publish",
          id,
          topic,
          payload: typeof payload === "string" ? payload : String(payload),
          qos: options.qos || 0,
        }),
      );
      return this;
    }

    end(_force, cb) {
      try {
        if (this._ws) this._ws.close();
      } catch {
        /* 忽略 */
      }
      this._connected = false;
      if (cb) cb();
      return this;
    }
  }

  window.mqtt = {
    // 后台自行从本地配置读取 broker 地址与凭据，这里 url/opts 仅为兼容签名
    connect(_url, _opts) {
      const client = new MqttClientShim();
      client._open();
      return client;
    },
  };
})();
