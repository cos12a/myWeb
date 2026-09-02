/**
 * Web USB 连接器 - 自定义 USB 设备通信
 *
 * 功能：
 *   1. 通过 VID/PID 或全量列表发现 USB 设备，支持已授权设备免弹窗连接
 *   2. 打开设备 → 选择配置 → 声明接口 → 选择 Alternate Setting
 *   3. 控制传输 (Control Transfer) / Bulk / Interrupt / Isochronous 端点收发
 *   4. 实时日志（文本/HEX/混合）、暂停、方向过滤、导出 CSV、导出接收二进制
 *   5. 收发统计（字节/包/速率/运行时间）
 *   6. 定时/循环发送、发送历史、发送文件、多 IN 端点同时监听、自动重连
 *   7. 设备描述符树展示、USB Class 识别、connect/disconnect 双向监听
 */

// ===== DOM 元素引用 =====
const $ = (id) => document.getElementById(id);

const dom = {
  // 连接
  vendorId: $("vendorId"),
  productId: $("productId"),
  filterAll: $("filterAll"),
  btnConnect: $("btnConnect"),
  btnDisconnect: $("btnDisconnect"),
  btnRefreshDevices: $("btnRefreshDevices"),
  pairedDevices: $("pairedDevices"),
  autoReconnect: $("autoReconnect"),
  deviceInfo: $("deviceInfo"),
  infoName: $("infoName"),
  infoVid: $("infoVid"),
  infoPid: $("infoPid"),
  infoSerial: $("infoSerial"),
  infoConfig: $("infoConfig"),
  infoInterfaces: $("infoInterfaces"),
  infoClass: $("infoClass"),
  infoVersion: $("infoVersion"),
  descriptorTree: $("descriptorTree"),
  // 配置
  configPanel: $("configPanel"),
  configNum: $("configNum"),
  interfaceNum: $("interfaceNum"),
  altSetting: $("altSetting"),
  endpointIn: $("endpointIn"),
  endpointOut: $("endpointOut"),
  btnClaim: $("btnClaim"),
  btnRelease: $("btnRelease"),
  // 控制传输
  controlPanel: $("controlPanel"),
  ctrlDir: $("ctrlDir"),
  ctrlType: $("ctrlType"),
  ctrlRecipient: $("ctrlRecipient"),
  ctrlRequest: $("ctrlRequest"),
  ctrlValue: $("ctrlValue"),
  ctrlIndex: $("ctrlIndex"),
  ctrlLength: $("ctrlLength"),
  ctrlData: $("ctrlData"),
  btnControlSend: $("btnControlSend"),
  // 通信
  commPanel: $("commPanel"),
  sendFormat: $("sendFormat"),
  sendData: $("sendData"),
  btnSend: $("btnSend"),
  sendHistory: $("sendHistory"),
  btnSendFile: $("btnSendFile"),
  fileInput: $("fileInput"),
  echoSend: $("echoSend"),
  periodInterval: $("periodInterval"),
  periodCount: $("periodCount"),
  btnStartPeriod: $("btnStartPeriod"),
  btnStopPeriod: $("btnStopPeriod"),
  btnStartRead: $("btnStartRead"),
  btnStopRead: $("btnStopRead"),
  readAllIn: $("readAllIn"),
  readLength: $("readLength"),
  receiveFormat: $("receiveFormat"),
  logFilter: $("logFilter"),
  logPause: $("logPause"),
  autoScroll: $("autoScroll"),
  btnClearLog: $("btnClearLog"),
  btnExportLog: $("btnExportLog"),
  btnExportBin: $("btnExportBin"),
  receiveLog: $("receiveLog"),
  // 统计
  statTxBytes: $("statTxBytes"),
  statTxPackets: $("statTxPackets"),
  statRxBytes: $("statRxBytes"),
  statRxPackets: $("statRxPackets"),
  statRate: $("statRate"),
  statUptime: $("statUptime"),
  // 状态
  statusBar: $("statusBar"),
  statusText: $("statusText"),
};

// ===== 全局状态 =====
let device = null;
let reading = false;
let claimedInterface = null;
let stats = { txBytes: 0, txPackets: 0, rxBytes: 0, rxPackets: 0, startTime: 0, lastRxBytes: 0 };
let logs = [];
let receivedChunks = [];
let periodTimer = null;
let periodRemaining = 0;
let rateTimer = null;
let reconnectTarget = null;
let failedDevices = new Set();

function deviceKey(vid, pid) { return `${vid}:${pid}`; }

// ===== USB Class 名称映射 =====
const USB_CLASS_NAMES = {
  0x00: "Device (类信息在接口描述符)",
  0x01: "Audio",
  0x02: "CDC Communications",
  0x03: "HID",
  0x05: "Physical",
  0x06: "Image",
  0x07: "Printer",
  0x08: "Mass Storage",
  0x09: "Hub",
  0x0a: "CDC Data",
  0x0b: "Smart Card",
  0x0d: "Content Security",
  0x0e: "Video",
  0x0f: "Personal Healthcare",
  0x10: "Diagnostic Device",
  0x11: "Wireless Controller",
  0x12: "Application Specific",
  0x13: "Vendor Specific",
  0xff: "Vendor Specific",
};

function className(code) {
  return (
    USB_CLASS_NAMES[code] ||
    `Unknown (0x${code.toString(16).toUpperCase().padStart(2, "0")})`
  );
}

// ===== 工具函数 =====

function toHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function toText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function viewToBytes(view) {
  if (view instanceof Uint8Array) return view;
  if (view instanceof ArrayBuffer) return new Uint8Array(view);
  if (view && view.buffer instanceof ArrayBuffer)
    return new Uint8Array(view.buffer, view.byteOffset || 0, view.byteLength || view.buffer.byteLength);
  return new Uint8Array(0);
}

function parseSendData(raw, format) {
  switch (format) {
    case "hex": {
      const cleaned = raw.replace(/[\s,;]+/g, "");
      if (cleaned.length % 2 !== 0) throw new Error("HEX 字符串长度必须为偶数");
      const bytes = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
      return bytes;
    }
    case "array": {
      const parts = raw.split(/[\s,;]+/).filter(Boolean);
      const bytes = new Uint8Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const v = parseInt(parts[i], 0);
        if (isNaN(v) || v < 0 || v > 255) throw new Error(`无效字节值: ${parts[i]}`);
        bytes[i] = v;
      }
      return bytes;
    }
    default:
      return new TextEncoder().encode(raw);
  }
}

function parseId(value) {
  if (!value) return undefined;
  const v = parseInt(value, value.startsWith("0x") || value.startsWith("0X") ? 16 : 10);
  return isNaN(v) ? undefined : v;
}

function hexId(v, len = 4) {
  return "0x" + v.toString(16).toUpperCase().padStart(len, "0");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setStatus(text, type = "") {
  dom.statusText.textContent = text;
  dom.statusBar.className = "status-bar" + (type ? ` ${type}` : "");
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===== 统计 =====

function resetStats() {
  stats = { txBytes: 0, txPackets: 0, rxBytes: 0, rxPackets: 0, startTime: Date.now(), lastRxBytes: 0 };
  updateStatsDisplay();
  dom.statRate.textContent = "0";
  dom.statUptime.textContent = "00:00";
}

function updateStatsDisplay() {
  dom.statTxBytes.textContent = stats.txBytes;
  dom.statTxPackets.textContent = stats.txPackets;
  dom.statRxBytes.textContent = stats.rxBytes;
  dom.statRxPackets.textContent = stats.rxPackets;
}

function startRateTimer() {
  stopRateTimer();
  rateTimer = setInterval(() => {
    const rate = stats.rxBytes - stats.lastRxBytes;
    stats.lastRxBytes = stats.rxBytes;
    dom.statRate.textContent = rate;
    const sec = Math.floor((Date.now() - stats.startTime) / 1000);
    dom.statUptime.textContent =
      String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
  }, 1000);
}

function stopRateTimer() {
  if (rateTimer) { clearInterval(rateTimer); rateTimer = null; }
}

// ===== 日志 =====

function addLog(direction, data, ep) {
  const now = new Date();
  const ts =
    now.toLocaleTimeString("zh-CN", { hour12: false }) +
    "." + String(now.getMilliseconds()).padStart(3, "0");
  const entry = { ts, dir: direction, ep: ep == null ? "" : ep, hex: toHex(data), text: toText(data) };
  logs.push(entry);
  if (logs.length > 5000) logs.shift();
  if (dom.logPause.checked) return;
  const filter = dom.logFilter.value;
  if (filter !== "all" && filter !== direction) return;
  appendLogEntry(entry);
}

function appendLogEntry(entry) {
  const el = document.createElement("div");
  el.className = "log-entry";
  const fmt = dom.receiveFormat.value;
  let content = "";
  if (fmt === "text" || fmt === "both")
    content += `<span class="data-text">${escapeHtml(entry.text)}</span>`;
  if (fmt === "hex" || fmt === "both")
    content += `<span class="data-hex">[${entry.hex}]</span>`;
  const epTag = entry.ep !== "" ? `<span class="ep-tag">EP${entry.ep}</span>` : "";
  el.innerHTML =
    `<span class="timestamp">${entry.ts}</span>` +
    `<span class="direction ${entry.dir}">${entry.dir === "in" ? "◀ IN" : "▶ OUT"}</span>` +
    epTag + content;
  dom.receiveLog.appendChild(el);
  if (dom.autoScroll.checked) dom.receiveLog.scrollTop = dom.receiveLog.scrollHeight;
}

function renderLogs() {
  dom.receiveLog.innerHTML = "";
  const filter = dom.logFilter.value;
  logs.forEach((e) => {
    if (filter !== "all" && filter !== e.dir) return;
    appendLogEntry(e);
  });
}

function clearLogs() {
  logs = [];
  receivedChunks = [];
  dom.receiveLog.innerHTML = "";
}

function exportLogCsv() {
  if (logs.length === 0) { setStatus("无日志可导出", "error"); return; }
  const rows = ["timestamp,direction,endpoint,hex,text"];
  logs.forEach((e) => {
    rows.push(`${e.ts},${e.dir},${e.ep || ""},"${e.hex}","${e.text.replace(/"/g, '""')}"`);
  });
  downloadBlob(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }), "usb-log.csv");
  setStatus(`已导出 ${logs.length} 条日志`);
}

function exportReceivedBin() {
  if (receivedChunks.length === 0) { setStatus("无接收数据可导出", "error"); return; }
  const total = receivedChunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  receivedChunks.forEach((c) => { buf.set(c, off); off += c.length; });
  downloadBlob(new Blob([buf], { type: "application/octet-stream" }), "usb-received.bin");
  setStatus(`已导出 ${total} 字节接收数据`);
}

// ===== 发送历史 =====

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("usb-send-history") || "[]"); }
  catch (_) { return []; }
}

function saveHistoryItem(format, raw) {
  let h = loadHistory();
  h = h.filter((x) => !(x.format === format && x.raw === raw));
  h.unshift({ format, raw });
  if (h.length > 20) h = h.slice(0, 20);
  localStorage.setItem("usb-send-history", JSON.stringify(h));
  renderHistory();
}

function renderHistory() {
  const h = loadHistory();
  dom.sendHistory.innerHTML = '<option value="">-- 无 --</option>';
  h.forEach((item, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    const label = `[${item.format}] ${item.raw}`;
    opt.textContent = label.length > 50 ? label.slice(0, 50) + "..." : label;
    dom.sendHistory.appendChild(opt);
  });
}

// ===== 描述符树 =====

function buildDescriptorTree() {
  if (!device) return "";
  const L = [];
  L.push(`Device: ${device.productName || "(unknown)"}`);
  L.push(`  VID: ${hexId(device.vendorId)}  PID: ${hexId(device.productId)}`);
  L.push(`  Class: ${className(device.deviceClass)} (0x${device.deviceClass.toString(16).padStart(2, "0")})`);
  L.push(`  Subclass: 0x${device.deviceSubclass.toString(16).padStart(2, "0")}  Protocol: 0x${device.deviceProtocol.toString(16).padStart(2, "0")}`);
  L.push(`  USB Version: ${device.usbVersionMajor}.${device.usbVersionMinor}.${device.usbVersionSubminor}`);
  L.push(`  Configurations: ${device.configurations.length}`);
  device.configurations.forEach((cfg) => {
    L.push(`  └─ Configuration ${cfg.configurationValue}`);
    L.push(`       Interfaces: ${cfg.interfaces.length}`);
    cfg.interfaces.forEach((iface) => {
      const alt0 = iface.alternates[0];
      L.push(`       └─ Interface ${iface.interfaceNumber} (${alt0 ? className(alt0.interfaceClass) : "?"})`);
      iface.alternates.forEach((alt) => {
        L.push(`            ├─ Alternate ${alt.alternateSetting} [class 0x${alt.interfaceClass.toString(16).padStart(2, "0")} sub 0x${alt.interfaceSubclass.toString(16).padStart(2, "0")} proto 0x${alt.interfaceProtocol.toString(16).padStart(2, "0")}]`);
        if (alt.endpoints.length === 0) {
          L.push(`            │    └─ (无端点)`);
        } else {
          alt.endpoints.forEach((ep) => {
            L.push(`            │    └─ EP ${ep.endpointNumber} ${ep.direction.toUpperCase()} (${ep.type || "bulk"}, ${ep.packetSize} bytes)`);
          });
        }
      });
    });
  });
  return L.join("\n");
}

// ===== 端点查找 =====

function getCurrentInterface() {
  if (!device || !device.configuration) return null;
  const ifaceNum = parseInt(dom.interfaceNum.value, 10);
  if (isNaN(ifaceNum)) return null;
  return device.configuration.interfaces.find((i) => i.interfaceNumber === ifaceNum) || null;
}

function getCurrentAlt() {
  const iface = getCurrentInterface();
  if (!iface) return null;
  const altNum = parseInt(dom.altSetting.value, 10);
  if (isNaN(altNum)) return iface.alternates[0] || null;
  return iface.alternates.find((a) => a.alternateSetting === altNum) || iface.alternates[0] || null;
}

function findEndpoint(direction, epNum) {
  const alt = getCurrentAlt();
  if (!alt) return null;
  return alt.endpoints.find((e) => e.endpointNumber === epNum && e.direction === direction) || null;
}

// ===== 核心流程 =====

async function connectDevice() {
  let dev;
  try {
    const filters = dom.filterAll.checked
      ? []
      : (() => {
          const f = {};
          const vid = parseId(dom.vendorId.value.trim());
          const pid = parseId(dom.productId.value.trim());
          if (vid !== undefined) f.vendorId = vid;
          if (pid !== undefined) f.productId = pid;
          return Object.keys(f).length ? [f] : [];
        })();
    dev = await navigator.usb.requestDevice({ filters });
  } catch (err) {
    // 设备选择阶段
    switch (err.name) {
      case "NotFoundError":
        setStatus("未选择设备：用户取消选择，或没有匹配 VID/PID 的设备");
        break;
      case "SecurityError":
        setStatus("无法请求设备：页面需通过 HTTPS 或 localhost 访问，且须由用户手势触发", "error");
        break;
      case "AbortError":
        setStatus("设备选择请求已中止", "error");
        break;
      case "IndexSizeError":
        setStatus("VID/PID 参数无效，请检查输入格式", "error");
        break;
      default:
        setStatus(`请求设备失败: ${err.message || err.name}`, "error");
    }
    console.error("连接错误(选择阶段):", err);
    return;
  }

  try {
    await openDevice(dev);
  } catch (err) {
    // 打开失败：登记到失败名单，禁止该设备自动重连
    failedDevices.add(deviceKey(dev.vendorId, dev.productId));
    device = null;
    switch (err.name) {
      case "NotFoundError":
        setStatus("设备已消失：所选设备已拔出或不可用", "error");
        break;
      case "SecurityError":
        setStatus("打开设备被拒绝：安全限制或缺少权限", "error");
        break;
      case "NotAllowedError":
        setStatus("打开设备被拒绝：权限不足", "error");
        break;
      case "NotReadableError":
        setStatus("无法访问设备：可能被系统驱动占用（如内核驱动已声明接口）", "error");
        break;
      case "InvalidStateError":
        setStatus("设备状态异常：可能已被打开或配置不可用", "error");
        break;
      case "NetworkError":
        setStatus("打开设备时发生网络/传输错误", "error");
        break;
      default:
        setStatus(`打开设备失败: ${err.message || err.name}`, "error");
    }
    console.error("连接错误(打开阶段):", err);
  }
}

async function openDevice(dev) {
  // 先打开，失败则抛出且不污染全局 device
  await dev.open();
  device = dev;
  try {
    if (device.configuration === null && device.configurations.length > 0) {
      await device.selectConfiguration(1);
    }
  } catch (err) {
    try { await device.close(); } catch (_) {}
    device = null;
    throw err;
  }
  // 打开成功：登记重连目标，从失败名单移除
  reconnectTarget = { vid: device.vendorId, pid: device.productId };
  failedDevices.delete(deviceKey(device.vendorId, device.productId));
  showDeviceInfo();
  populateConfig();
  dom.btnConnect.disabled = true;
  dom.btnDisconnect.disabled = false;
  dom.configPanel.classList.remove("hidden");
  dom.controlPanel.classList.remove("hidden");
  resetStats();
  startRateTimer();
  setStatus(`设备已打开: ${device.productName || "Unknown"}`, "connected");
}

function showDeviceInfo() {
  dom.infoName.textContent = device.productName || "(未知)";
  dom.infoVid.textContent = hexId(device.vendorId);
  dom.infoPid.textContent = hexId(device.productId);
  dom.infoSerial.textContent = device.serialNumber || "(无)";
  dom.infoConfig.textContent = device.configurations.length;
  dom.infoInterfaces.textContent = device.configuration ? device.configuration.interfaces.length : 0;
  dom.infoClass.textContent = `${className(device.deviceClass)} (0x${device.deviceClass.toString(16).padStart(2, "0")})`;
  dom.infoVersion.textContent = `${device.usbVersionMajor}.${device.usbVersionMinor}.${device.usbVersionSubminor}`;
  dom.descriptorTree.textContent = buildDescriptorTree();
  dom.deviceInfo.classList.remove("hidden");
}

function populateConfig() {
  dom.configNum.innerHTML = "";
  if (!device) return;
  device.configurations.forEach((cfg) => {
    const opt = document.createElement("option");
    opt.value = cfg.configurationValue;
    opt.textContent = `配置 ${cfg.configurationValue}`;
    dom.configNum.appendChild(opt);
  });
  if (device.configuration) dom.configNum.value = device.configuration.configurationValue;
  populateInterfaces();
}

function populateInterfaces() {
  dom.interfaceNum.innerHTML = "";
  if (!device || !device.configuration) { populateAlts(); return; }
  device.configuration.interfaces.forEach((iface) => {
    const alt = iface.alternates[0];
    const opt = document.createElement("option");
    opt.value = iface.interfaceNumber;
    opt.textContent = `接口 ${iface.interfaceNumber} - ${alt ? className(alt.interfaceClass) : "?"}`;
    dom.interfaceNum.appendChild(opt);
  });
  populateAlts();
}

function populateAlts() {
  dom.altSetting.innerHTML = "";
  const iface = getCurrentInterface();
  if (!iface) { populateEndpoints(); return; }
  iface.alternates.forEach((alt) => {
    const opt = document.createElement("option");
    opt.value = alt.alternateSetting;
    opt.textContent = `Alternate ${alt.alternateSetting}`;
    dom.altSetting.appendChild(opt);
  });
  populateEndpoints();
}

function populateEndpoints() {
  dom.endpointIn.innerHTML = '<option value="">-- 选择 --</option>';
  dom.endpointOut.innerHTML = '<option value="">-- 选择 --</option>';
  const alt = getCurrentAlt();
  if (!alt) return;
  alt.endpoints.forEach((ep) => {
    const opt = document.createElement("option");
    opt.value = ep.endpointNumber;
    const dir = ep.direction === "in" ? "IN" : "OUT";
    opt.textContent = `EP ${ep.endpointNumber} ${dir} (${ep.type || "bulk"}, ${ep.packetSize}B)`;
    if (ep.direction === "in") dom.endpointIn.appendChild(opt.cloneNode(true));
    else dom.endpointOut.appendChild(opt.cloneNode(true));
  });
  if (dom.endpointIn.options.length > 1) dom.endpointIn.selectedIndex = 1;
  if (dom.endpointOut.options.length > 1) dom.endpointOut.selectedIndex = 1;
}

async function claimInterface() {
  if (!device) { setStatus("未连接设备", "error"); return; }
  const ifaceNum = parseInt(dom.interfaceNum.value, 10);
  if (isNaN(ifaceNum)) { setStatus("请选择接口", "error"); return; }
  try {
    await device.claimInterface(ifaceNum);
    const altNum = parseInt(dom.altSetting.value, 10);
    if (!isNaN(altNum) && altNum !== 0) {
      await device.selectAlternateInterface(ifaceNum, altNum);
    }
    claimedInterface = ifaceNum;
    setStatus(`接口 ${ifaceNum} 已声明`, "connected");
    dom.commPanel.classList.remove("hidden");
    dom.btnClaim.disabled = true;
    dom.btnClaim.textContent = "接口已声明";
    dom.btnRelease.disabled = false;
  } catch (err) {
    setStatus(`声明接口失败: ${err.message}`, "error");
    console.error("声明接口错误:", err);
  }
}

async function releaseInterface() {
  if (!device || claimedInterface === null) return;
  try {
    await device.releaseInterface(claimedInterface);
    setStatus(`接口 ${claimedInterface} 已释放`);
    claimedInterface = null;
    dom.btnClaim.disabled = false;
    dom.btnClaim.textContent = "声明接口";
    dom.btnRelease.disabled = true;
  } catch (err) {
    setStatus(`释放接口失败: ${err.message}`, "error");
  }
}

function resetUI() {
  dom.btnConnect.disabled = false;
  dom.btnDisconnect.disabled = true;
  dom.deviceInfo.classList.add("hidden");
  dom.configPanel.classList.add("hidden");
  dom.commPanel.classList.add("hidden");
  dom.controlPanel.classList.add("hidden");
  dom.btnClaim.disabled = false;
  dom.btnClaim.textContent = "声明接口";
  dom.btnRelease.disabled = true;
  stopRateTimer();
}

async function disconnectDevice() {
  try {
    stopReading();
    stopPeriodic();
    if (device) {
      if (claimedInterface !== null) {
        try { await device.releaseInterface(claimedInterface); } catch (_) {}
        claimedInterface = null;
      }
      await device.close();
    }
  } catch (err) {
    console.warn("断开时出错:", err);
  }
  device = null;
  claimedInterface = null;
  resetUI();
  setStatus("设备已断开");
}

function onDisconnect(event) {
  if (event && event.device && event.device !== device) return;
  stopReading();
  stopPeriodic();
  device = null;
  claimedInterface = null;
  resetUI();
  dom.receiveLog.innerHTML = "";
  if (dom.autoReconnect.checked && reconnectTarget) {
    setStatus("设备已断开，等待自动重连...", "error");
  } else {
    setStatus("设备已意外断开", "error");
  }
}

async function onConnect(event) {
  const dev = event.device;
  const key = deviceKey(dev.vendorId, dev.productId);
  // 连接失败过的设备不自动重连
  if (dom.autoReconnect.checked && reconnectTarget &&
      dev.vendorId === reconnectTarget.vid && dev.productId === reconnectTarget.pid &&
      !failedDevices.has(key)) {
    setStatus("检测到目标设备插入，正在重连...", "connected");
    try {
      await openDevice(dev);
      reconnectTarget = null;
    } catch (err) {
      failedDevices.add(key);
      console.error("自动重连失败:", err);
      setStatus(`自动重连失败: ${err.message}（已停止对该设备的自动重连）`, "error");
    }
  } else if (failedDevices.has(key)) {
    setStatus(`检测到设备插入但曾连接失败，已跳过: ${dev.productName || "Unknown"} (VID:${dev.vendorId} PID:${dev.productId})`);
  } else {
    setStatus(`检测到设备插入: ${dev.productName || "Unknown"} (VID:${dev.vendorId} PID:${dev.productId})`);
  }
}

async function refreshPairedDevices() {
  try {
    const devices = await navigator.usb.getDevices();
    dom.pairedDevices.innerHTML = '<option value="">-- 无 --</option>';
    devices.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      const failed = failedDevices.has(deviceKey(d.vendorId, d.productId));
      const tag = failed ? " ⚠曾失败(不会自动重连)" : "";
      opt.textContent = `${d.productName || "Unknown"} (VID:${d.vendorId} PID:${d.productId})${tag}`;
      dom.pairedDevices.appendChild(opt);
    });
    if (devices.length === 0) setStatus("无已授权设备，请先连接一次以授权");
    else setStatus(`发现 ${devices.length} 个已授权设备`);
  } catch (err) {
    setStatus(`获取已授权设备失败: ${err.message}`, "error");
  }
}

// ===== 控制传输 =====

async function sendControlTransfer() {
  if (!device) { setStatus("未连接设备", "error"); return; }
  try {
    const setup = {
      requestType: dom.ctrlType.value,
      recipient: dom.ctrlRecipient.value,
      request: parseId(dom.ctrlRequest.value) || 0,
      value: parseId(dom.ctrlValue.value) || 0,
      index: parseId(dom.ctrlIndex.value) || 0,
    };
    if (dom.ctrlDir.value === "in") {
      const len = parseInt(dom.ctrlLength.value, 10) || 0;
      const result = await device.controlTransferIn(setup, len);
      if (result.status === "ok" && result.data) {
        const bytes = viewToBytes(result.data);
        addLog("in", bytes, 0);
        receivedChunks.push(bytes);
        stats.rxBytes += bytes.length;
        stats.rxPackets++;
        setStatus(`控制传输 IN 成功, ${bytes.length} 字节`, "connected");
      } else {
        setStatus(`控制传输 IN 状态: ${result.status}`, "error");
      }
    } else {
      const raw = dom.ctrlData.value.trim();
      const data = raw ? parseSendData(raw, "hex") : new Uint8Array(0);
      const result = data.length > 0
        ? await device.controlTransferOut(setup, data)
        : await device.controlTransferOut(setup);
      if (dom.echoSend.checked) addLog("out", data, 0);
      stats.txBytes += data.length;
      stats.txPackets++;
      setStatus(`控制传输 OUT 成功, ${result.bytesWritten || data.length} 字节`, "connected");
    }
    updateStatsDisplay();
  } catch (err) {
    setStatus(`控制传输失败: ${err.message}`, "error");
    console.error("控制传输错误:", err);
  }
}

// ===== 数据传输 =====

async function sendData(data) {
  if (!device) { setStatus("未连接设备", "error"); return false; }
  const epOut = parseInt(dom.endpointOut.value, 10);
  if (isNaN(epOut)) { setStatus("请选择 OUT 端点", "error"); return false; }
  const ep = findEndpoint("out", epOut);
  try {
    if (!ep || ep.type === "bulk" || ep.type === "interrupt") {
      await device.transferOut(epOut, data);
    } else if (ep.type === "isochronous") {
      await device.isochronousTransferOut(epOut, data, [data.length]);
    } else {
      setStatus("控制端点请使用控制传输面板", "error");
      return false;
    }
    if (dom.echoSend.checked) addLog("out", data, epOut);
    stats.txBytes += data.length;
    stats.txPackets++;
    updateStatsDisplay();
    setStatus(`已发送 ${data.length} 字节 → EP${epOut}`, "connected");
    return true;
  } catch (err) {
    setStatus(`发送失败: ${err.message}`, "error");
    console.error("发送错误:", err);
    return false;
  }
}

async function readLoop(epNum, length) {
  const ep = findEndpoint("in", epNum);
  while (reading) {
    try {
      let result;
      if (!ep || ep.type === "bulk" || ep.type === "interrupt") {
        result = await device.transferIn(epNum, length);
      } else if (ep.type === "isochronous") {
        result = await device.isochronousTransferIn(epNum, [length]);
      } else {
        break;
      }
      if (result.status === "ok" && result.data && result.data.byteLength > 0) {
        const bytes = viewToBytes(result.data);
        addLog("in", bytes, epNum);
        receivedChunks.push(bytes);
        stats.rxBytes += bytes.length;
        stats.rxPackets++;
        updateStatsDisplay();
      }
    } catch (err) {
      const isDeviceGone =
        err.name === "NetworkError" ||
        err.name === "NotFoundError" ||
        !device ||
        (typeof device.opened === "boolean" && !device.opened);
      if (reading && !isDeviceGone) {
        console.error("读取错误:", err);
        addLog("in", new TextEncoder().encode(`[错误] ${err.message}`), epNum);
      }
      if (isDeviceGone && device) onDisconnect();
      break;
    }
  }
}

async function startReading() {
  if (!device) { setStatus("未连接设备", "error"); return; }
  const length = parseInt(dom.readLength.value, 10) || 64;
  const eps = [];
  if (dom.readAllIn.checked) {
    const alt = getCurrentAlt();
    if (alt) alt.endpoints.filter((e) => e.direction === "in").forEach((e) => eps.push(e.endpointNumber));
  } else {
    const epIn = parseInt(dom.endpointIn.value, 10);
    if (!isNaN(epIn)) eps.push(epIn);
  }
  if (eps.length === 0) { setStatus("无可监听的 IN 端点", "error"); return; }
  reading = true;
  dom.btnStartRead.disabled = true;
  dom.btnStopRead.disabled = false;
  setStatus(`正在监听 EP${eps.join(", ")} ...`, "connected");
  eps.forEach((ep) => readLoop(ep, length));
}

function stopReading() {
  reading = false;
  dom.btnStartRead.disabled = false;
  dom.btnStopRead.disabled = true;
}

// ===== 定时发送 =====

function startPeriodic() {
  const raw = dom.sendData.value.trim();
  if (!raw) { setStatus("请先输入要发送的数据", "error"); return; }
  const interval = parseInt(dom.periodInterval.value, 10) || 1000;
  periodRemaining = parseInt(dom.periodCount.value, 10) || 0;
  const format = dom.sendFormat.value;
  dom.btnStartPeriod.disabled = true;
  dom.btnStopPeriod.disabled = false;
  const tick = async () => {
    if (!device) { stopPeriodic(); return; }
    try {
      const data = parseSendData(raw, format);
      await sendData(data);
    } catch (err) {
      setStatus(`定时发送失败: ${err.message}`, "error");
      stopPeriodic();
      return;
    }
    if (periodRemaining > 0) {
      periodRemaining--;
      if (periodRemaining <= 0) { stopPeriodic(); setStatus("定时发送完成"); }
    }
  };
  tick();
  periodTimer = setInterval(tick, interval);
  setStatus(`定时发送已启动 (间隔 ${interval}ms)`, "connected");
}

function stopPeriodic() {
  if (periodTimer) { clearInterval(periodTimer); periodTimer = null; }
  dom.btnStartPeriod.disabled = false;
  dom.btnStopPeriod.disabled = true;
}

// ===== 文件发送 =====

async function sendFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    const ok = await sendData(data);
    if (ok) setStatus(`已发送文件 ${file.name} (${data.length} 字节)`, "connected");
  } catch (err) {
    setStatus(`发送文件失败: ${err.message}`, "error");
  }
}

// ===== 事件绑定 =====

if (navigator.usb && typeof navigator.usb.addEventListener === "function") {
  navigator.usb.addEventListener("connect", onConnect);
  navigator.usb.addEventListener("disconnect", onDisconnect);
}

dom.btnConnect.addEventListener("click", connectDevice);
dom.btnDisconnect.addEventListener("click", disconnectDevice);
dom.btnRefreshDevices.addEventListener("click", refreshPairedDevices);

dom.pairedDevices.addEventListener("change", async () => {
  const idx = parseInt(dom.pairedDevices.value, 10);
  if (isNaN(idx)) return;
  try {
    const devices = await navigator.usb.getDevices();
    const dev = devices[idx];
    if (dev) await openDevice(dev);
  } catch (err) {
    device = null;
    setStatus(`打开已授权设备失败: ${err.message}（该设备不会自动重连）`, "error");
  }
});

dom.btnClaim.addEventListener("click", claimInterface);
dom.btnRelease.addEventListener("click", releaseInterface);

dom.configNum.addEventListener("change", async () => {
  if (!device) return;
  const cfgVal = parseInt(dom.configNum.value, 10);
  try {
    await device.selectConfiguration(cfgVal);
    populateInterfaces();
    setStatus(`已切换到配置 ${cfgVal}`, "connected");
  } catch (err) {
    setStatus(`切换配置失败: ${err.message}`, "error");
  }
});

dom.interfaceNum.addEventListener("change", populateAlts);
dom.altSetting.addEventListener("change", async () => {
  populateEndpoints();
  if (device && claimedInterface !== null) {
    const ifaceNum = parseInt(dom.interfaceNum.value, 10);
    const altNum = parseInt(dom.altSetting.value, 10);
    try {
      await device.selectAlternateInterface(ifaceNum, altNum);
      setStatus(`已切换到 Alternate ${altNum}`, "connected");
    } catch (err) {
      setStatus(`切换 Alternate 失败: ${err.message}`, "error");
    }
  }
});

dom.btnControlSend.addEventListener("click", sendControlTransfer);

dom.btnSend.addEventListener("click", async () => {
  const raw = dom.sendData.value.trim();
  if (!raw) return;
  try {
    const data = parseSendData(raw, dom.sendFormat.value);
    const ok = await sendData(data);
    if (ok) saveHistoryItem(dom.sendFormat.value, raw);
  } catch (err) {
    setStatus(`数据解析失败: ${err.message}`, "error");
  }
});

dom.sendData.addEventListener("keydown", (e) => {
  if (e.key === "Enter") dom.btnSend.click();
});

dom.sendHistory.addEventListener("change", () => {
  const idx = parseInt(dom.sendHistory.value, 10);
  if (isNaN(idx)) return;
  const h = loadHistory();
  const item = h[idx];
  if (item) {
    dom.sendFormat.value = item.format;
    dom.sendData.value = item.raw;
  }
});

dom.btnSendFile.addEventListener("click", () => dom.fileInput.click());
dom.fileInput.addEventListener("change", () => {
  const file = dom.fileInput.files[0];
  if (file) sendFile(file);
  dom.fileInput.value = "";
});

dom.btnStartPeriod.addEventListener("click", startPeriodic);
dom.btnStopPeriod.addEventListener("click", stopPeriodic);

dom.btnStartRead.addEventListener("click", startReading);
dom.btnStopRead.addEventListener("click", stopReading);

dom.receiveFormat.addEventListener("change", renderLogs);
dom.logFilter.addEventListener("change", renderLogs);

dom.btnClearLog.addEventListener("click", clearLogs);
dom.btnExportLog.addEventListener("click", exportLogCsv);
dom.btnExportBin.addEventListener("click", exportReceivedBin);

document.querySelectorAll(".quick-send .btn-sm").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const hex = btn.dataset.cmd;
    if (!hex) return;
    try {
      const data = parseSendData(hex, "hex");
      await sendData(data);
    } catch (err) {
      setStatus(`快捷命令失败: ${err.message}`, "error");
    }
  });
});

dom.vendorId.addEventListener("input", () => {
  if (dom.vendorId.value.trim()) dom.filterAll.checked = false;
});
dom.productId.addEventListener("input", () => {
  if (dom.productId.value.trim()) dom.filterAll.checked = false;
});
dom.filterAll.addEventListener("change", () => {
  if (dom.filterAll.checked) {
    dom.vendorId.value = "";
    dom.productId.value = "";
  }
});

// ===== 初始化 =====
(function init() {
  renderHistory();
  if (!navigator.usb) {
    setStatus("当前浏览器不支持 WebUSB API，请使用 Chrome / Edge", "error");
    dom.btnConnect.disabled = true;
    return;
  }
  refreshPairedDevices();
  setStatus("就绪 - 请连接 USB 设备");
})();
