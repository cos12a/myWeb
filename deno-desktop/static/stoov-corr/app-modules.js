/**
 * app-modules.js — Stoov Bed 加热垫控制面板 模块化架构
 * ============================================================
 * 模块划分:
 *   App.Logger       — 日志模块
 *   App.Protocol     — 协议解析/组装模块
 *   App.Interfaces   — 通信接口模块 (BLE / Serial / MQTT / Manager)
 *   App.Processor    — 数据处理模块 (消息处理 / 温度解析 / 状态管理)
 *   App.UI           — 界面模块 (温度/状态/日志/面板)
 *   App.Controller   — 主控模块 (初始化 / 命令发送 / 事件绑定)
 */

(function () {
  'use strict';

  // ===================================================================
  //  Module: App.Logger  —  日志输出
  // ===================================================================
  const Logger = {
    container: null,
    mqttMsgCountMap: {},

    init() {
      this.container = document.getElementById('bleLogContainer');
    },

    /** 添加一条日志 */
    add(type, message) {
      if (!this.container) return;
      const emptyMsg = this.container.querySelector('.log-empty');
      if (emptyMsg) emptyMsg.remove();

      const now = new Date();
      const time = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' +
        String(now.getMilliseconds()).padStart(3, '0');

      const isStringType = type.includes('str');
      let formattedMessage = message;
      if (isStringType) {
        formattedMessage = message
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\r\n/g, '<br>').replace(/\n/g, '<br>').replace(/ /g, '&nbsp;');
        type = type.replace(/(_str)/gi, '');
      }

      const entry = document.createElement('div');
      entry.className = 'log-entry';
      const dataClass = type === 'send' ? 'send-data' : '';
      entry.innerHTML = `<span class="log-time">${time}</span><span class="log-type ${type}">${type}</span><span class="log-data ${dataClass}">${formattedMessage}</span>`;
      this.container.appendChild(entry);
      this.container.scrollTop = this.container.scrollHeight;

      const entries = this.container.querySelectorAll('.log-entry');
      if (entries.length > 200) entries[0].remove();
    },

    /** 固定行日志更新（MQTT用，每种类型独立占一行） */
    updateLine(lineId, typeLabel, message) {
      if (!this.mqttMsgCountMap[lineId]) this.mqttMsgCountMap[lineId] = 0;
      this.mqttMsgCountMap[lineId]++;
      const now = new Date();
      const time = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' +
        String(now.getMilliseconds()).padStart(3, '0');
      if (!this.container) return;
      const emptyMsg = this.container.querySelector('.log-empty');
      if (emptyMsg) emptyMsg.remove();

      const elId = 'mqttLine_' + lineId;
      let entry = document.getElementById(elId);
      if (!entry) {
        entry = document.createElement('div');
        entry.id = elId;
        entry.className = 'log-entry';
        entry.style.background = 'rgba(255,107,53,0.08)';
        entry.style.borderLeft = '2px solid var(--accent-orange)';
        entry.innerHTML = `<span class="log-time"></span><span class="log-type info">${typeLabel}</span><span class="log-data" style="color:var(--accent-orange)"></span>`;
        this.container.appendChild(entry);
      }
      entry.querySelector('.log-time').textContent = time;
      entry.querySelector('.log-data').textContent = message + `  [×${this.mqttMsgCountMap[lineId]}]`;
      this.container.scrollTop = this.container.scrollHeight;
    },

    clear() {
      if (this.container)
        this.container.innerHTML = '<div class="log-empty">日志已清除</div>';
      for (const key of Object.keys(this.mqttMsgCountMap)) delete this.mqttMsgCountMap[key];
    }
  };

  // 全局快捷引用
  const bleAddLog = (t, m) => Logger.add(t, m);

  // ===================================================================
  //  Module: App.Protocol  —  协议常量 / 解析器 / 组装器
  // ===================================================================
  const Protocol = {
    // 这些常量由 serial-protocol.min.js 在全局注入 (MSGTYPE, MSGOP)
    parser: null,
    assembler: null,
    mqttParser: null,

    TARGET_ADDR: 0x02,
    SENDER_ADDR: 0x08,

    ensureParser() {
      if (!this.parser && typeof SerialDataParser !== 'undefined')
        this.parser = new SerialDataParser();
      return this.parser;
    },
    ensureAssembler() {
      if (!this.assembler && typeof SerialDataAssembler !== 'undefined')
        this.assembler = new SerialDataAssembler();
      return this.assembler;
    },
    ensureMqttParser() {
      if (!this.mqttParser && typeof SerialDataParser !== 'undefined')
        this.mqttParser = new SerialDataParser();
      return this.mqttParser;
    },

    /** 获取消息类型名称 */
    getMsgTypeName(msgId) {
      const names = {
        [MSGTYPE.WORK]: '工作设置',
        [MSGTYPE.ERROR]: '错误上报',
        [MSGTYPE.END]: '结束',
        [MSGTYPE.CTRL_WORK]: '远程控制工作',
        [MSGTYPE.TH]: '阈值设置',
        [MSGTYPE.PERIODIC_TEMP]: '温度周期',
        [MSGTYPE.UNITO_MSGTYPE_SYSID]: '设备ID',
        [MSGTYPE.UNITO_SET_TEMP01C]: '设置温度',
        [MSGTYPE.UNITO_SET_TIME]: '设置时间',
        [MSGTYPE.UNITO_SET_REBOOT]: '重启设备',
        [MSGTYPE.UNITO_SET_CLEAR_FAULT]: '清除故障',
        [MSGTYPE.UNITO_MSGTYPE_SIM_TEMP]: '模拟温度',
        [MSGTYPE.UNITO_MSGTYPE_SENSOR_CAL]: '传感器标定',
      };
      return names[msgId] || `UNKNOWN(0x${msgId.toString(16).toUpperCase()})`;
    },

    /** 获取操作类型名称 */
    getOpTypeName(opType) {
      const names = {
        [MSGOP.GET]: 'GET',
        [MSGOP.SET]: 'SET',
        [MSGOP.CLEAR]: 'CLEAR',
        [MSGOP.RESPONSE]: 'RESPONSE',
        [MSGOP.REPORT]: 'REPORT',
      };
      return names[opType] || `UNKNOWN(${opType})`;
    },

    /** 判断数据是否为可打印字符串 */
    isPrintableString(data) {
      if (!data || data.length === 0) return false;
      let cnt = 0;
      for (const b of data) {
        if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) cnt++;
      }
      return cnt / data.length >= 0.8;
    }
  };

  // ===================================================================
  //  Module: App.Interfaces.Manager  —  统一通信调度
  // ===================================================================
  const InterfaceManager = {
    config: { ble: { rx: false, tx: false }, serial: { rx: false, tx: false }, mqtt: { rx: false, tx: false } },

    // DOM refs
    elems: {},

    init() {
      const g = (id) => document.getElementById(id);
      this.elems = {
        bleCommDot: g('bleCommDot'), bleConnectBtn: g('bleConnectBtn'),
        bleRxCheck: g('bleRxCheck'), bleTxCheck: g('bleTxCheck'),
        serialCommDot: g('serialCommDot'), serialToggleBtn: g('serialToggleBtn'),
        serialRxCheck: g('serialRxCheck'), serialTxCheck: g('serialTxCheck'),
        mqttCommDot: g('mqttCommDot'), mqttConnectBtn: g('mqttConnectBtn'),
        mqttRxCheck: g('mqttRxCheck'), mqttTxCheck: g('mqttTxCheck'),
      };
    },

    /** 更新面板UI：指示灯 + 复选框 + 按钮文字 */
    updateUI() {
      const E = this.elems;

      // BLE
      if (E.bleCommDot) E.bleCommDot.className = 'comm-dot' + (App.Interfaces.BLE.connected ? ' on' : '');
      if (E.bleConnectBtn) E.bleConnectBtn.textContent = App.Interfaces.BLE.connected ? '断开蓝牙' : '连接蓝牙';
      if (E.bleRxCheck) E.bleRxCheck.disabled = !App.Interfaces.BLE.connected;
      if (E.bleTxCheck) E.bleTxCheck.disabled = !App.Interfaces.BLE.connected;
      if (!App.Interfaces.BLE.connected) {
        if (E.bleRxCheck) E.bleRxCheck.checked = false;
        if (E.bleTxCheck) E.bleTxCheck.checked = false;
        this.config.ble.rx = false; this.config.ble.tx = false;
      } else {
        if (E.bleRxCheck && !E.bleRxCheck.checked) { E.bleRxCheck.checked = true; this.config.ble.rx = true; }
        if (E.bleTxCheck && !E.bleTxCheck.checked) { E.bleTxCheck.checked = true; this.config.ble.tx = true; }
      }

      // Serial
      if (E.serialCommDot) E.serialCommDot.className = 'comm-dot' + (App.Interfaces.Serial.connected ? ' on' : '');
      if (E.serialToggleBtn) E.serialToggleBtn.textContent = App.Interfaces.Serial.connected ? '断开串口' : '连接串口';
      if (E.serialRxCheck) E.serialRxCheck.disabled = !App.Interfaces.Serial.connected;
      if (E.serialTxCheck) E.serialTxCheck.disabled = !App.Interfaces.Serial.connected;
      if (!App.Interfaces.Serial.connected) {
        if (E.serialRxCheck) E.serialRxCheck.checked = false;
        if (E.serialTxCheck) E.serialTxCheck.checked = false;
        this.config.serial.rx = false; this.config.serial.tx = false;
      } else {
        if (E.serialRxCheck && !E.serialRxCheck.checked) { E.serialRxCheck.checked = true; this.config.serial.rx = true; }
        if (E.serialTxCheck && !E.serialTxCheck.checked) { E.serialTxCheck.checked = true; this.config.serial.tx = true; }
      }

      // MQTT：页面不显示（默认连接，仅用于标定结果上报）

      // BLE/串口 全部断开时，重置监测数据为初始状态
      if (!App.Interfaces.BLE.connected && !App.Interfaces.Serial.connected) {
        App.UI.resetMonitoring();
      }
    },

    /** 复选框变更回调 */
    onCheckChange() {
      const E = this.elems;
      this.config.ble.rx = !!(E.bleRxCheck && E.bleRxCheck.checked);
      this.config.ble.tx = !!(E.bleTxCheck && E.bleTxCheck.checked);
      this.config.serial.rx = !!(E.serialRxCheck && E.serialRxCheck.checked);
      this.config.serial.tx = !!(E.serialTxCheck && E.serialTxCheck.checked);
      this.config.mqtt.rx = !!(E.mqttRxCheck && E.mqttRxCheck.checked);
      this.config.mqtt.tx = !!(E.mqttTxCheck && E.mqttTxCheck.checked);
    },

    /** 任一发送通道可用？（MQTT 不参与指令发送，仅用于标定结果上报） */
    hasAnyTx() {
      const c = this.config;
      return (c.ble.tx && App.Interfaces.BLE.connected) ||
        (c.serial.tx && App.Interfaces.Serial.connected);
    },

    /** 任一接收通道开启？ */
    hasAnyRx() {
      const c = this.config;
      return (c.ble.rx && App.Interfaces.BLE.connected) ||
        (c.serial.rx && App.Interfaces.Serial.connected) ||
        (c.mqtt.rx && App.Interfaces.MQTT.connected);
    }
  };

  // ===================================================================
  //  Module: App.Interfaces.BLE  —  蓝牙接口
  // ===================================================================
  const BLE = {
    SERVICE_UUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
    CHAR_NOTIFY_UUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
    CHAR_WRITE_UUID: '0000ffe2-0000-1000-8000-00805f9b34fb',
    DEVICE_NAME_FILTER: 'UnitoBed',

    device: null, server: null, charNotify: null, charWrite: null,
    connected: false,

    /** 连接/断开切换 */
    async toggle() {
      if (this.connected) { await this.disconnect(); } else { await this.connect(); }
    },

    async connect() {
      if (!('bluetooth' in navigator)) { alert('浏览器不支持 Web Bluetooth API'); return; }
      if (this.connected) {
        Logger.add('info', 'BLE: 已连接，跳过重复连接');
        return;
      }
      // 先清理旧状态
      this.device = null; this.server = null;
      this.charNotify = null; this.charWrite = null;
      try {
        Logger.add('info', 'BLE: 正在搜索设备...');
        this.device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: this.DEVICE_NAME_FILTER }],
          optionalServices: [this.SERVICE_UUID]
        });
        if (!this.device) throw new Error('未选择设备');
        Logger.add('info', `BLE: 已选择 "${this.device.name}", 正在连接GATT...`);
        // 先注册断开监听，再连接（参考 stoov-check.html 的做法）
        this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
        this.server = await this.device.gatt.connect();
        // GATT 连接后稍等片刻，让服务就绪
        await new Promise(r => setTimeout(r, 300));
        const service = await this.server.getPrimaryService(this.SERVICE_UUID);
        this.charNotify = await service.getCharacteristic(this.CHAR_NOTIFY_UUID);
        this.charWrite = await service.getCharacteristic(this.CHAR_WRITE_UUID);
        // 订阅通知
        await this.charNotify.startNotifications();
        this.charNotify.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e));
        // 初始化协议解析器
        Protocol.ensureParser(); Protocol.ensureAssembler();
        this.connected = true;
        Logger.add('info', 'BLE: 连接成功 ✓');
        App.Controller.startHeartbeat();
        InterfaceManager.updateUI();
      } catch (err) {
        Logger.add('error', `BLE: 连接失败 - ${err.message}`);
        // 不在这里 null device，_onDisconnected 会处理清理
        this.connected = false;
        this.server = null;
        this.charNotify = null; this.charWrite = null;
        InterfaceManager.updateUI();
        // 用户取消选择蓝牙设备时不弹窗（NotFoundError/AbortError）
        if (!(err && (err.name === 'NotFoundError' || err.name === 'AbortError'))) {
          alert('蓝牙连接失败！\n\n错误信息: ' + (err && err.message ? err.message : '未知错误') + '\n\n请检查蓝牙设备后重试。');
        }
      }
    },

    async disconnect() {
      try {
        if (this.device && this.device.gatt && this.device.gatt.connected) {
          this.device.gatt.disconnect();
        }
      } catch (e) {
        Logger.add('error', 'BLE: 断开异常 - ' + e.message);
      }
      this.connected = false;
      this.charNotify = null; this.charWrite = null;
      this.server = null; this.device = null;
      Logger.add('info', 'BLE: 已断开');
      if (!App.Interfaces.Serial.connected) App.Controller.stopHeartbeat();
      InterfaceManager.updateUI();
    },

    _onDisconnected() {
      Logger.add('info', 'BLE: 设备断开连接');
      this.connected = false;
      this.charNotify = null; this.charWrite = null;
      this.server = null;
      // 故意不清理 this.device，让用户可重新连接同一设备
      if (!App.Interfaces.Serial.connected) App.Controller.stopHeartbeat();
      InterfaceManager.updateUI();
    },

    /** 通知回调 → 转发给 Processor */
    _onNotify(event) {
      if (!InterfaceManager.config.ble.rx) return;
      const val = event.target.value;
      if (!val || val.byteLength === 0) return;
      const data = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
      if (Protocol.isPrintableString(data)) {
        Logger.add('recv_str', '[BLE] ' + new TextDecoder().decode(data));
        return;
      }
      App.Processor.feedBinary(data);
    },

    /** 发送数据 */
    async send(bytes) {
      if (!this.charWrite || !this.connected) return;
      let b;
      if (bytes instanceof Uint8Array) b = bytes;
      else if (ArrayBuffer.isView(bytes)) b = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      else if (typeof bytes === 'string') {
        const h = bytes.replace(/\s/g, ''); const a = [];
        for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16));
        b = new Uint8Array(a);
      } else return;
      await this.charWrite.writeValueWithoutResponse(b);
      Logger.add('send', '[BLE] ' + Array.from(b).map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    }
  };

  // ===================================================================
  //  Module: App.Interfaces.Serial  —  串口接口
  // ===================================================================
  const Serial = {
    BAUD_RATE: 115200,
    port: null, currentPort: null, reader: null,
    connected: false, reading: false, _disconnecting: false,
    writeQueue: [], writing: false,

    /** 连接/断开切换 */
    async toggle() {
      if (this.connected) { await this.disconnect(); } else { await this.connect(); }
    },

    async connect() {
      if (!('serial' in navigator)) { alert('浏览器不支持 Web Serial API'); return; }
      if (this.reading) { Logger.add('info', '串口已在读取中'); return; }
      try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: this.BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none' });
        this.currentPort = this.port;
        this.connected = true; this.reading = true; this._disconnecting = false;
        Protocol.ensureParser(); Protocol.ensureAssembler();
        Logger.add('info', '串口已连接');
        InterfaceManager.updateUI();
        App.Controller.startHeartbeat();
        await this._readLoop(this.port);
      } catch (err) {
        this.connected = false; this.reading = false;
        Logger.add('error', '串口连接失败: ' + err.message);
        InterfaceManager.updateUI();
        // 用户取消选择串口时不弹窗（NotFoundError/AbortError）
        if (!(err && (err.name === 'NotFoundError' || err.name === 'AbortError'))) {
          alert('串口连接失败！\n\n错误信息: ' + (err && err.message ? err.message : '未知错误') + '\n\n请检查串口连接后重试。');
        }
      }
    },

    async disconnect() {
      this._disconnecting = true;
      // 保存本地引用，防止 _readLoop finally 中清空
      const r = this.reader;
      const p = this.currentPort;
      // 1. 取消 reader → _readLoop 的 read() 抛出 → catch → finally releaseLock
      if (r) {
        try { await r.cancel(); } catch (e) { }
      }
      // 2. 等待 readLoop 的 finally 执行完毕（释放 reader lock）
      let wait = 0;
      while (this.reading && wait < 30) {
        await new Promise(resolve => setTimeout(resolve, 100));
        wait++;
      }
      // 3. 关闭串口（此时 reader lock 已释放）
      if (p) {
        try { await p.close(); } catch (e) { Logger.add('error', '串口关闭异常: ' + e.message); }
      }
      // 4. 清理状态
      this.port = null;
      this.currentPort = null;
      this.reader = null;
      this.connected = false;
      this.reading = false;
      this._disconnecting = false;
      // 清空写入队列
      this.writeQueue = [];
      this.writing = false;
      Logger.add('info', '串口已断开');
      if (!App.Interfaces.BLE.connected) App.Controller.stopHeartbeat();
      InterfaceManager.updateUI();
    },

    async _readLoop(port) {
      if (!port || !port.readable) { this.reading = false; return; }
      this.reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) { Logger.add('info', '串口读取器已关闭'); break; }
          if (value && value.length > 0) {
            if (Protocol.isPrintableString(value)) {
              Logger.add('recv_str', '[串口] ' + new TextDecoder().decode(value));
            } else {
              if (!InterfaceManager.config.serial.rx) continue;
              App.Processor.feedBinary(value);
            }
          }
        }
      } catch (err) {
        if (!this._disconnecting) {
          Logger.add('error', '串口读取错误: ' + err.message);
        }
        this.connected = false; this.reading = false;
        InterfaceManager.updateUI();
      } finally {
        // 关键：释放 reader lock，否则串口无法被其他软件使用
        try { if (this.reader) { this.reader.releaseLock(); } } catch (e) { }
        this.reader = null;
        this.reading = false;
        // 注意：不要在这里清 currentPort，disconnect() 会处理
      }
    },

    async send(data) {
      if (!this.port || !this.port.writable) return;
      if (!InterfaceManager.config.serial.tx) return; // 检查TX开关
      let bytes;
      if (typeof data === 'string') {
        const h = data.replace(/\s/g, ''); const a = [];
        for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16));
        bytes = new Uint8Array(a);
      } else bytes = new Uint8Array(data);
      this.writeQueue.push(bytes);
      await this._flushQueue();
    },

    async _flushQueue() {
      if (this.writing) return;
      this.writing = true;
      try {
        // 复用同一个 writer，避免每片数据都 lock/unlock
        let w = null;
        try {
          while (this.writeQueue.length > 0) {
            const d = this.writeQueue.shift();
            if (!this.port || !this.port.writable) break;
            if (!w) w = this.port.writable.getWriter();
            await w.write(d);
          }
        } finally {
          if (w) { try { w.releaseLock(); } catch (e) { } }
        }
      } finally {
        this.writing = false;
      }
    }
  };

  // ===================================================================
  //  Module: App.Interfaces.MQTT  —  MQTT 网络接口
  // ===================================================================
  const MQTT = {
    URL: 'wss://r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084/mqtt',
    OPTIONS: {
      username: 'heatingBed', password: 'cos8mos7',
      clientId: 'heating-bed-web-' + Math.random().toString(16).substring(2, 10),
      clean: true, reconnectPeriod: 5000, connectTimeout: 10000,
    },
    // 标定结果上报 Topic（前缀 /unito/stoov/heating-bed）
    CAL_TOPIC: '/unito/stoov/heating-bed/cal-result',
    client: null, connected: false,

    /** 连接/断开切换 */
    toggle() {
      if (this.connected) { this.disconnect(); } else { this.connect(); }
    },

    /** 默认连接（页面加载时自动调用）。只发送不接收：不订阅任何主题。
     *  断开后由 mqtt.js 的 reconnectPeriod 自动重连。 */
    connect() {
      if (!window.mqtt) { return; }  // mqtt.js 未加载，静默跳过
      if (this.client) { return; }   // 已存在 client（含自动重连），避免重复创建
      this.OPTIONS.reconnectPeriod = 5000;
      try {
        this.client = mqtt.connect(this.URL, this.OPTIONS);
        this.client.on('connect', () => {
          this.connected = true;
          Logger.add('info', 'MQTT 已连接（仅上行发送，不接收）');
        });
        this.client.on('error', (e) => { this.connected = false; Logger.add('error', 'MQTT 错误: ' + e.message); });
        this.client.on('close', () => {
          if (this.connected) Logger.add('info', 'MQTT 连接断开，自动重连中...');
          this.connected = false;
        });
        this.client.on('reconnect', () => Logger.add('info', 'MQTT 正在重连...'));
        this.client.on('offline', () => { this.connected = false; });
      } catch (e) { Logger.add('error', 'MQTT 连接异常: ' + e.message); }
    },

    /** 发布 JSON 数据（仅发送，qos=1） */
    publishJson(topic, obj) {
      if (!this.client) { Logger.add('error', 'MQTT 未连接，发布失败'); return false; }
      const payload = JSON.stringify(obj);
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) Logger.add('error', 'MQTT 发布失败: ' + err.message);
        else Logger.add('info', `MQTT 已发布 → ${topic}: ${payload}`);
      });
      return true;
    },

    /** 发布标定结果到 /unito/stoov/heating-bed/cal-result */
    publishCalResult(obj) { return this.publishJson(this.CAL_TOPIC, obj); },

    /** 断开（仅页面退出时使用） */
    disconnect() {
      this.connected = false;
      if (this.client) {
        // 关键：将 reconnectPeriod 置 0，阻止 mqtt.js 内部自动重连定时器
        if (this.client.options) this.client.options.reconnectPeriod = 0;
        try { this.client.end(true); } catch (e) { }
        this.client = null;
      }
    }
  };

  // ===================================================================
  //  Module: App.Processor  —  数据处理
  // ===================================================================
  const Processor = {
    // ── 状态枚举 ──
    HeaterMode: { OFF: 0, RUNNING: 1, TEMP_SUSPENDED: 2, TIM_SUSPENDED: 3 },
    SysState: { NON: 0, OFF: 1, ON: 2, ERROR: 3 },
    modeNames: { 0: '已关闭', 1: '加热中', 2: '加热暂停', 3: '时间暂停' },
    sysStateNames: { 0: '未知', 1: '已关闭', 2: '运行中', 3: '错误' },
    HEATER_ERROR_CODES: { 0x00: '工作正常', 0x02: '所有热敏电阻故障超过2分钟', 0x03: '加热元件短路', 0x04: '加热元件15分钟无功率', 0xFF: '未知错误代码' },

    // ── 运行数据 ──
    heatingRunTime: 0, totalRunTime: 0, totalDuration: 28800, currentSecond: 0,
    sysState: 0, bodyRunState: 0, footRunState: 0,
    devId: null, devVer: null,
    isSysInfoReceived: false, sysInfoRequestCount: 0,
    sysInfoTimer: null, MAX_RETRY: 4,

    // ── OTA ──
    isOtaActive: false,

    // ── 心跳断连检测（新方案：周期+1秒无数据即判断连；周期1秒时+0.5秒） ──
    periodValue: 3,                // 当前上报周期（秒），来自设备信息或手动设置
    lastDataTime: 0,               // 最近一次收到有效数据的时间戳
    heartbeatTimer: null,
    heartbeatDisconnectCount: 0, isHeartbeatDisconnected: false,
    heartbeatSuspendCount: 0,     // 标定/清除标定/硬件复位期间暂停心跳断连检测的计数
    lastCalReadAt: 0,             // 最近一次收到标定 GET 12字节响应的时间戳（用于判断新数据）
    lastCalAckAt: 0,              // 最近一次收到标定 ACK 响应的时间戳
    lastCalAckCode: null,         // 最近一次收到标定 ACK 的应答码（0x06=成功）
    mqttErrorReportTimestamps: [],

    /** 二进制数据入口（BLE / 串口 共用） */
    feedBinary(data) {
      const parser = Protocol.ensureParser();
      if (!parser) return;
      this._onDataReceived();
      const packets = parser.parseReceivedData(data);
      for (const pkt of packets) {
        const msg = parser.parseMessage(pkt);
        if (msg) this._handleMessage(msg);
      }
    },

    /** 收到有效数据：刷新最近数据时间；若处于断连状态则立即恢复（快速检测新连接） */
    _onDataReceived() {
      this.lastDataTime = Date.now();
      if (this.isHeartbeatDisconnected) {
        this.isHeartbeatDisconnected = false;
        Logger.add('info', '心跳恢复，设备已重新连接');
        this._updateHeartbeatDisconnectUI();
      }
    },

    /** 心跳断连判定阈值（毫秒）：周期+1秒；周期为1秒时 +0.5秒 */
    _heartbeatTimeoutMs() {
      const p = (this.periodValue >= 1) ? this.periodValue : 3;
      const sec = p === 1 ? 1.5 : p + 1;
      return sec * 1000;
    },

    /** MQTT 消息入口 */
    feedMqttMessage(message) {
      try {
        let data;
        if (message instanceof Uint8Array) data = message;
        else if (message instanceof ArrayBuffer) data = new Uint8Array(message);
        else if (typeof message === 'string') {
          try {
            const json = JSON.parse(message);
            if (json.type === 'PERIODIC_TEMP' && json.op === 'REPORT' && json.detail && json.detail.payloadDec) {
              Logger.add('info', `MQTT收到 PERIODIC_TEMP/REPORT JSON → 数据长度:${json.detail.payloadDec.length}`);
              this._processTemperature(json.detail.payloadDec, true);
            } else this._applyMqttJson(json);
            return;
          } catch (e) { /* 非JSON */ }
          const hex = message.replace(/\s/g, '');
          if (/^[0-9A-Fa-f]+$/.test(hex) && hex.length % 2 === 0) {
            const arr = []; for (let i = 0; i < hex.length; i += 2) arr.push(parseInt(hex.substr(i, 2), 16));
            data = new Uint8Array(arr);
          } else { Logger.add('info', 'MQTT收到非HEX/BUFFER数据，跳过'); return; }
        } else { Logger.add('info', `MQTT未知数据格式: ${typeof message}`); return; }
        if (!data || data.length === 0) return;
        const parser = Protocol.ensureMqttParser();
        if (parser) {
          const packets = parser.parseReceivedData(data);
          for (const pkt of packets) { const msg = parser.parseMessage(pkt); if (msg) this._handleMqttMessage(msg); }
        }
      } catch (err) { Logger.add('error', 'MQTT数据解析错误: ' + err.message); }
    },

    // ── 消息处理（串口/BLE通道） ──
    _handleMessage(msg) {
      const { msgId, msgOp, payload } = msg;
      const typeName = Protocol.getMsgTypeName(msgId);
      const opName = Protocol.getOpTypeName(msgOp);

      switch (msgId) {
        case MSGTYPE.PERIODIC_TEMP:
          if (msgOp === MSGOP.REPORT) this._processTemperature(payload);
          else if (msgOp === MSGOP.RESPONSE) this._ackReport(typeName, payload);
          break;
        case MSGTYPE.WORK:
          if (msgOp === MSGOP.SET && payload.length >= 4) {
            this._updateHeatingPanelFromPayload(payload);
            App.UI.updateExtTest(payload);
            this._ackReport(typeName, payload);
          }
          break;
        case MSGTYPE.CTRL_WORK:
          if (msgOp === MSGOP.RESPONSE) {
            if (payload.length === 2) this._processTemperature(payload);
            else if (payload.length === 1) this._ackReport(typeName, payload);
          }
          break;
        case MSGTYPE.UNITO_MSGTYPE_SYSID:
          if (msgOp === MSGOP.RESPONSE || (msgOp === MSGOP.REPORT && payload.length >= 14))
            this._onSystemInfo(payload, payload.length);
          break;
        case MSGTYPE.ERROR:
          if (msgOp === MSGOP.REPORT && payload.length >= 1) {
            this._handleErrorCode(payload[0]);
            App.Controller.sendCommand(MSGTYPE.ERROR, MSGOP.RESPONSE, [0x06]);
          }
          break;
        case MSGTYPE.UNITO_SET_REBOOT:
          if (msgOp === MSGOP.SET && payload.length === 3 && payload[0] === 0x6F && payload[1] === 0x74 && payload[2] === 0x61) {
            Logger.add('info', 'OTA: 收到设备OTA命令(ota)，应答0x55...');
            App.Controller._startOtaTimer();
            App.Controller.sendCommand(MSGTYPE.UNITO_SET_REBOOT, MSGOP.RESPONSE, [0x55]);
          } else if (msgOp === MSGOP.RESPONSE) this._ackReport(typeName, payload);
          break;
        case MSGTYPE.TH: case MSGTYPE.UNITO_SET_TEMP01C: case MSGTYPE.UNITO_SET_TIME:
        case MSGTYPE.UNITO_SET_CLEAR_FAULT: case MSGTYPE.UNITO_MSGTYPE_SIM_TEMP:
          if (msgOp === MSGOP.RESPONSE) this._ackReport(typeName, payload);
          break;
        case MSGTYPE.UNITO_MSGTYPE_SENSOR_CAL:
          if (msgOp === MSGOP.RESPONSE) {
            if (payload.length === 12) this._onSensorCalResponse(payload);
            else {
              this.lastCalAckAt = Date.now();
              this.lastCalAckCode = payload[0];
              this._ackReport(typeName, payload);
            }
          }
          break;
        default:
          Logger.add('info', `[UNKNOWN] MSGID:0x${msgId.toString(16)} OP:${opName}`);
      }
    },

    // ── MQTT消息处理 ──
    _handleMqttMessage(msg) {
      const { msgId, msgOp, payload } = msg;
      const typeName = Protocol.getMsgTypeName(msgId);
      const opName = Protocol.getOpTypeName(msgOp);
      Logger.updateLine('general', 'MQTT', `${typeName}-${opName} | payload:[${payload.join(',')}]`);

      switch (msgId) {
        case MSGTYPE.PERIODIC_TEMP:
          if (msgOp === MSGOP.RESPONSE) {
            if (payload.length === 1) Logger.add('info', `MQTT周期应答 → ${payload[0] === 0x06 ? '✓ 成功' : '周期值:' + payload[0] + 's'}`);
          } else this._processTemperature(payload, true);
          break;
        case MSGTYPE.WORK:
          if (msgOp === MSGOP.SET && payload.length >= 4) this._updateHeatingPanelFromPayload(payload);
          else if (msgOp === MSGOP.RESPONSE) {
            if (payload.length === 2) this._processTemperature(payload, true);
            else if (payload.length === 1) Logger.updateLine('work-ack', 'ACK', `${payload[0] === 0x06 ? '✓ 成功' : '✗ 失败(' + payload[0] + ')'}`);
          }
          break;
        case MSGTYPE.ERROR:
          if (payload.length >= 1) {
            const code = payload[0];
            const desc = this.HEATER_ERROR_CODES[code] || '未知错误';
            const fd = document.getElementById('faultStatusDisplay');
            if (fd && !this.isHeartbeatDisconnected) {
              if (code === 0x00) { fd.innerText = '当前状态: 工作正常'; fd.style.color = 'green'; }
              else { fd.innerText = `ERROR | ${desc} (代码: 0x${code.toString(16).toUpperCase()})`; fd.style.color = 'red'; }
            }
            if (msgOp === MSGOP.REPORT && code === 0x00) {
              const now = Date.now(); this.mqttErrorReportTimestamps.push(now);
              this.mqttErrorReportTimestamps = this.mqttErrorReportTimestamps.filter(t => now - t <= 6000);
              if (this.mqttErrorReportTimestamps.length >= 3) {
                this.heartbeatDisconnectCount++;
                Logger.add('error', `MQTT快速上报断连！累计: ${this.heartbeatDisconnectCount}`);
                this._updateHeartbeatDisconnectUI();
                this.mqttErrorReportTimestamps = [];
              }
            }
          }
          break;
        case MSGTYPE.UNITO_SET_REBOOT:
          if (msgOp === MSGOP.SET && payload.length === 3 && payload[0] === 0x6F && payload[1] === 0x74 && payload[2] === 0x61) {
            Logger.add('info', 'OTA: MQTT收到设备OTA命令，应答0x55...');
            App.Controller._startOtaTimer();
            App.Controller.sendOtaResponse();
          } else if (msgOp === MSGOP.RESPONSE) {
            if (payload.length === 1) Logger.add('info', `MQTT应答 → ${typeName}: ${payload[0] === 0x06 ? '✓ 成功' : payload[0] === 0x55 ? 'OTA确认' : '✗ 失败'}`);
          }
          break;
        case MSGTYPE.UNITO_MSGTYPE_SYSID:
          this._onSystemInfo(payload, payload.length);
          break;
        case MSGTYPE.UNITO_SET_TEMP01C: case MSGTYPE.UNITO_SET_TIME: case MSGTYPE.TH:
          if (msgOp === MSGOP.RESPONSE && payload.length === 1)
            Logger.add('info', `MQTT应答 → ${typeName}: ${payload[0] === 0x06 ? '✓ 成功' : '✗ 失败'}`);
          break;
        case MSGTYPE.UNITO_MSGTYPE_SENSOR_CAL:
          if (msgOp === MSGOP.RESPONSE) {
            if (payload.length === 12) this._onSensorCalResponse(payload);
            else if (payload.length === 1) {
              this.lastCalAckAt = Date.now();
              this.lastCalAckCode = payload[0];
              Logger.add('info', `MQTT应答 → ${typeName}: ${payload[0] === 0x06 ? '✓ 成功' : '✗ 失败'}`);
            }
          }
          break;
        default:
          Logger.add('info', `MQTT未处理 → ID:0x${msgId.toString(16)} OP:${opName}`);
      }
    },

    // ── ACK 响应 ──
    _ackReport(typeName, payload) {
      if (payload && payload.length === 1) {
        if (payload[0] === 0x06) Logger.add('recv', `${typeName} - ACK | ✓ 操作成功`);
        else Logger.add('recv', `${typeName} - ACK | ✗ 失败(错误码: ${payload[0]})`);
      }
    },

    // ── 温度处理 ──
    _processTemperature(payload, skipRemote = false) {
      if (this.isSysInfoReceived) this.sysInfoRequestCount = 0;
      if (payload.length === 2) {
        App.UI.updateTemperature(payload[0], payload[1], skipRemote);
        return;
      }
      if (payload.length < 12) { Logger.add('warn', `温度数据长度不足: ${payload.length}`); return; }

      const bodyTemp = parseFloat((payload[1] + payload[0] / 10).toFixed(1));
      const footTemp = parseFloat((payload[3] + payload[2] / 10).toFixed(1));
      App.UI.updateTemperature(bodyTemp, footTemp, skipRemote, payload[1], payload[3]);

      // 运行时间 & 状态 (设置温度/目标温度/电流 已移除)

      if (payload.length >= 14) this.heatingRunTime = (payload[13] << 8) | payload[12];
      if (payload.length >= 16) this.totalRunTime = (payload[15] << 8) | payload[14];
      this.totalDuration = this.totalRunTime;
      this.currentSecond = this.heatingRunTime;
      App.UI.updatePlaybackDisplay();

      let hwRunTime = 0;
      if (payload.length >= 18) hwRunTime = (payload[17] << 8) | payload[16];
      App.UI.updateHardwareUptimeDisplay(hwRunTime);

      this.sysState = payload.length >= 19 ? payload[18] : 0;
      this.bodyRunState = payload.length >= 20 ? payload[19] : 0;
      this.footRunState = payload.length >= 21 ? payload[20] : 0;
      App.UI.updateStatusDisplay('heatingStatusDisplay', this.sysState, true);
      App.UI.updateStatusDisplay('bodyStatusDisplay', this.bodyRunState, false);
      App.UI.updateStatusDisplay('footStatusDisplay', this.footRunState, false);

      // 电流更新已移除

      if (payload.length >= 40) this._handleErrorCode(payload[39]);
      App.UI.updateHeatingButtonStates();
      Logger.updateLine('temp-parse', 'TEMP', `身体:${bodyTemp.toFixed(1)}°C 脚部:${footTemp.toFixed(1)}°C 运行:${this.heatingRunTime}s/${this.totalRunTime}s`);

      // 自动获取设备信息：当器件ID/版本未知时触发
      const unknownValues = [null, '未知', '获取中...', '超时', '-'];
      if (unknownValues.includes(this.devId) || unknownValues.includes(this.devVer)) {
        App.Controller.requestSystemInfo();
      }
    },

    _handleErrorCode(code) {
      const desc = this.HEATER_ERROR_CODES[code] || '未知错误';
      const fd = document.getElementById('faultStatusDisplay');
      if (!fd || this.isHeartbeatDisconnected) return;
      if (code === 0x00) { fd.innerText = '当前状态: 工作正常'; fd.style.color = 'green'; }
      else { fd.innerText = `ERROR | ${desc} (代码: 0x${code.toString(16).toUpperCase()})`; fd.style.color = 'red'; }
    },

    _updateHeatingPanelFromPayload(payload) {
      const hp = document.getElementById('heatingPanel');
      if (!hp) return;
      const bodyTemp = (payload[0] !== 0xff) ? payload[0] : (hp.bodyTemp || 0);
      const footTemp = (payload[1] !== 0xff) ? payload[1] : (hp.feetTemp || 0);
      const hours = (payload[2] <= 12) ? payload[2] : 1;
      const powerOn = (payload[3] === 0x02);
      hp.power = powerOn; hp.hours = hours; hp.bodyTemp = bodyTemp; hp.feetTemp = footTemp;
    },

    // ── 系统信息处理 ──
    _onSystemInfo(payload, len) {
      this.sysInfoRequestCount = 0;
      if (!payload || payload.length < 15) return;
      let idHex = '';
      for (let i = 0; i < 12; i++) idHex += ('0' + payload[i].toString(16)).slice(-2).toUpperCase();
      this.devId = 'HT-' + idHex.substring(0, 8);
      this.devVer = `v${payload[12]}.${payload[13]}`;
      document.getElementById('deviceIdText').textContent = this.devId || '未知';
      document.getElementById('deviceVersionText').textContent = this.devVer || '未知';
      const periodic = payload[14];
      const ti = document.getElementById('timerIntervalInput');
      const sb = document.getElementById('startTimerBtn');
      if (ti) ti.value = periodic;
      if (sb) sb.textContent = `周期(${periodic}s)`;
      // 更新心跳断连检测周期（设备上报值）
      this.periodValue = (typeof periodic === 'number' && periodic >= 1) ? periodic : 3;
      if (len > 15) {
        const bodyTemp = parseFloat((payload[20] + payload[19] / 10).toFixed(1));
        const footTemp = parseFloat((payload[22] + payload[21] / 10).toFixed(1));
        App.UI.updateTemperature(bodyTemp, footTemp);
        App.UI.updatePlaybackDisplay();
      }
      this.isSysInfoReceived = true;
      App.Controller.sendCommand(MSGTYPE.PERIODIC_TEMP, MSGOP.SET, [3]);
      this.periodValue = 3; // 自动设置后实际周期为 3 秒
      // 同步界面显示为自动发送的设置值，而不是设备上报的旧周期
      if (ti) ti.value = 3;
      if (sb) sb.textContent = `周期(3s)`;
      Logger.add('info', '已自动设置周期为 3 秒（心跳断连判定: 4秒无数据）');
    },

    _applyMqttJson(json) {
      if (json.body !== undefined || json.feet !== undefined)
        App.UI.updateMqttTemp(json.body || 0, json.feet || 0);
      if (json.power !== undefined || json.bodyTemp !== undefined || json.feetTemp !== undefined || json.hours !== undefined) {
        const hp = document.getElementById('heatingPanel');
        if (hp) {
          if (json.power !== undefined) hp.power = json.power;
          if (json.hours !== undefined) hp.hours = json.hours;
          if (json.bodyTemp !== undefined) hp.bodyTemp = json.bodyTemp;
          if (json.feetTemp !== undefined) hp.feetTemp = json.feetTemp;
        }
      }
    },

    _updateHeartbeatDisconnectUI() {
      const fd = document.getElementById('faultStatusDisplay');
      const dc = document.getElementById('heartbeatDisconnectCount');
      if (fd) { fd.innerText = this.isHeartbeatDisconnected ? '当前状态: 心跳断连' : '当前状态: 工作正常'; fd.style.color = this.isHeartbeatDisconnected ? 'red' : 'green'; }
      if (dc) dc.textContent = this.heartbeatDisconnectCount;
    },

    /** 处理传感器标定 GET 响应 (12 bytes payload) */
    _onSensorCalResponse(payload) {
      // 记录收到新标定数据的时间戳（标定流程用它判断是否收到新数据，而不是用旧 DOM 值）
      this.lastCalReadAt = Date.now();
      // Byte 0-1: FOOT cal_temp_c (uint16 LE)
      const footTemp = payload[0] | (payload[1] << 8);
      // Byte 2-5: FOOT meas_r_mohm (uint32 LE)
      const footResMohm = payload[2] | (payload[3] << 8) | (payload[4] << 16) | (payload[5] << 24);
      // Byte 6-7: BODY cal_temp_c (uint16 LE)
      const bodyTemp = payload[6] | (payload[7] << 8);
      // Byte 8-11: BODY meas_r_mohm (uint32 LE)
      const bodyResMohm = payload[8] | (payload[9] << 8) | (payload[10] << 16) | (payload[11] << 24);
      const footResOhm = (footResMohm / 1000).toFixed(1);
      const bodyResOhm = (bodyResMohm / 1000).toFixed(1);
      Logger.add('info', `标定值GET → 脚部:${footTemp}°C ${footResOhm}Ω 身体:${bodyTemp}°C ${bodyResOhm}Ω`);
      App.UI.updateSensorCalDisplay(footTemp, footResOhm, bodyTemp, bodyResOhm);
    }
  };

  // ===================================================================
  //  Module: App.UI  —  界面更新
  // ===================================================================
  const UI = {
    // ── 温度显示 ──
    /**
     * @param {number} bodyTemp - 身体温度 °C
     * @param {number} footTemp - 脚部温度 °C
     * @param {boolean} skipRemote
     * @param {number} [bodyRawInt] - 身体原始整数 (payload[1])
     * @param {number} [footRawInt] - 脚部原始整数 (payload[3])
     */
    updateTemperature(bodyTemp, footTemp, skipRemote = false, bodyRawInt, footRawInt) {
      const be = document.getElementById('bodyTemp'), fe = document.getElementById('footTemp');
      const bodyInt = bodyRawInt !== undefined ? bodyRawInt : Math.round(bodyTemp);
      const footInt = footRawInt !== undefined ? footRawInt : Math.round(footTemp);

      if (be) {
        if (bodyInt === 225) be.textContent = '短路'; else if (bodyInt === 226) be.textContent = '开路'; else be.textContent = bodyTemp.toFixed(1);
      }
      if (fe) {
        if (footInt === 225) fe.textContent = '短路'; else if (footInt === 226) fe.textContent = '开路'; else fe.textContent = footTemp.toFixed(1);
      }

      // 新数据到达指示（无论值是否变化都闪烁提示一次）
      this._flashTempBox('body');
      this._flashTempBox('foot');

      // 环境温度差异刷新（每次温度更新时计算一次）
      if (typeof window.updateEnvDiffs === 'function') window.updateEnvDiffs();

      if (!skipRemote) this._updateRemotePanel(bodyTemp, footTemp);
    },

    /** 温度卡片闪烁指示：每次收到新数据时触发，即使值相同也会闪烁
     *  优先使用 Web Animations API（不依赖外部 CSS，避免旧 CSS 缓存导致不闪） */
    _flashTempBox(which) {
      const box = document.querySelector('.temp-box.' + which);
      if (!box) return;
      const glow = which === 'body' ? 'rgba(255,107,107,0.9)' : 'rgba(78,205,196,0.9)';
      const inner = which === 'body' ? 'rgba(255,107,107,0.4)' : 'rgba(78,205,196,0.4)';
      try {
        box.animate(
          [
            { boxShadow: `0 0 0 3px ${glow}, inset 0 0 28px ${inner}` },
            { boxShadow: '0 0 0 0 rgba(0,0,0,0), inset 0 0 0 rgba(0,0,0,0)' }
          ],
          { duration: 500, easing: 'ease-out' }
        );
      } catch (e) {
        // 回退：使用 CSS 类触发动画
        box.classList.remove('temp-flash');
        void box.offsetWidth; // 强制回流，允许连续触发动画
        box.classList.add('temp-flash');
      }
    },

    /** ADC 原始值 → 阻值 (Ω)
     *  完全等价于 C 函数 sensor_corr_adc_to_resistance_mohm:
     *    R_PU(mΩ) = (uint32_t)(r_pullup_ohm * 1000 + 0.5)
     *    denom     = 8192 - adc_raw
     *    result    = (uint32_t)((R_PU * adc_raw) / denom)   ← 整数除法, 单位 mΩ
     *  最后 ÷1000 转为 Ω
     */
    _adcToResistanceOhm(adcRaw, rPullupOhm) {
      const ADC_FULL = 4096;
      // R_PU = (uint64_t)((uint32_t)(r_pullup_ohm * 1000.0f + 0.5f))
      const RPU_mohm = Math.trunc(rPullupOhm * 1000 + 0.5);
      // denom = (uint32_t)((ADC_FULL_SCALE << 1) - adc_raw)
      const denom = (ADC_FULL * 2) - adcRaw;
      if (denom <= 0) return 0;
      // num = R_PU * (uint64_t)adc_raw
      const num = RPU_mohm * adcRaw;
      // return (uint32_t)(num / (uint64_t)denom) — C 整数除法, 单位 mΩ
      const result_mohm = Math.trunc(num / denom);
      return result_mohm / 1000;
    },

    _updateRemotePanel(bodyTemp, footTemp) {
      const hp = document.getElementById('heatingPanel');
      if (hp && hp.mode === 'external') {
        if (typeof bodyTemp === 'number' && bodyTemp > 0) hp.bodyTemp = Math.round(bodyTemp);
        if (typeof footTemp === 'number' && footTemp > 0) hp.feetTemp = Math.round(footTemp);
      }
    },

    updateRawSetTemp(bodyRaw, footRaw) {
      const be = document.getElementById('bodyRawSetTemp'), fe = document.getElementById('footRawSetTemp');
      if (be) be.textContent = bodyRaw === 0 ? 'OFF' : bodyRaw;
      if (fe) fe.textContent = footRaw === 0 ? 'OFF' : footRaw;
    },

    updateTargetTemp(bodyTarget, footTarget) {
      const be = document.getElementById('bodyTargetTemp'), fe = document.getElementById('footTargetTemp');
      if (be) be.textContent = bodyTarget;
      if (fe) fe.textContent = footTarget;
    },

    updateMqttTemp(bodyTemp, footTemp) {
      const be = document.getElementById('bodyTemp'), fe = document.getElementById('footTemp');
      if (be) be.textContent = typeof bodyTemp === 'number' ? bodyTemp.toFixed(1) : bodyTemp;
      if (fe) fe.textContent = typeof footTemp === 'number' ? footTemp.toFixed(1) : footTemp;
    },

    // ── 电流 ──
    updateCurrentDisplay(bodyCurrent, footCurrent) {
      const bc = document.getElementById('bodyCurrent'), fc = document.getElementById('footCurrent');
      if (bc) bc.textContent = bodyCurrent.toFixed(2);
      if (fc) fc.textContent = footCurrent.toFixed(2);
    },

    // ── 状态 ──
    updateStatusDisplay(elId, stateValue, isSysState) {
      const el = document.getElementById(elId);
      if (!el) return;
      const map = isSysState ? Processor.sysStateNames : Processor.modeNames;
      el.textContent = map[stateValue] || '未知';
      el.classList.remove('status-running', 'status-paused', 'status-off');
      if (isSysState) {
        if (stateValue === 2) el.classList.add('status-running');
        else if (stateValue === 1) el.classList.add('status-off');
      } else {
        if (stateValue === 1) el.classList.add('status-running');
        else if (stateValue === 2 || stateValue === 3) el.classList.add('status-paused');
        else if (stateValue === 0) el.classList.add('status-off');
      }
    },

    updateHeatingButtonStates() {
      const el = document.getElementById('heatingStatusDisplay');
      const isRunning = el && (el.textContent.trim() === '运行中' || el.classList.contains('status-running'));
      const conn = App.Interfaces.BLE.connected || App.Interfaces.Serial.connected || App.Interfaces.MQTT.connected;
      ['startHeatingBtn', 'manuallyStartHeatingBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !conn || isRunning; });
      const sb = document.getElementById('stopHeatingBtn'); if (sb) sb.disabled = !conn || !isRunning;
      const ut = document.getElementById('updateTempBtn'); if (ut) ut.disabled = !conn || !isRunning;
    },

    /** 所有通信断开时，重置监测数据为初始状态 */
    resetMonitoring() {
      const initDash = '--';
      const initZero = '00:00:00';

      // 温度显示
      ['bodyTemp', 'footTemp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = initDash;
      });
      if (typeof window.updateEnvDiffs === 'function') window.updateEnvDiffs();

      // 状态显示
      ['heatingStatusDisplay', 'bodyStatusDisplay', 'footStatusDisplay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = '未知';
          el.classList.remove('status-running', 'status-paused', 'status-off');
        }
      });

      // 运行时间
      const ctd = document.getElementById('currentTimeDisplay');
      if (ctd) ctd.textContent = initZero;
      const pf = document.getElementById('progressFill');
      if (pf) pf.style.width = '0%';

      // 硬件运行时间
      const hud = document.getElementById('hardwareUptimeDisplay');
      if (hud) hud.textContent = initZero;
      const sud = document.getElementById('hardwareSetUptimeDisplay');
      if (sud) sud.textContent = initZero;

      // 注意: faultStatusDisplay 和 heartbeatDisconnectCount 不重置，
      // 它们用于指示通信断连状态，需保持当前值。

      // 设备信息
      const did = document.getElementById('deviceIdText');
      if (did) did.textContent = '未知';
      const dver = document.getElementById('deviceVersionText');
      if (dver) dver.textContent = '未知';

      // 重置 Processor 状态（保留心跳/断连相关状态用于指示通信故障）
      const P = App.Processor;
      P.heatingRunTime = 0; P.totalRunTime = 0; P.totalDuration = 28800; P.currentSecond = 0;
      P.sysState = 0; P.bodyRunState = 0; P.footRunState = 0;
      P.devId = null; P.devVer = null;
      P.isSysInfoReceived = false;
    },

    // ── 运行时间 ──
    updatePlaybackDisplay() {
      const p = Processor;
      const h = Math.floor(p.currentSecond / 3600), m = Math.floor((p.currentSecond % 3600) / 60), s = p.currentSecond % 60;
      const el = document.getElementById('currentTimeDisplay');
      if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      const pf = document.getElementById('progressFill');
      if (pf) pf.style.width = (p.currentSecond / p.totalDuration) * 100 + '%';
    },

    updateHardwareUptimeDisplay(sec) {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      const el = document.getElementById('hardwareUptimeDisplay');
      if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    // ── OTA ──
    setOtaIndicator(active, btnText) {
      Processor.isOtaActive = active;
      const dot = document.getElementById('otaStatusDot'), txt = document.getElementById('otaStatusText'), btn = document.getElementById('otaBtn');
      if (dot) { if (active) dot.classList.add('active'); else dot.classList.remove('active'); }
      if (txt) { txt.textContent = active ? 'OTA中...' : 'OTA'; if (active) txt.classList.add('active'); else txt.classList.remove('active'); }
      if (btn) { btn.disabled = active; if (btnText !== undefined) btn.textContent = btnText; }
    },

    // ── 传感器标定值显示 ──
    updateSensorCalDisplay(footTemp, footResOhm, bodyTemp, bodyResOhm) {
      const ft = document.getElementById('footCalCurTemp');
      const fr = document.getElementById('footCalCurRes');
      const bt = document.getElementById('bodyCalCurTemp');
      const br = document.getElementById('bodyCalCurRes');
      if (ft) ft.textContent = footTemp + '°C';
      if (fr) fr.textContent = '(' + footResOhm + 'Ω)';
      if (bt) bt.textContent = bodyTemp + '°C';
      if (br) br.textContent = '(' + bodyResOhm + 'Ω)';
    },

    // ── 测试 ──
    extTest: { onoffOk: false, lastPower: null, timeOk: false, bodyOk: false, bodyHas0: false, bodyHas36: false, footHas0: false, footHas40: false },
    updateExtTest(payload) {
      if (!App.Controller.testActive || App.Controller.currentTestMode !== 'external') return;
      if (payload.length < 4) return;
      const et = this.extTest;
      if (!et.onoffOk) { if (et.lastPower === 0x01 && payload[3] === 0x02) et.onoffOk = true; et.lastPower = payload[3]; }
      if (!et.timeOk && payload[2] >= 2 && payload[2] <= 12) et.timeOk = true;
      if (payload[0] === 0) et.bodyHas0 = true; if (payload[0] === 36) et.bodyHas36 = true;
      if (et.bodyHas0 && et.bodyHas36) et.bodyOk = true;
      if (payload[1] === 0) et.footHas0 = true; if (payload[1] === 40) et.footHas40 = true;
      if (et.footHas0 && et.footHas40) et.footOk = true;
    }
  };

  // ===================================================================
  //  Module: App.Controller  —  主控制器
  // ===================================================================
  const Controller = {
    testActive: false, currentTestMode: 'external',

    init() {
      Logger.init();
      InterfaceManager.init();

      // MQTT 默认连接：仅上报标定结果（只发送不接收），页面不显示
      App.Interfaces.MQTT.connect();

      // 绑定事件
      document.addEventListener('DOMContentLoaded', () => {
        this._bindEvents();
        UI.updateHardwareUptimeDisplay(0);
      });

      // 退出清理（beforeunload 部分移动端不触发，pagehide 兜底确保断开 MQTT）
      window.addEventListener('beforeunload', () => {
        App.Interfaces.BLE.disconnect();
        App.Interfaces.Serial.disconnect();
        App.Interfaces.MQTT.disconnect();
      });
      window.addEventListener('pagehide', (e) => {
        if (e.persisted) return; // 进入 bfcache 缓存，页面还会恢复，不断开
        App.Interfaces.MQTT.disconnect();
      });
    },

    _bindEvents() {
      // BLE 按钮 (由 HTML onclick 处理，这里做备用)
      const bcb = document.getElementById('bleConnectBtn');
      if (bcb) bcb.addEventListener('click', () => App.Interfaces.BLE.toggle());
      // MQTT 按钮 (HTML onclick 已处理，此处不再重复绑定)
      // 周期
      const stb = document.getElementById('startTimerBtn');
      if (stb) stb.addEventListener('click', () => this._setPeriodTimer());
      // 周期输入回车
      const tii = document.getElementById('timerIntervalInput');
      if (tii) tii.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._setPeriodTimer(); } });
      // 加热面板监听
      this._setupHeatingPanelListener();
    },

    /** 统一发送命令 */
    async sendCommand(msgId, msgOp, payload) {
      const asm = Protocol.ensureAssembler();
      if (!asm) { Logger.add('warn', '协议组装器不可用'); return; }
      if (!InterfaceManager.hasAnyTx()) { Logger.add('warn', '无可用发送通道'); return; }
      const packet = asm.assembleMessage(Protocol.TARGET_ADDR, Protocol.SENDER_ADDR, msgId, msgOp, payload);
      const jobs = [];
      if (InterfaceManager.config.ble.tx && App.Interfaces.BLE.connected) jobs.push(App.Interfaces.BLE.send(packet).catch(e => Logger.add('error', 'BLE发送: ' + e.message)));
      if (InterfaceManager.config.serial.tx && App.Interfaces.Serial.connected) jobs.push(App.Interfaces.Serial.send(packet).catch(e => Logger.add('error', '串口发送: ' + e.message)));
      if (jobs.length) await Promise.all(jobs);
    },

    /** OTA 主动发送（含30秒倒计时，期间暂停所有接口TX） */
    async sendOtaCommand() {
      if (!InterfaceManager.hasAnyTx()) { alert('无可用发送通道'); return; }
      this._startOtaTimer();
      await this.sendCommand(MSGTYPE.UNITO_SET_REBOOT, MSGOP.SET, [0x6F, 0x74, 0x61]);
    },

    /** 暂停所有通信接口的 TX 发送 */
    _pauseAllTx() {
      const cfg = InterfaceManager.config;
      this._savedTx = {
        ble: cfg.ble.tx, serial: cfg.serial.tx, mqtt: cfg.mqtt.tx
      };
      cfg.ble.tx = false; cfg.serial.tx = false; cfg.mqtt.tx = false;
      const E = InterfaceManager.elems;
      if (E.bleTxCheck) E.bleTxCheck.checked = false;
      if (E.serialTxCheck) E.serialTxCheck.checked = false;
      if (E.mqttTxCheck) E.mqttTxCheck.checked = false;
      Logger.add('info', 'OTA: 已暂停 BLE/串口/MQTT 的 TX 发送');
    },

    /** 恢复所有通信接口的 TX 发送 */
    _resumeAllTx() {
      if (!this._savedTx) return;
      const cfg = InterfaceManager.config;
      cfg.ble.tx = this._savedTx.ble;
      cfg.serial.tx = this._savedTx.serial;
      cfg.mqtt.tx = this._savedTx.mqtt;
      const E = InterfaceManager.elems;
      if (E.bleTxCheck) E.bleTxCheck.checked = this._savedTx.ble;
      if (E.serialTxCheck) E.serialTxCheck.checked = this._savedTx.serial;
      if (E.mqttTxCheck) E.mqttTxCheck.checked = this._savedTx.mqtt;
      Logger.add('info', 'OTA: 已恢复 BLE/串口/MQTT 的 TX 发送');
    },

    /** 启动OTA 30秒倒计时（页面主动发送或设备发起均调用，期间暂停所有TX） */
    _startOtaTimer() {
      if (this._otaTimer) { clearInterval(this._otaTimer); this._otaTimer = null; }
      // 暂停所有接口的 TX 发送
      this._pauseAllTx();
      let remaining = 30;
      UI.setOtaIndicator(true, 'OTA ' + remaining + 's');
      this._otaTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(this._otaTimer); this._otaTimer = null;
          UI.setOtaIndicator(false);
          const btn = document.getElementById('otaBtn');
          if (btn) btn.textContent = 'OTA升级';
          // 倒计时结束，恢复所有 TX 发送
          this._resumeAllTx();
        } else {
          const btn = document.getElementById('otaBtn');
          if (btn) btn.textContent = 'OTA ' + remaining + 's';
        }
      }, 1000);
    },

    sendOtaResponse() {
      if (!InterfaceManager.hasAnyTx()) return;
      this.sendCommand(MSGTYPE.UNITO_SET_REBOOT, MSGOP.RESPONSE, [0x55]);
    },

    // ── 心跳断连检测（新方案，取代旧心跳计数法） ──
    startHeartbeat() {
      this.stopHeartbeat();
      Processor.lastDataTime = Date.now();
      Processor.isHeartbeatDisconnected = false;
      Logger.add('info', '❤ 心跳断连检测已启动（周期+1秒无数据判断连；周期1秒时+0.5秒）');
      Processor.heartbeatTimer = setInterval(() => {
        // 标定/清除标定/硬件复位期间暂停断连检测与主动探测
        if (Processor.heartbeatSuspendCount > 0) return;
        // 无 BLE/串口 连接时不检测
        if (!App.Interfaces.BLE.connected && !App.Interfaces.Serial.connected) return;
        const timeoutMs = Processor._heartbeatTimeoutMs();
        const idle = Date.now() - Processor.lastDataTime;
        if (idle > timeoutMs && !Processor.isHeartbeatDisconnected) {
          Processor.isHeartbeatDisconnected = true;
          Processor.heartbeatDisconnectCount++;
          Logger.add('error', `心跳断连！已 ${(idle / 1000).toFixed(1)} 秒无数据（阈值 ${(timeoutMs / 1000).toFixed(1)} 秒），累计断连: ${Processor.heartbeatDisconnectCount}`);
          Processor._updateHeartbeatDisconnectUI();
          App.UI.resetMonitoring();
          // 断连后主动获取设备信息，探测新消息（收到任何数据即自动恢复连接）
          Logger.add('info', '断连后主动请求设备信息，探测新消息...');
          this.requestSystemInfo();
        }
        // 断连期间持续主动探测：设备信息请求超时(60秒)后重新发起，直到收到数据恢复连接
        if (Processor.isHeartbeatDisconnected && !Processor.sysInfoTimer) {
          Logger.add('info', '仍处于断连状态，重新请求设备信息探测...');
          this.requestSystemInfo();
        }
      }, 500);
    },

    stopHeartbeat() {
      if (Processor.heartbeatTimer) { clearInterval(Processor.heartbeatTimer); Processor.heartbeatTimer = null; }
    },

    /** 暂停心跳断连检测（标定/清除标定/硬件复位期间调用，可叠加计数） */
    suspendHeartbeat(reason) {
      Processor.heartbeatSuspendCount++;
      // 停止进行中的设备信息重试定时器，避免操作期间继续发送探测请求
      if (Processor.sysInfoTimer) { clearInterval(Processor.sysInfoTimer); Processor.sysInfoTimer = null; }
      Logger.add('info', `❤ 心跳断连检测已暂停（${reason || '操作进行中'}），暂停计数: ${Processor.heartbeatSuspendCount}`);
    },

    /** 恢复心跳断连检测；fetchInfo=true 时恢复后获取一次设备信息 */
    resumeHeartbeat(fetchInfo) {
      if (Processor.heartbeatSuspendCount > 0) Processor.heartbeatSuspendCount--;
      // 恢复时重置数据时间基准，避免操作期间无数据导致立即误判断连
      Processor.lastDataTime = Date.now();
      if (Processor.heartbeatSuspendCount === 0) {
        Logger.add('info', '❤ 心跳断连检测已恢复');
        if (fetchInfo) {
          Logger.add('info', '操作完成，主动获取一次设备信息...');
          this.requestSystemInfo();
        }
      } else if (fetchInfo) {
        Logger.add('info', '心跳检测仍处于暂停状态，跳过本次设备信息获取');
      }
    },

    // ── 周期设置 ──
    _setPeriodTimer() {
      if (!InterfaceManager.hasAnyTx()) {
        alert('未连接任何通讯端口！\n请先在通信管理面板中连接串口或蓝牙后再操作。');
        return;
      }
      const ti = document.getElementById('timerIntervalInput');
      const val = parseInt(ti ? ti.value : 10, 10);
      if (isNaN(val) || val < 0) { Logger.add('error', '请输入有效周期值(0~300秒)'); return; }
      this.sendCommand(MSGTYPE.PERIODIC_TEMP, MSGOP.SET, [val]);
      const sb = document.getElementById('startTimerBtn');
      if (sb) sb.textContent = `周期(${val}s)`;
      // 更新心跳断连检测周期（周期为0时不更新，保持默认3秒判定）
      if (val >= 1) {
        Processor.periodValue = val;
        Logger.add('info', `心跳断连阈值已更新: 周期${val}s → ${(val === 1 ? 1.5 : val + 1)}秒无数据判断连`);
      }
    },

    // ── 加热面板监听 ──
    _heatingPanelTimer: null,
    _setupHeatingPanelListener() {
      const hp = document.getElementById('heatingPanel');
      if (!hp) return;
      hp.addEventListener('data-change', (e) => {
        const d = e.detail;
        if (this._heatingPanelTimer) clearTimeout(this._heatingPanelTimer);
        this._heatingPanelTimer = setTimeout(() => {
          this._heatingPanelTimer = null;
          this.sendCommand(MSGTYPE.WORK, MSGOP.SET, [d.bodyTemp & 0xff, d.feetTemp & 0xff, d.hours & 0xff, d.isOn ? 0x02 : 0x01]);
        }, 1500);
      });
    },

    // ── 硬件复位/故障清除 ──
    hardwareReset() { this.sendCommand(MSGTYPE.UNITO_SET_REBOOT, MSGOP.SET, [0xA5, 0x5A]); },
    clearFault() { this.sendCommand(MSGTYPE.UNITO_SET_CLEAR_FAULT, MSGOP.SET, [0xA5, 0x5A]); },

    // ── 传感器标定 ──
    /**
     * 发送传感器标定指令
     * @param {number} sensorId - 0 = FOOT(脚部), 1 = BODY(身体)
     * @param {number} tempC - 标定温度 °C (15~35)
     * @param {number} resistanceOhm - 实测阻值 Ω (0 = 自动从ADC读取)
     */
    sendSensorCal(sensorId, tempC, resistanceOhm) {
      const resistanceMohm = Math.round(resistanceOhm * 1000);
      const payload = [
        0x5A, 0xA5,
        sensorId & 0xFF,
        tempC & 0xFF,
        (tempC >> 8) & 0xFF,
        resistanceMohm & 0xFF,
        (resistanceMohm >> 8) & 0xFF,
        (resistanceMohm >> 16) & 0xFF,
        (resistanceMohm >> 24) & 0xFF
      ];
      const label = sensorId === 0 ? '脚部' : '身体';
      Logger.add('info', `传感器标定 → ${label} 温度:${tempC}°C 阻值:${resistanceMohm}mΩ (${resistanceOhm}Ω) 模式:${resistanceOhm === 0 ? '自动ADC' : '万用表实测'}`);
      this.sendCommand(MSGTYPE.UNITO_MSGTYPE_SENSOR_CAL, MSGOP.SET, payload);
    },

    /** 获取当前传感器标定值 (GET) */
    getSensorCal() {
      Logger.add('info', '获取传感器标定值...');
      this.sendCommand(MSGTYPE.UNITO_MSGTYPE_SENSOR_CAL, MSGOP.GET, [0x01]);
    },

    /**
     * 清除传感器标定数据 (CLEAR)
     * @param {string|number} target - 'a'(0x61)=清脚部, 'b'(0x62)=清身体, 0xFF=清全部
     */
    clearSensorCal(target) {
      const code = typeof target === 'string' ? target.charCodeAt(0) : target;
      const label = code === 0xFF ? '全部' : (code === 0x61 ? '脚部' : '身体');
      const payload = [0xAA, 0x55, code];
      Logger.add('info', `清除传感器标定 → ${label}`);
      this.sendCommand(MSGTYPE.UNITO_MSGTYPE_SENSOR_CAL, MSGOP.SET, payload);
    },

    // ── 设备信息请求 ──
    requestSystemInfo() {
      if (Processor.sysInfoTimer) { clearInterval(Processor.sysInfoTimer); Processor.sysInfoTimer = null; }
      Logger.add('info', '请求设备信息...');
      document.getElementById('deviceIdText').textContent = '获取中...';
      document.getElementById('deviceVersionText').textContent = '-';
      Processor.sysInfoRequestCount = 0; Processor.isSysInfoReceived = false;
      const doSend = () => {
        if (!InterfaceManager.hasAnyTx()) return;
        this.sendCommand(MSGTYPE.UNITO_MSGTYPE_SYSID, MSGOP.GET, [0x01]);
      };
      doSend();
      Processor.sysInfoTimer = setInterval(() => {
        Processor.sysInfoRequestCount++;
        if (!Processor.isSysInfoReceived && Processor.sysInfoRequestCount % Processor.MAX_RETRY === 0) doSend();
        if (Processor.sysInfoRequestCount >= 60 && !Processor.isSysInfoReceived) {
          clearInterval(Processor.sysInfoTimer); Processor.sysInfoTimer = null;
          document.getElementById('deviceIdText').textContent = '超时';
          document.getElementById('deviceVersionText').textContent = '-';
        }
        if (Processor.isSysInfoReceived) { clearInterval(Processor.sysInfoTimer); Processor.sysInfoTimer = null; }
      }, 1000);
    }
  };

  // ===================================================================
  //  将模块挂载到全局 App 命名空间
  // ===================================================================
  window.App = {
    Logger: Logger,
    Protocol: Protocol,
    Interfaces: {
      BLE: BLE,
      Serial: Serial,
      MQTT: MQTT,
      Manager: InterfaceManager
    },
    Processor: Processor,
    UI: UI,
    Controller: Controller
  };

  // 向后兼容：暴露全局快捷函数
  window.bleAddLog = (t, m) => Logger.add(t, m);
  window.clearBleLogs = () => Logger.clear();
  window.sendOtaCommand = () => Controller.sendOtaCommand();
  window.onCommCheckChange = () => InterfaceManager.onCheckChange();
  window.toggleSerial = () => App.Interfaces.Serial.toggle();
  window.toggleMqtt = () => App.Interfaces.MQTT.toggle();
  window.startHardwareResetRequest = () => Controller.hardwareReset();
  window.startClearFaultRequest = () => Controller.clearFault();
  window.startGetSystemInfoRequest = () => Controller.requestSystemInfo();
  window.setPeriodTimer = () => Controller._setPeriodTimer();
  window.sendSensorCal = (sensorId, tempC, resistanceOhm) => Controller.sendSensorCal(sensorId, tempC, resistanceOhm);
  window.getSensorCal = () => Controller.getSensorCal();
  window.clearSensorCal = (target) => Controller.clearSensorCal(target);

  // ===================================================================
  //  启动应用
  // ===================================================================
  Controller.init();

})();
