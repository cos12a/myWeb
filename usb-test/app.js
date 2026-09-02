/**
 * Web USB 连接器 - 自定义 USB 设备通信
 *
 * 功能：
 *   1. 通过 VID/PID 或全量列表发现 USB 设备
 *   2. 打开设备 → 选择配置 → 声明接口
 *   3. 通过 Bulk/Interrupt 端点收发数据
 *   4. 实时日志显示（文本 / HEX / 混合）
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
  deviceInfo: $("deviceInfo"),
  infoName: $("infoName"),
  infoVid: $("infoVid"),
  infoPid: $("infoPid"),
  infoSerial: $("infoSerial"),
  infoConfig: $("infoConfig"),
  infoInterfaces: $("infoInterfaces"),
  // 配置
  configPanel: $("configPanel"),
  configNum: $("configNum"),
  interfaceNum: $("interfaceNum"),
  endpointIn: $("endpointIn"),
  endpointOut: $("endpointOut"),
  btnClaim: $("btnClaim"),
  // 通信
  commPanel: $("commPanel"),
  sendFormat: $("sendFormat"),
  sendData: $("sendData"),
  btnSend: $("btnSend"),
  btnStartRead: $("btnStartRead"),
  btnStopRead: $("btnStopRead"),
  receiveFormat: $("receiveFormat"),
  btnClearLog: $("btnClearLog"),
  receiveLog: $("receiveLog"),
  // 状态
  statusBar: $("statusBar"),
  statusText: $("statusText"),
};

// ===== 全局状态 =====
let device = null;
let reading = false;
let readLoopPromise = null;

// ===== 工具函数 =====

/** 将 DataView / Uint8Array 转为 HEX 字符串 */
function toHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0").toUpperCase(),
  ).join(" ");
}

/** 将 DataView / Uint8Array 转为文本 */
function toText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new TextDecoder().decode(bytes);
}

/** 解析用户输入的 HEX / 字节数组字符串为 Uint8Array */
function parseSendData(raw, format) {
  switch (format) {
    case "hex": {
      const cleaned = raw.replace(/[\s,;]+/g, "");
      if (cleaned.length % 2 !== 0) throw new Error("HEX 字符串长度必须为偶数");
      const bytes = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }
    case "array": {
      const parts = raw.split(/[\s,;]+/).filter(Boolean);
      const bytes = new Uint8Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const v = parseInt(parts[i], 0);
        if (isNaN(v) || v < 0 || v > 255)
          throw new Error(`无效字节值: ${parts[i]}`);
        bytes[i] = v;
      }
      return bytes;
    }
    default:
      return new TextEncoder().encode(raw);
  }
}

/** 添加日志条目 */
function addLog(direction, data) {
  const entry = document.createElement("div");
  entry.className = "log-entry";

  const now = new Date();
  const ts =
    now.toLocaleTimeString("zh-CN", { hour12: false }) +
    "." +
    String(now.getMilliseconds()).padStart(3, "0");

  const fmt = dom.receiveFormat.value;
  let content = "";

  if (fmt === "text" || fmt === "both") {
    content += `<span class="data-text">${toText(data)}</span>`;
  }
  if (fmt === "hex" || fmt === "both") {
    content += `<span class="data-hex">[${toHex(data)}]</span>`;
  }

  entry.innerHTML =
    `<span class="timestamp">${ts}</span>` +
    `<span class="direction ${direction}">${direction === "in" ? "◀ IN" : "▶ OUT"}</span>` +
    content;

  dom.receiveLog.appendChild(entry);
  dom.receiveLog.scrollTop = dom.receiveLog.scrollHeight;
}

/** 更新状态栏 */
function setStatus(text, type = "") {
  dom.statusText.textContent = text;
  dom.statusBar.className = "status-bar" + (type ? ` ${type}` : "");
}

/** 解析 VID/PID 输入（支持 0x1234 或纯数字） */
function parseId(value) {
  if (!value) return undefined;
  const v = parseInt(
    value,
    value.startsWith("0x") || value.startsWith("0X") ? 16 : 10,
  );
  return isNaN(v) ? undefined : v;
}

// ===== 核心流程 =====

/** 请求并连接 USB 设备 */
async function connectDevice() {
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

    // 弹出设备选择器
    device = await navigator.usb.requestDevice({ filters });

    // 打开设备
    await device.open();
    setStatus(`设备已打开: ${device.productName || "Unknown"}`, "connected");

    // 如果有配置且未选择，选择第一个配置
    if (device.configuration === null && device.configurations.length > 0) {
      await device.selectConfiguration(1);
    }

    // 显示设备信息
    showDeviceInfo();

    // 填充配置面板
    populateConfig();

    // 切换 UI 状态
    dom.btnConnect.disabled = true;
    dom.btnDisconnect.disabled = false;
    dom.configPanel.classList.remove("hidden");

    // 监听断开事件
    // device.addEventListener('disconnect', onDisconnect);
    // 兼容注册断开事件
    if (typeof device.addEventListener === "function") {
      device.addEventListener("disconnect", onDisconnect);
    } else if (typeof device.ondisconnect !== "undefined") {
      device.ondisconnect = onDisconnect;
    }
  } catch (err) {
    if (err.name === "NotFoundError") {
      setStatus("未选择设备");
    } else {
      setStatus(`连接失败: ${err.message}`, "error");
    }
    console.error("连接错误:", err);
  }
}

/** 显示设备信息 */
function showDeviceInfo() {
  dom.infoName.textContent = device.productName || "(未知)";
  dom.infoVid.textContent =
    "0x" + device.vendorId.toString(16).toUpperCase().padStart(4, "0");
  dom.infoPid.textContent =
    "0x" + device.productId.toString(16).toUpperCase().padStart(4, "0");
  dom.infoSerial.textContent = device.serialNumber || "(无)";
  dom.infoConfig.textContent = device.configurations.length;
  dom.infoInterfaces.textContent = device.configuration
    ? device.configuration.interfaces.length
    : 0;
  dom.deviceInfo.classList.remove("hidden");
}

/** 填充配置下拉框 */
function populateConfig() {
  dom.configNum.innerHTML = "";
  dom.interfaceNum.innerHTML = "";
  dom.endpointIn.innerHTML = '<option value="">-- 选择 --</option>';
  dom.endpointOut.innerHTML = '<option value="">-- 选择 --</option>';

  if (!device.configuration) return;

  // 配置号
  const cfgOpt = document.createElement("option");
  cfgOpt.value = device.configuration.configurationValue;
  cfgOpt.textContent = `配置 ${device.configuration.configurationValue}`;
  dom.configNum.appendChild(cfgOpt);

  // 接口
  device.configuration.interfaces.forEach((iface) => {
    const alt = iface.alternates[0];
    if (!alt) return;
    const opt = document.createElement("option");
    opt.value = iface.interfaceNumber;
    opt.textContent = `接口 ${iface.interfaceNumber} - ${alt.interfaceName || alt.interfaceClass}`;
    dom.interfaceNum.appendChild(opt);

    // 端点
    alt.endpoints.forEach((ep) => {
      const epOpt = document.createElement("option");
      epOpt.value = ep.endpointNumber;
      const dir = ep.direction === "in" ? "IN" : "OUT";
      const type = ep.type || "bulk";
      epOpt.textContent = `EP ${ep.endpointNumber} ${dir} (${type})`;

      if (ep.direction === "in") {
        dom.endpointIn.appendChild(epOpt.cloneNode(true));
      } else {
        dom.endpointOut.appendChild(epOpt.cloneNode(true));
      }
    });
  });

  // 自动选中第一项
  if (dom.endpointIn.options.length > 1) dom.endpointIn.selectedIndex = 1;
  if (dom.endpointOut.options.length > 1) dom.endpointOut.selectedIndex = 1;
}

/** 声明接口并启用通信面板 */
async function claimInterface() {
  const ifaceNum = parseInt(dom.interfaceNum.value, 10);
  if (isNaN(ifaceNum)) {
    setStatus("请选择接口", "error");
    return;
  }

  try {
    await device.claimInterface(ifaceNum);
    setStatus(`接口 ${ifaceNum} 已声明`, "connected");
    dom.commPanel.classList.remove("hidden");
    dom.btnClaim.disabled = true;
    dom.btnClaim.textContent = "接口已声明";
  } catch (err) {
    setStatus(`声明接口失败: ${err.message}`, "error");
    console.error("声明接口错误:", err);
  }
}

/** 发送数据 */
async function sendData(data) {
  const epOut = parseInt(dom.endpointOut.value, 10);
  if (isNaN(epOut)) {
    setStatus("请选择 OUT 端点", "error");
    return;
  }

  try {
    await device.transferOut(epOut, data);
    addLog("out", data);
    setStatus(`已发送 ${data.length} 字节 → EP${epOut}`, "connected");
  } catch (err) {
    setStatus(`发送失败: ${err.message}`, "error");
    console.error("发送错误:", err);
  }
}

/** 循环读取 IN 端点 */
async function startReading() {
  const epIn = parseInt(dom.endpointIn.value, 10);
  if (isNaN(epIn)) {
    setStatus("请选择 IN 端点", "error");
    return;
  }

  reading = true;
  dom.btnStartRead.disabled = true;
  dom.btnStopRead.disabled = false;
  setStatus(`正在监听 EP${epIn} ...`, "connected");

  readLoopPromise = (async () => {
    while (reading) {
      try {
        const result = await device.transferIn(epIn, 64);
        if (
          result.status === "ok" &&
          result.data &&
          result.data.byteLength > 0
        ) {
          addLog("in", new Uint8Array(result.data.buffer));
        }
      } catch (err) {
        // 设备物理拔掉时 transferIn 会抛出 NetworkError，属于正常断开而非读取错误
        const isDeviceGone =
          err.name === "NetworkError" ||
          err.name === "NotFoundError" ||
          !device ||
          (typeof device.opened === "boolean" && !device.opened);
        if (reading && !isDeviceGone) {
          console.error("读取错误:", err);
          addLog("in", new TextEncoder().encode(`[错误] ${err.message}`));
        }
        // 若 disconnect 事件尚未触发，主动清理 UI（避免界面停留在"正在监听"状态）
        if (isDeviceGone && device) {
          onDisconnect();
        }
        break;
      }
    }
  })();
}

/** 停止读取 */
function stopReading() {
  reading = false;
  dom.btnStartRead.disabled = false;
  dom.btnStopRead.disabled = true;
  setStatus("已停止监听");
}

/** 断开连接 */
async function disconnectDevice() {
  try {
    stopReading();

    if (device) {
      // device.removeEventListener("disconnect", onDisconnect);
      // 兼容方式移除断开事件
      if (typeof device.removeEventListener === "function") {
        device.removeEventListener("disconnect", onDisconnect);
      } else if (typeof device.ondisconnect !== "undefined") {
        device.ondisconnect = null;
      }
      await device.close();
    }
  } catch (err) {
    console.warn("断开时出错:", err);
  }

  device = null;

  // 重置 UI
  dom.btnConnect.disabled = false;
  dom.btnDisconnect.disabled = true;
  dom.deviceInfo.classList.add("hidden");
  dom.configPanel.classList.add("hidden");
  dom.commPanel.classList.add("hidden");
  dom.btnClaim.disabled = false;
  dom.btnClaim.textContent = "声明接口";
  setStatus("设备已断开");
}

/** 设备意外断开回调 */
function onDisconnect() {
  stopReading();
  device = null;
  dom.btnConnect.disabled = false;
  dom.btnDisconnect.disabled = true;
  dom.deviceInfo.classList.add("hidden");
  dom.configPanel.classList.add("hidden");
  dom.commPanel.classList.add("hidden");
  dom.btnClaim.disabled = false;
  dom.btnClaim.textContent = "声明接口";
  dom.receiveLog.innerHTML = ""; // ✅ 新增：清空日志
  setStatus("设备已意外断开", "error");
}

// ===== 事件绑定 =====

dom.btnConnect.addEventListener("click", connectDevice);
dom.btnDisconnect.addEventListener("click", disconnectDevice);

dom.btnClaim.addEventListener("click", claimInterface);

dom.btnSend.addEventListener("click", async () => {
  const raw = dom.sendData.value.trim();
  if (!raw) return;
  try {
    const data = parseSendData(raw, dom.sendFormat.value);
    await sendData(data);
    dom.sendData.value = "";
  } catch (err) {
    setStatus(`数据解析失败: ${err.message}`, "error");
  }
});

dom.sendData.addEventListener("keydown", (e) => {
  if (e.key === "Enter") dom.btnSend.click();
});

dom.btnStartRead.addEventListener("click", startReading);
dom.btnStopRead.addEventListener("click", stopReading);

dom.btnClearLog.addEventListener("click", () => {
  dom.receiveLog.innerHTML = "";
});

// 快捷命令按钮
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

// VID/PID 输入变化时自动取消 "不过滤"
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
  if (!navigator.usb) {
    setStatus("当前浏览器不支持 WebUSB API，请使用 Chrome / Edge", "error");
    dom.btnConnect.disabled = true;
    return;
  }
  setStatus("就绪 - 请连接 USB 设备");
})();
