import {
  ACK,
  COMMANDS,
  NACK,
  SYNC,
  Stm32Bootloader,
  addressPacket,
  toHex,
} from "./stm32.js?v=20260819";
import {
  SerialTransport,
  bootloaderEntryStages,
  enterBootloader,
  resetToRun,
} from "./serial-transport.js?v=20260819";
import { loadFirmwareFile } from "./firmware.js?v=20260819";
import { SerialMonitor } from "./serial-monitor.js?v=20260819";
// main.js 顶部添加
import { createAutoTrigger } from "./auto-trigger.js";

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const i18n = {
  zh: {
    eyebrow: "Web Serial / STM32 UART ISP",
    appTitle: "Unito Stoov-bed 烧录工具",
    settingsTitle: "烧写设置",
    target: "目标协议",
    selectPort: "选择并开启串口",
    chooseFirmware: "点击选择固件文件 (.bin / .hex)",
    noFile: "未加载文件",
    resetLogicTitle: "DTR/RTS 复位模式",
    resetMode1: "通用：DTR高电平复位，RTS低电平进BootLoader",
    resetMode2: "CH340C 经典电路",
    resetModeCh340x: "CH340X 直连电路",
    resetDtrHighBootRtsLow: "DTR高电平复位，RTS低电平进Bootloader",
    resetDtrLowBootRtsLow: "DTR低电平复位，RTS低电平进Bootloader",
    resetDtrHighBootRtsHigh: "DTR高电平复位，RTS高电平进Bootloader",
    resetDtrLowBootRtsHigh: "DTR低电平复位，RTS高电平进Bootloader",
    resetRtsHighBootDtrLow: "RTS高电平复位，DTR低电平进Bootloader",
    resetRtsLowBootDtrLow: "RTS低电平复位，DTR低电平进Bootloader",
    resetRtsHighBootDtrHigh: "RTS高电平复位，DTR高电平进Bootloader",
    resetRtsLowBootDtrHigh: "RTS低电平复位，DTR高电平进Bootloader",
    circuitHelp: "电路说明",
    circuitCh340c:
      "CH340C 经典电路：RTS# 经 PNP 三极管控制 BOOT0，DTR# 经 NPN 三极管控制 RESET。DTR 与 RTS 同电平时两管均截止，引脚由板载上下拉保持；DTR 低 / RTS 高时三极管导通，拉低 RESET 同时拉高 BOOT0，MCU 复位后进入 Bootloader。",
    circuitCh340x:
      "CH340X 直连电路：DTR#、RTS# 不经三极管，直接连接 RESET 和 BOOT0。入口时序为先将 RTS# 置为 BOOT 有效电平，再用 DTR# 产生一个低脉冲触发 RESET，释放后 MCU 在 BOOT0 为高的状态下启动进入 Bootloader。",
    resetModeCustom: "自定义 DTR/RTS 映射",
    resetModeNone: "不使用控制线 (手动按键进Boot)",
    advancedSettings: "高级设置...",
    flashBase: "Flash 起始地址 (Hex)",
    packetBytes: "写入分包大小 (Bytes)",
    parity: "奇偶校验位",
    timeout: "读取超时 (ms)",
    boot0: "BOOT0 高电平信号",
    reset: "RESET 触发信号",
    doErase: "烧录前全片擦除",
    doVerify: "烧录后完整校验（较慢）",
    doRun: "烧录成功后复位并运行程序",
    doClose: "完成后关闭串口",
    doUnlock: "若发生读保护，自动解除保护 (将擦除全片)",
    startProgram: "手动触发编程",
    closePort: "关闭串口",
    clear: "清空日志",
    executionLog: "执行日志",
    stepPort: "打开串口连接",
    stepBoot: "进入 Bootloader 模式",
    stepSync: "握手同步并读取芯片信息",
    stepErase: "擦除芯片 Flash",
    stepWrite: "分块写入固件数据",
    stepVerify: "读回固件进行一致性校验",
    stepRun: "复位并启动用户程序",
    manualConsole: "手动控制台",
    forceBoot: "强驱进Boot",
    forceRun: "强驱复位运行",
    sendHex: "发送 HEX",
    readByte: "读 1 字节",
    serialOk: "Web Serial API (就绪)",
    serialNo: "Web Serial 浏览器不支持该特性",
    debugRawRx: "记录原始入站字节",
    debugRawOff: "关闭 (推荐)",
    debugRawOn: "开启 🔧",
    monitorSerial: "编程前监听串口输出",
    monitorOn: "已开启编程前串口监听，设备输出将显示在日志中。",
    monitorOff: "已关闭编程前串口监听。",
    monitorFlushSize: "监听批量阈值（字符）",
    fetchFirmware: "获取Hex文件",
    fetchSuccess:
      "📄 从服务器获取固件成功: {filename} ({size} bytes, 类型: {format}).",
    fetchError: "❌ 获取固件失败: {error}",
    // zh 对象中添加
    autoProgram: "自动编程 (OTA)",
    autoProgramSending: "📡 正在发送 OTA 进入烧录模式指令...",
    autoProgramWaiting: "⏳ 等待设备重启进入 Bootloader (1s)...",
  },
  en: {
    eyebrow: "Web Serial / STM32 UART ISP",
    appTitle: "Unito Stoov-bed Flash Tool",
    settingsTitle: "Programming Settings",
    target: "Target protocol",
    selectPort: "Select and Open Port",
    chooseFirmware: "Click to select firmware (.bin / .hex)",
    noFile: "No file loaded",
    resetLogicTitle: "DTR/RTS reset mode",
    resetMode1: "Generic: DTR high reset, RTS low bootloader",
    resetMode2: "Classic CH340C circuit",
    resetModeCh340x: "CH340X direct circuit",
    resetDtrHighBootRtsLow: "DTR high resets, RTS low enters Bootloader",
    resetDtrLowBootRtsLow: "DTR low resets, RTS low enters Bootloader",
    resetDtrHighBootRtsHigh: "DTR high resets, RTS high enters Bootloader",
    resetDtrLowBootRtsHigh: "DTR low resets, RTS high enters Bootloader",
    resetRtsHighBootDtrLow: "RTS high resets, DTR low enters Bootloader",
    resetRtsLowBootDtrLow: "RTS low resets, DTR low enters Bootloader",
    resetRtsHighBootDtrHigh: "RTS high resets, DTR high enters Bootloader",
    resetRtsLowBootDtrHigh: "RTS low resets, DTR high enters Bootloader",
    circuitHelp: "Circuit notes",
    circuitCh340c:
      "Classic CH340C circuit: RTS# drives a PNP transistor to control BOOT0, DTR# drives an NPN transistor to control RESET. When DTR and RTS are at the same level both transistors are off and the pins follow board pull-up/down resistors; when DTR is low / RTS is high the transistors conduct, pulling RESET low while driving BOOT0 high so the MCU resets into Bootloader.",
    circuitCh340x:
      "CH340X direct circuit: DTR# and RTS# connect to RESET and BOOT0 without transistors. The entry sequence sets RTS# to the BOOT-active level first, then pulses DTR# low to trigger RESET; after release the MCU starts with BOOT0 high and enters Bootloader.",
    resetModeCustom: "Custom DTR/RTS mapping",
    resetModeNone: "No control flow (Manual boot)",
    advancedSettings: "Advanced settings...",
    flashBase: "Flash base address (Hex)",
    packetBytes: "Write packet size (Bytes)",
    parity: "Parity",
    timeout: "Read timeout (ms)",
    boot0: "BOOT0 high signal",
    reset: "RESET assert signal",
    doErase: "Mass erase before writing",
    doVerify: "Full verify after writing (slower)",
    doRun: "Reset and run program upon success",
    doClose: "Close port after completion",
    doUnlock: "Auto-unlock readout protection (erases chip)",
    startProgram: "Start Programming",
    closePort: "Close Port",
    clear: "Clear Log",
    executionLog: "Execution Log",
    stepPort: "Open serial port connection",
    stepBoot: "Enter Bootloader mode",
    stepSync: "Handshake sync and read chip info",
    stepErase: "Erase Flash memory",
    stepWrite: "Write firmware data blocks",
    stepVerify: "Verify written data consistency",
    stepRun: "Reset and start user program",
    manualConsole: "Manual Console",
    forceBoot: "Force Boot",
    forceRun: "Force Run",
    sendHex: "Send HEX",
    readByte: "Read Byte",
    serialOk: "Web Serial API (Ready)",
    serialNo: "Web Serial not supported in this browser",
    debugRawRx: "Log raw RX bytes",
    debugRawOff: "Off (Recommended)",
    debugRawOn: "On 🔧",
    monitorSerial: "Monitor serial output before flashing",
    monitorOn:
      "Pre-flash serial monitoring enabled; device output will appear in the log.",
    monitorOff: "Pre-flash serial monitoring disabled.",
    monitorFlushSize: "Monitor flush size (chars)",
    fetchFirmware: "Fetch HEX File",
    fetchSuccess:
      "📄 Firmware fetched from server: {filename} ({size} bytes, type: {format}).",
    fetchError: "❌ Failed to fetch firmware: {error}",
    // en 对象中添加
    autoProgram: "Auto Program (OTA)",
    autoProgramSending: "📡 Sending OTA bootloader entry command...",
    autoProgramWaiting:
      "⏳ Waiting for device to reboot into Bootloader (1s)...",
  },
};

const state = {
  lang: localStorage.getItem("lang") || "zh",
  theme: localStorage.getItem("theme") || "dark",
  port: null,
  transport: null,
  bootloader: null,
  firmware: null,
  firmwareName: "",
  connected: false,
};
const MAX_LOG_ENTRIES = 80; // 最大保留日志条数
const els = {
  themeToggle: $("themeToggle"),
  languageToggle: $("languageToggle"),
  portName: $("portName"),
  targetProfile: $("targetProfile"),
  baudRate: $("baudRate"),
  resetLogic: $("resetLogic"),
  flashBase: $("flashBase"),
  packetSize: $("packetSize"),
  parity: $("parity"),
  timeoutMs: $("timeoutMs"),
  boot0High: $("boot0High"),
  resetAssert: $("resetAssert"),
  firmwareInput: $("firmwareInput"),
  firmwareName: $("firmwareName"),
  firmwareSize: $("firmwareSize"),
  doErase: $("doErase"),
  doVerify: $("doVerify"),
  doRun: $("doRun"),
  doClose: $("doClose"),
  doUnlock: $("doUnlock"),
  selectPortBtn: $("selectPortBtn"),
  disconnectBtn: $("disconnectBtn"),
  fullProcessBtn: $("fullProcessBtn"),
  clearLogBtn: $("clearLogBtn"),
  log: $("log"),
  progressBar: $("progressBar"),

  // 手动控制台元素
  enterBootBtn: $("enterBootBtn"),
  resetRunBtn: $("resetRunBtn"),
  dtrLowBtn: $("dtrLowBtn"),
  dtrHighBtn: $("dtrHighBtn"),
  rtsLowBtn: $("rtsLowBtn"),
  rtsHighBtn: $("rtsHighBtn"),
  hexInput: $("hexInput"),
  sendHexBtn: $("sendHexBtn"),
  readByteBtn: $("readByteBtn"),
  circuitInfoBtn: $("circuitInfoBtn"),
  circuitDialog: $("circuitDialog"),
  circuitDialogClose: $("circuitDialogClose"),
  debugRawRx: $("debugRawRx"), // 【新增】
  monitorSerial: $("monitorSerial"), // 【新增】编程前串口监听开关
  monitorFlushSize: $("monitorFlushSize"), // 【新增】监听批量阈值
  fetchFirmwareBtn: $("fetchFirmwareBtn"), // ← 新增下载固件按钮
  autoProgramBtn: $("autoProgramBtn"), // ← 新增
};

function t(key) {
  return i18n[state.lang][key] ?? i18n.en[key] ?? key;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function applyLanguage() {
  document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
  els.languageToggle.querySelector(".lang-text").textContent =
    state.lang === "zh" ? "EN" : "中";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  if (!state.firmware) els.firmwareSize.textContent = t("noFile");
  if (!state.firmware) els.firmwareName.textContent = t("chooseFirmware");
  updateUi();
}

function log(message, level = "info") {
  const stamp = new Date().toLocaleTimeString();
  const color =
    level === "error"
      ? "var(--danger)"
      : level === "warn"
        ? "var(--warn)"
        : level === "monitor"
          ? "var(--monitor)"
          : "var(--text)";
  const el = document.createElement("div");
  el.style.color = color;
  if (level === "monitor") el.classList.add("log-monitor");
  el.textContent = `[${stamp}] ${message}`;
  els.log.appendChild(el);
  els.log.scrollTop = els.log.scrollHeight;

  // ---- 新增：限制日志条目数量 ----
  while (els.log.children.length > MAX_LOG_ENTRIES) {
    els.log.removeChild(els.log.firstChild);
  }
}

// 定义触发数据模式
const TRIGGER_PATTERN = new Uint8Array([
  0x00, 0x40, 0xa0, 0x48, 0x02, 0xa0, 0x8b, 0x85, 0x9f,
]);

// 创建自动触发器（在 serialMonitor 之前，以便传入 onData）
const autoTrigger = createAutoTrigger({
  pattern: TRIGGER_PATTERN,
  minInterval: 500,
  maxInterval: 1500,
  timeout: 2500,
  triggerDelay: 4000,
  onTrigger: () => {
    if (state.connected && !state.bootloader?.programming) {
      log("🚀 自动触发编程开始", "info");
      runAutoProgram(); // 直接调用烧录函数
    } else {
      log("⚠️ 无法触发：串口未连接或正在编程中", "warn");
    }
  },
  log: (msg, level) => log(`[AutoTrigger] ${msg}`, level),
});

// 【新增】编程前串口监听器：把未编程期间收到的设备数据以文本形式写入执行日志
const serialMonitor = new SerialMonitor({
  log: (text) => log(`📡 ${text}`, "monitor"),
  enabled: true,
  mode: "hex", // 或 'hex' / 'text'
  flushSize: 5,
  onData: (bytes) => autoTrigger.onData(bytes), // ← 关键
});

function setProgress(value) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function parseNumber(value, label) {
  const parsed = value.trim().startsWith("0x")
    ? Number.parseInt(value, 16)
    : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed))
    throw new Error(`Invalid base address ${label}`);
  return parsed >>> 0;
}

function options() {
  const boot0High = els.boot0High.value;
  return {
    target: els.targetProfile.value,
    baudRate: Number.parseInt(els.baudRate.value, 10),
    timeout: Number.parseInt(els.timeoutMs.value, 10),
    parity: els.parity.value,
    flashBase: parseNumber(els.flashBase.value, "flash base"),
    packetSize: Number.parseInt(els.packetSize.value, 10),
    resetLogic: els.resetLogic.value,
    resetConfig:
      els.resetLogic.value === "custom"
        ? {
            boot0High,
            boot0Low: boot0High
              .replace("true", "TMP")
              .replace("false", "true")
              .replace("TMP", "false"),
            resetAssert: els.resetAssert.value,
          }
        : els.resetLogic.value,
    doErase: els.doErase.checked,
    doVerify: els.doVerify.checked,
    doRun: els.doRun.checked,
    doClose: els.doClose.checked,
    doUnlock: els.doUnlock.checked,
  };
}

function browserBootloaderEntryStages(config) {
  const stages = bootloaderEntryStages(config.resetConfig);
  if (!["dtr-low-rts-high", "ch340x"].includes(config.resetLogic))
    return stages;

  const firstStage =
    config.resetLogic === "ch340x"
      ? makeBrowserResetStage(
          "RTS BOOT=false / DTR RESET=true",
          "rts",
          false,
          "dtr",
          true,
        )
      : makeBrowserResetStage(
          "RTS BOOT=true / DTR RESET=false",
          "rts",
          true,
          "dtr",
          false,
        );
  const explicitStages = [
    firstStage,
    makeBrowserResetStage(
      "RTS BOOT=true / DTR RESET=false",
      "rts",
      true,
      "dtr",
      false,
    ),
    makeBrowserResetStage(
      "RTS BOOT=true / DTR RESET=true",
      "rts",
      true,
      "dtr",
      true,
    ),
    makeBrowserResetStage(
      "RTS BOOT=false / DTR RESET=true",
      "rts",
      false,
      "dtr",
      true,
    ),
    makeBrowserResetStage(
      "RTS BOOT=false / DTR RESET=false",
      "rts",
      false,
      "dtr",
      false,
    ),
    makeBrowserResetStage(
      "DTR BOOT=true / RTS RESET=true",
      "dtr",
      true,
      "rts",
      true,
    ),
    makeBrowserResetStage(
      "DTR BOOT=true / RTS RESET=false",
      "dtr",
      true,
      "rts",
      false,
    ),
    makeBrowserResetStage(
      "DTR BOOT=false / RTS RESET=true",
      "dtr",
      false,
      "rts",
      true,
    ),
    makeBrowserResetStage(
      "DTR BOOT=false / RTS RESET=false",
      "dtr",
      false,
      "rts",
      false,
    ),
  ].filter(
    (stage, index, allStages) =>
      allStages.findIndex((candidate) => candidate.name === stage.name) ===
      index,
  );

  return [...explicitStages, ...stages];
}

function signalForLine(line, value) {
  return line === "dtr"
    ? { dataTerminalReady: value }
    : { requestToSend: value };
}

function combinedSignals(...choices) {
  return choices.reduce(
    (signals, [line, value]) => ({
      ...signals,
      ...signalForLine(line, value),
    }),
    {},
  );
}

function makeBrowserResetStage(
  name,
  bootLine,
  bootValue,
  resetLine,
  resetAssertValue,
) {
  const resetReleaseValue = !resetAssertValue;
  const idleBootValue = !bootValue;

  return {
    name,
    config: [
      {
        signals: combinedSignals(
          [bootLine, idleBootValue],
          [resetLine, resetReleaseValue],
        ),
        delayMs: 150,
      },
      {
        signals: combinedSignals(
          [bootLine, bootValue],
          [resetLine, resetReleaseValue],
        ),
        delayMs: 150,
      },
      {
        signals: combinedSignals(
          [bootLine, bootValue],
          [resetLine, resetAssertValue],
        ),
        delayMs: 150,
      },
      {
        signals: combinedSignals(
          [bootLine, bootValue],
          [resetLine, resetReleaseValue],
        ),
        delayMs: 1000,
      },
    ],
    runConfig: [
      {
        signals: combinedSignals(
          [bootLine, idleBootValue],
          [resetLine, resetReleaseValue],
        ),
        delayMs: 150,
      },
      {
        signals: combinedSignals(
          [bootLine, idleBootValue],
          [resetLine, resetAssertValue],
        ),
        delayMs: 150,
      },
      {
        signals: combinedSignals(
          [bootLine, idleBootValue],
          [resetLine, resetReleaseValue],
        ),
        delayMs: 1000,
      },
    ],
  };
}

async function enterBootloaderStage(transport, delay, stageConfig) {
  if (!Array.isArray(stageConfig)) {
    await enterBootloader(transport, delay, stageConfig);
    return;
  }

  for (const step of stageConfig) {
    await transport.setSignals(step.signals);
    await delay(step.delayMs);
  }
}

async function resetToRunStage(transport, delay, stageConfig, fallbackConfig) {
  if (!Array.isArray(stageConfig)) {
    await resetToRun(transport, delay, fallbackConfig);
    return;
  }

  for (const step of stageConfig) {
    await transport.setSignals(step.signals);
    await delay(step.delayMs);
  }
}

async function releaseBootForRunStage(transport, delay, stageConfig) {
  if (!Array.isArray(stageConfig) || stageConfig.length === 0) return;
  const [releaseStep] = stageConfig;
  await transport.setSignals(releaseStep.signals);
  await delay(releaseStep.delayMs);
}

async function resetCh340xWebToRun(transport, delay) {
  await transport.setSignals({ requestToSend: true, dataTerminalReady: true });
  await delay(250);

  await transport.setSignals({ requestToSend: true, dataTerminalReady: false });
  await delay(250);

  await transport.setSignals({ requestToSend: true, dataTerminalReady: true });
  await delay(1000);
}

async function goToAddress(bootloader, transport, address) {
  if (typeof bootloader.go === "function") {
    await bootloader.go(address);
    return;
  }

  await bootloader.sendCommand(COMMANDS.GO);
  await transport.write(addressPacket(address));
  await bootloader.expectAck();
}

async function syncBootloaderIgnoringNoise(transport, timeout) {
  const deadline = Date.now() + timeout;
  const ignored = [];
  await transport.flushReadBuffer();
  await transport.write([SYNC]);

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    let byte;
    try {
      byte = (await transport.readExact(1, remaining))[0];
    } catch (error) {
      if (ignored.length > 0) {
        const preview = ignored
          .slice(0, 16)
          .map((value) => toHex(value))
          .join(" ");
        const suffixText = ignored.length > 16 ? " ..." : "";
        throw new Error(
          `读取超时 (等待 Bootloader ACK, 已忽略 ${ignored.length} 字节非 Bootloader 响应: ${preview}${suffixText})`,
        );
      }
      throw error;
    }
    if (byte === ACK) return ignored;
    if (byte === NACK) throw new Error("Bootloader returned NACK");
    ignored.push(byte);
  }

  const preview = ignored
    .slice(0, 16)
    .map((value) => toHex(value))
    .join(" ");
  const suffixText = ignored.length > 16 ? " ..." : "";
  throw new Error(
    `读取超时 (等待 Bootloader ACK, 已忽略 ${ignored.length} 字节非 Bootloader 响应: ${preview}${suffixText})`,
  );
}

function updateUi() {
  const supported = "serial" in navigator;

  const btnPort = els.selectPortBtn;
  if (state.connected) {
    btnPort.dataset.connected = "true";
  } else {
    btnPort.dataset.connected = "false";
    els.portName.textContent = t("selectPort");
  }

  els.disconnectBtn.disabled = !state.connected;

  const canFlash =
    state.connected &&
    state.firmware &&
    els.targetProfile.value === "stm32-uart";
  els.fullProcessBtn.disabled = !canFlash;
  if (els.autoProgramBtn) els.autoProgramBtn.disabled = !canFlash; // ← 新增
  // 调试面板更新
  [
    els.enterBootBtn,
    els.resetRunBtn,
    els.dtrLowBtn,
    els.dtrHighBtn,
    els.rtsLowBtn,
    els.rtsHighBtn,
    els.sendHexBtn,
    els.readByteBtn,
  ].forEach((button) => {
    if (button) button.disabled = !state.connected;
  });
}

function applySavedPreferences() {
  ["doVerify", "doClose"].forEach((key) => {
    const saved = localStorage.getItem(key);
    if (saved !== null && els[key]) {
      els[key].checked = saved === "true";
    }
  });
  const monitor = localStorage.getItem("monitorSerial");
  if (monitor !== null && els.monitorSerial) {
    els.monitorSerial.checked = monitor === "true";
  }
  const flushSize = localStorage.getItem("monitorFlushSize");
  if (flushSize !== null && els.monitorFlushSize) {
    els.monitorFlushSize.value = flushSize;
  }
}

async function requestPort() {
  try {
    state.port = await navigator.serial.requestPort();
    // Try getting info if browser supports it
    const info = state.port.getInfo();
    const vid = info.usbVendorId ? toHex(info.usbVendorId, 4) : "xxxx";
    const pid = info.usbProductId ? toHex(info.usbProductId, 4) : "xxxx";
    els.portName.textContent = `USB Serial (VID:${vid} PID:${pid})`;
    await connect();
  } catch (e) {
    if (!e.message.includes("No port selected")) {
      log(`串口选择失败: ${e.message}`, "error");
    }
  }
}

async function connect() {
  if (!state.port) return;
  const config = options();

  try {
    // state.transport = new SerialTransport(state.port, log);
    // 【核心改动】传入获取复选框状态的箭头函数
    state.transport = new SerialTransport(
      state.port,
      log,
      () => els.debugRawRx?.checked ?? false, // 回调：实时读取 checkbox 状态
    );
    // 【新增】设备拔出或读错误时回调，更新状态并释放资源
    state.transport.onDisconnect = handleSerialDisconnect;
    // 重置自动触发器，避免旧会话残留
    autoTrigger.reset();
    // 【新增】打开串口前先挂接监听并清空上次会话残留，保证新串口数据从第一字节起进入监听
    serialMonitor.attach(state.transport);
    serialMonitor.setFlushSize(els.monitorFlushSize?.value ?? 5);
    serialMonitor.setEnabled(els.monitorSerial.checked);
    serialMonitor.setProgramming(false);
    await state.transport.open({
      baudRate: config.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: config.parity,
      flowControl: "none",
    });

    state.connected = true;
    const { timeout } = config;
    state.bootloader = new Stm32Bootloader(state.transport, {
      timeout,
      onProgress: ({ phase, offset, total }) => {
        const base = phase === "write" ? 35 : 70;
        const span = phase === "write" ? 35 : 25;
        setProgress(base + (offset / total) * span);
      },
    });

    if (els.monitorSerial.checked) {
      log(t("monitorOn"), "monitor");
    }

    log(
      `✅ 串口已开启: 波特率 ${config.baudRate}, 数据位 8, 检验位 ${config.parity[0].toUpperCase()}, 停止位 1`,
    );
    // ---- 新增：自动获取固件 ----
    try {
      // await fetchFirmwareFromServer();
      // 如果不想覆盖用户已上传的固件，可加判断：
      if (!state.firmware) {
        await fetchFirmwareFromServer();
      }
    } catch (e) {
      // fetchFirmwareFromServer 内部已记录错误，此处无需额外处理
    }
  } catch (e) {
    log(`串口连接失败: ${e.message}`, "error");
    serialMonitor.detach(); // 【新增】连接失败时摘除监听并清空残留
    autoTrigger.reset(); // 清理定时器

    state.transport = null;
    state.port = null;
  }
  updateUi();
}

// 释放串口相关状态与资源（不负责关闭底层端口，供断开回调与页面退出复用）
function cleanupSerial() {
  serialMonitor.detach();
  autoTrigger.reset();
  state.connected = false;
  state.port = null;
  state.transport = null;
  state.bootloader = null;
  setProgress(0);
}

// 串口异常断开（设备拔出 / 读错误）时统一收尾
function handleSerialDisconnect() {
  if (!state.connected) return; // 已在断开流程中，避免重复处理
  log("⚠️ 串口连接已断开（设备拔出或异常），正在释放资源...", "warn");
  if (state.transport) {
    state.transport.close().catch(() => {});
  }
  cleanupSerial();
  updateUi();
}

async function disconnect() {
  if (state.transport) {
    await state.transport.close();
  }
  cleanupSerial();
  log("⛔ 串口已关闭。");
  updateUi();
}

async function closePortAfterRun() {
  if (state.transport) {
    await state.transport.close();
  }
  cleanupSerial();
  log("==> 串口已关闭，DTR/RTS 控制线已释放。");
  updateUi();
}

// ============== 核心烧录流水线 ==============
let isProgramming = false;
// OTA 进入烧录模式指令
const OTA_BOOT_CMD = new Uint8Array([
  0x00, 0x01, 0x02, 0x0b, 0x0a, 0x02, 0x03, 0x6f, 0x74, 0x61, 0x9f, 0xff,
]);
/**
 * 自动编程：先发送 OTA 指令让设备进入 Bootloader，再执行标准烧录流程
 */
async function runAutoProgramWithOta() {
  if (!state.connected || !state.transport) {
    log("❌ 串口未连接，无法发送 OTA 指令", "error");
    return;
  }
  if (!state.firmware) {
    log("❌ 未加载固件文件，请先选择或获取固件", "error");
    return;
  }
  if (isProgramming) {
    log("⚠️ 已有烧录任务正在运行，忽略本次触发", "warn");
    return;
  }

  try {
    els.autoProgramBtn.disabled = true; // ← 新增
    els.fullProcessBtn.disabled = true;
    // Step 1: 发送 OTA 指令
    log(t("autoProgramSending"), "info");
    await state.transport.write(OTA_BOOT_CMD);
    log(
      `TX OTA CMD: ${Array.from(OTA_BOOT_CMD)
        .map((b) => toHex(b))
        .join(" ")}`,
      "info",
    );

    // Step 2: 等待 1.5 秒让设备重启进入 Bootloader
    log(t("autoProgramWaiting"), "info");
    await delay(2000);

    // Step 3: 调用标准烧录流程
    await runAutoProgram();
  } catch (e) {
    log(`❌ 自动编程失败: ${e.message}`, "error");
  }
  els.autoProgramBtn.disabled = false; // ← 新增
  els.fullProcessBtn.disabled = false;
}

async function runAutoProgram() {
  const config = options();
  if (!state.connected || !state.bootloader || !state.firmware) return;
  if (config.target !== "stm32-uart") {
    log(
      "当前自动烧录流程仅实现 STM32 UART ISP。其他目标请使用手动控制台或后续协议适配器。",
      "warn",
    );
    return;
  }
  if (isProgramming) {
    log("⚠️ 已有烧录任务正在运行，忽略本次触发", "warn");
    return;
  }
  isProgramming = true;
  // UI 锁定
  els.fullProcessBtn.disabled = true;
  setProgress(0);
  serialMonitor.setProgramming(true); // 【新增】编程开始：摘除监听，串口交给编程接口管理
  autoTrigger.setPaused(true); // 明确暂停触发器

  els.log.innerHTML += "<br/>========== 开始一键烧写流程 ==========\n";
  let selectedRunConfig = null;
  let shouldClosePortAfterRun = false;

  async function enterAndSyncBootloader() {
    const stages = browserBootloaderEntryStages(config);
    let info = null;
    let chipId = null;
    let lastError = null;
    for (const [index, stage] of stages.entries()) {
      const suffix =
        stages.length > 1
          ? ` (${stage.name}, ${index + 1}/${stages.length})`
          : "";
      log(`2.${index + 1} 正在进入 Bootloader 并同步${suffix}...`);
      try {
        await enterBootloaderStage(state.transport, delay, stage.config);
        const ignored = await syncBootloaderIgnoringNoise(
          state.transport,
          config.timeout,
        );
        if (ignored.length > 0) {
          const preview = ignored
            .slice(0, 16)
            .map((byte) => toHex(byte))
            .join(" ");
          const suffixText = ignored.length > 16 ? " ..." : "";
          log(
            `⚠️ 同步前忽略了 ${ignored.length} 字节非 Bootloader 响应: ${preview}${suffixText}`,
            "warn",
          );
        }
        info = await state.bootloader.getCommands();
        chipId = await state.bootloader.getId();
        selectedRunConfig = stage.runConfig ?? null;
        log(
          `==> 同步成功${suffix}: Bootloader ${toHex(info.version)}, PID ${toHex(chipId, 4)}`,
        );
        return { info, chipId };
      } catch (error) {
        lastError = error;
        if (index < stages.length - 1) {
          log(
            `⚠️ 同步失败${suffix}: ${error.message}，尝试下一组控制线时序...`,
            "warn",
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error("Bootloader 同步失败");
  }

  try {
    // 第一步: 端口本身我们已经打开了

    // 第二步: 通过 DTR/RTS 唤起 Bootloader
    log(`1. 正在复位单片机并进入 ISP 模式 (模式: ${config.resetLogic})...`);
    setProgress(5);
    // 第三步: 测试波特率 & 握手
    await enterAndSyncBootloader();
    setProgress(20);

    // // ---------- 新增：读取保留页 ----------
    // let backup = null;
    // const PAGE_SIZE = 2048; // 根据芯片手册确认
    // const lastPageStart = 30;
    // const readAddress = 0x08000000 + lastPageStart * PAGE_SIZE;
    // const bytesToRead = PAGE_SIZE * 2;

    // if (config.doErase) {
    //   // 只有需要擦除时才备份
    //   try {
    //     log(
    //       `尝试读取保留页 30~31 (地址 0x${readAddress.toString(16).padStart(8, "0")})...`,
    //     );
    //     backup = await state.bootloader.readMemory(readAddress, bytesToRead);
    //     log(`==> 备份成功 (${backup.length} 字节)`);
    //   } catch (e) {
    //     log(`⚠️ 读取保留页失败: ${e.message}，将跳过备份恢复。`, "warn");
    //     backup = null; // 确保为 null
    //   }
    // }
    // ------------------------------------

    // // 第四步: 擦除;
    // if (config.doErase) {
    //   log(`3. 正在执行芯片擦除...`);
    //   try {
    //     const eraseMode = await state.bootloader.massErase();
    //     log(`==> Flash 擦除完成 (模式: ${eraseMode}).`);
    //   } catch (error) {
    //     if (/NACK/.test(error.message) && config.doUnlock) {
    //       log(`⚠️ 检测到芯片写保护(读保护)，正在尝试暴力解除读保护...`, "warn");
    //       // 发送解除读保护，单片机会自我擦除，过程将持续 2-3 秒，并硬复位
    //       await state.bootloader.readoutUnprotect();
    //       log(`==> 保护已解除，芯片已自我重置。需重新建立握手接管。`);

    //       log(`[*] 再次进入 Bootloader 模式...`);
    //       await enterAndSyncBootloader();
    //       log(`[*] 二次握手同步成功！接管完成。`);
    //     } else {
    //       throw error; // 不是NACK问题，或是没开强制解锁，直接往外抛异常终止
    //     }
    //   }
    // } else {
    //   log(`3. (跳过擦除步骤)`);
    // }

    // 第四步: 擦除
    if (config.doErase) {
      log(`3. 正在执行芯片擦除...`);
      try {
        // ★ 部分擦除：调用之前实现的 erasePages
        await state.bootloader.erasePages(0, 28); // 擦除第0~27页，共28页（保留第30、31页）
        log(`==> Flash 擦除完成`);
      } catch (error) {
        if (/NACK/.test(error.message) && config.doUnlock) {
          log(`⚠️ 检测到芯片写保护(读保护)，正在尝试暴力解除读保护...`, "warn");
          await state.bootloader.readoutUnprotect();
          log(`==> 保护已解除，芯片已自我重置。需重新建立握手接管。`);

          log(`[*] 再次进入 Bootloader 模式...`);
          await enterAndSyncBootloader();
          log(`[*] 二次握手同步成功！接管完成。`);
        } else {
          throw error;
        }
      }
    } else {
      log(`3. (跳过擦除步骤)`);
    }
    // ---------- 第四步: 按页擦除 ----------
    // if (config.doErase) {
    //   log(`3. 正在擦除页面 0 ~ 27 (保留第30、31页)...`);
    //   try {
    //     // 擦除第0~27页，共28页（可根据需求调整）
    //     await state.bootloader.erasePages2(0, 28);
    //     log(`==> 页面 0~27 擦除完成。`);
    //   } catch (error) {
    //     // 如果收到 NACK 且开启了自动解锁，尝试解除读保护
    //     if (/NACK/.test(error.message) && config.doUnlock) {
    //       log(`⚠️ 检测到芯片写保护(读保护)，正在尝试暴力解除读保护...`, "warn");
    //       // 解除读保护（会触发全片擦除并复位芯片）
    //       await state.bootloader.readoutUnprotect();
    //       log(`==> 保护已解除，芯片已自我重置。需重新建立握手接管。`);

    //       log(`[*] 再次进入 Bootloader 模式...`);
    //       await enterAndSyncBootloader();
    //       log(`[*] 二次握手同步成功！接管完成。`);

    //       // 解锁后重试擦除（此时芯片已全片擦除，但依然按页擦除确保一致性）
    //       log(`[*] 重新执行页擦除...`);
    //       await state.bootloader.erasePages2(0, 28);
    //       log(`==> 页面 0~27 擦除完成。`);
    //     } else {
    //       // 其他错误直接抛出
    //       throw error;
    //     }
    //   }
    // } else {
    //   log(`3. (跳过擦除步骤)`);
    // }
    setProgress(35);

    // 第五步: 分块写入固件 (耗时主力操作)
    log(
      `4. 正在往起始地址 ${toHex(config.flashBase, 8)} 烧写 ${state.firmwareName}...`,
    );
    await state.bootloader.writeMemory(
      config.flashBase,
      state.firmware,
      config.packetSize,
    );

    // // 4. 恢复备份（如果存在）
    // if (backup) {
    //   log(`恢复保留页...`);
    //   await state.bootloader.writeMemory(
    //     readAddress,
    //     backup,
    //     config.packetSize,
    //   );
    //   log(`==> 保留页恢复完成。`);

    //   // ---- 校验备份 ----
    //   if (config.doVerify) {
    //     // 复用“烧录后完整校验”选项，也可以单独加选项
    //     log(`校验保留页数据...`);
    //     const readBack = await state.bootloader.readMemory(
    //       readAddress,
    //       backup.length,
    //     );
    //     for (let i = 0; i < backup.length; i++) {
    //       if (readBack[i] !== backup[i]) {
    //         throw new Error(
    //           `保留页校验失败 at offset ${i}: expected ${toHex(backup[i])}, got ${toHex(readBack[i])}`,
    //         );
    //       }
    //     }
    //     log(`==> 保留页校验通过 ✅`);
    //   }
    // }

    log(`==> 烧写完成！`);
    setProgress(70);

    // 第六步: 校验文件
    if (config.doVerify) {
      log(`5. 正在读回数据并与原固件交叉比对校验...`);
      await state.bootloader.verify(
        config.flashBase,
        state.firmware,
        config.packetSize,
      );
      log(`==> 校验通过! 数据 100% 吻合。`);
    } else {
      log(`5. (跳过数据校验步骤)`);
    }

    setProgress(95);

    // 第七步: 复位运行
    if (config.doRun) {
      if (config.resetLogic === "ch340x") {
        log(`6. 正在按 CH340X 运行时序复位用户程序...`);
        await resetCh340xWebToRun(state.transport, delay);
        log(`==> 已发送硬件 RESET 脉冲，请观察板子是否正常运行。`);
      } else {
        log(`6. 正在跳转运行用户程序并释放 BOOT 条件...`);
        try {
          await goToAddress(
            state.bootloader,
            state.transport,
            config.flashBase,
          );
          await releaseBootForRunStage(
            state.transport,
            delay,
            selectedRunConfig,
          );
          log(
            `==> 已通过 Bootloader GO 跳转到 ${toHex(config.flashBase, 8)}，请观察板子是否正常运行。`,
          );
        } catch (error) {
          log(
            `⚠️ GO 跳转失败: ${error.message}，改用硬件 RESET 脉冲...`,
            "warn",
          );
          await resetToRunStage(
            state.transport,
            delay,
            selectedRunConfig,
            config.resetConfig,
          );
          log(`==> 已发送硬件 RESET 脉冲，请观察板子是否正常运行。`);
        }
      }
    } else {
      log(`6. (烧写完毕，程序停留在 Bootloader 等待手动复位)`);
    }
    setProgress(100);

    log(`==> 烧录任务完成。`, "info");
    shouldClosePortAfterRun = config.doClose;
    if (shouldClosePortAfterRun) {
      await closePortAfterRun();
    }
  } catch (e) {
    log(`❌ 烧写流程终止: ${e.message}`, "error");
    // 弹出警告框，提示用户操作步骤
    alert(
      `烧录失败：${e.message}\n\n` +
        `请按以下步骤操作：\n` +
        `1. 断电再上电\n` +
        `2. 上电6秒后连击四下\n` +
        `3. 第四下按住不放直到进入烧录(可查看日志输出)\n` +
        `4. 点击确定后再次烧录\n` +
        `**或者上电后，按住按键不放再点击自动编程**\n` +
        `*查看日志输出，确认烧录完成*`,
    );
  } finally {
    serialMonitor.setProgramming(false); // 【新增】编程结束：若监听仍开启则重新挂接
    autoTrigger.setPaused(false); // 恢复重新启用自动触发器
    els.fullProcessBtn.disabled = false;
    if (els.autoProgramBtn) els.autoProgramBtn.disabled = false; // ← 新增
    updateUi();
    isProgramming = false;
  }

  setProgress(0);
}

/**
 * 从服务器下载 Hex 固件并加载到页面
 */
async function fetchFirmwareFromServer() {
  try {
    const response = await fetch("./stoov-bed-firmware.hex");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    let filename = "stoov-bed-firmware.hex";
    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }
    const file = new File([arrayBuffer], filename, {
      type: "application/octet-stream",
    });
    const firmware = await loadFirmwareFile(file);

    state.firmware = firmware.bytes;
    state.firmwareName = file.name;
    if (firmware.baseAddress !== null) {
      els.flashBase.value = toHex(firmware.baseAddress, 8);
    }
    els.firmwareName.textContent = file.name;
    els.firmwareSize.textContent = `${firmware.format.toUpperCase()} / ${(state.firmware.length / 1024).toFixed(2)} KB`;

    // 使用国际化消息
    log(
      t("fetchSuccess")
        .replace("{filename}", file.name)
        .replace("{size}", state.firmware.length)
        .replace("{format}", firmware.format.toUpperCase()),
      "info",
    );

    updateUi();
  } catch (error) {
    log(t("fetchError").replace("{error}", error.message), "error");
  }
}

// ============== 绑定事件 ==============
els.languageToggle.addEventListener("click", () => {
  state.lang = state.lang === "zh" ? "en" : "zh";
  localStorage.setItem("lang", state.lang);
  applyLanguage();
});

els.targetProfile.addEventListener("change", updateUi);
els.selectPortBtn.addEventListener("click", requestPort);
els.disconnectBtn.addEventListener("click", disconnect);
els.fullProcessBtn.addEventListener("click", runAutoProgram);
els.clearLogBtn.addEventListener("click", () => (els.log.innerHTML = ""));
// ---- 获取固件 ----
els.fetchFirmwareBtn.addEventListener("click", fetchFirmwareFromServer);
els.autoProgramBtn.addEventListener("click", runAutoProgramWithOta);
els.doVerify.addEventListener("change", () => {
  localStorage.setItem("doVerify", String(els.doVerify.checked));
});
els.doClose.addEventListener("change", () => {
  localStorage.setItem("doClose", String(els.doClose.checked));
});

// 【新增】编程前串口监听开关
els.monitorSerial.addEventListener("change", () => {
  serialMonitor.setEnabled(els.monitorSerial.checked);
  localStorage.setItem("monitorSerial", String(els.monitorSerial.checked));
  if (els.monitorSerial.checked && state.connected) {
    log(t("monitorOn"), "monitor");
  }
});

// 【新增】监听批量阈值
els.monitorFlushSize.addEventListener("change", () => {
  serialMonitor.setFlushSize(els.monitorFlushSize.value);
  localStorage.setItem("monitorFlushSize", els.monitorFlushSize.value);
});

els.firmwareInput.addEventListener("change", async () => {
  const file = els.firmwareInput.files[0];
  if (!file) return;
  state.firmwareName = file.name;

  try {
    const firmware = await loadFirmwareFile(file);
    state.firmware = firmware.bytes;
    if (firmware.baseAddress !== null) {
      els.flashBase.value = toHex(firmware.baseAddress, 8);
    }
    els.firmwareName.textContent = file.name;
    els.firmwareSize.textContent = `${firmware.format.toUpperCase()} / ${(state.firmware.length / 1024).toFixed(2)} KB`;
    log(
      `📄 加载固件成功: ${file.name} (${state.firmware.length} bytes, 类型: ${firmware.format.toUpperCase()}).`,
    );
  } catch (e) {
    log(`读取固件错误: ${e.message}`, "error");
    state.firmware = null;
    els.firmwareName.textContent = t("chooseFirmware");
    els.firmwareSize.textContent = t("noFile");
  }
  updateUi();
});

// ==== 手动控制台快捷动作 ====
els.enterBootBtn.addEventListener("click", async () => {
  const config = options();
  const [stage] = browserBootloaderEntryStages(config);
  log(
    `手动指令：按配置 ${config.resetLogic} 拉线进入 Bootloader (${stage.name})...`,
  );
  await enterBootloaderStage(state.transport, delay, stage.config);
  log(`尝试完成，若电路正常芯片现已进入ISP等待。`);
});
els.resetRunBtn.addEventListener("click", async () => {
  const config = options();
  const [stage] = browserBootloaderEntryStages(config);
  log(`手动指令：复位并运行用户程序...`);
  if (config.resetLogic === "ch340x") {
    await resetCh340xWebToRun(state.transport, delay);
  } else {
    await resetToRunStage(
      state.transport,
      delay,
      stage.runConfig,
      config.resetConfig,
    );
  }
  log(`已发送复位放行信号。`);
});

function parseHex(input) {
  const clean = input
    .replace(/0x/gi, " ")
    .replace(/[^0-9a-fA-F]/g, " ")
    .trim();
  if (!clean) return [];
  return clean.split(/\s+/).map((part) => {
    const value = Number.parseInt(part, 16);
    if (!Number.isFinite(value) || value < 0 || value > 255)
      throw new Error(`Invalid byte: ${part}`);
    return value;
  });
}

els.sendHexBtn.addEventListener("click", async () => {
  const bytes = parseHex(els.hexInput.value);
  await state.transport.write(bytes);
  log(`TX ${bytes.map((byte) => toHex(byte)).join(" ")}`);
});
els.readByteBtn.addEventListener("click", async () => {
  const byte = (await state.transport.readExact(1, options().timeout))[0];
  log(`RX ${toHex(byte)}`);
});

// Raw DTR/RTS overrides: True is 0V (Low), False is 3.3V (High)
els.dtrLowBtn.addEventListener("click", async () => {
  log("DTR = 0V (True)");
  await state.transport.setSignals({ dataTerminalReady: true });
});
els.dtrHighBtn.addEventListener("click", async () => {
  log("DTR = 3.3V (False)");
  await state.transport.setSignals({ dataTerminalReady: false });
});
els.rtsLowBtn.addEventListener("click", async () => {
  log("RTS = 0V (True)");
  await state.transport.setSignals({ requestToSend: true });
});
els.rtsHighBtn.addEventListener("click", async () => {
  log("RTS = 3.3V (False)");
  await state.transport.setSignals({ requestToSend: false });
});

// Circuit dialog
els.circuitInfoBtn.addEventListener("click", () =>
  els.circuitDialog.showModal(),
);
els.circuitDialogClose.addEventListener("click", () =>
  els.circuitDialog.close(),
);
els.circuitDialog.addEventListener("click", (e) => {
  if (e.target === els.circuitDialog) els.circuitDialog.close();
});

els.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

window.addEventListener("beforeunload", () => {
  if (!state.connected) return;
  const transport = state.transport;
  cleanupSerial(); // 释放监听器、触发器与状态
  // 页面卸载时无法等待异步完成，尽力关闭底层串口
  transport?.close().catch(() => {});
});

if ("serial" in navigator) {
  navigator.serial.addEventListener("disconnect", (event) => {
    if (state.port && event.target === state.port) {
      handleSerialDisconnect();
    }
  });
} else {
  log(
    "当前浏览器环境不支持 Web Serial（请使用新版 Edge 或 Chrome，并且必须在 HTTPS 或 localhost 环境下打开）",
    "warn",
  );
}
applyTheme();
applySavedPreferences();
applyLanguage();
