import { loadMqttConfig as fetchMqttConfig } from "./config/runtime-config.js";
import "./pwa/install.js";

const bleLogContainer = document.getElementById("bleLogContainer");
const DEBUG_LOG = false; // 改为 true 可开启日志显示
// ========== BLE 日志函数 ==========
function bleAddLog(type, message) {
  if (!DEBUG_LOG) return;
  const emptyMsg = bleLogContainer.querySelector(".log-empty");
  if (emptyMsg) emptyMsg.remove();

  const now = new Date();
  const time =
    now.toLocaleTimeString("zh-CN", { hour12: false }) +
    "." +
    String(now.getMilliseconds()).padStart(3, "0");

  // === 判断是否需要换行处理：type 包含 'string' ===
  const isStringType = type.includes("str");

  let formattedMessage = message;
  if (isStringType) {
    // 字符串类型：处理换行和空格
    formattedMessage = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r\n/g, "<br>")
      .replace(/\n/g, "<br>")
      .replace(/ /g, "&nbsp;");

    // 提取实际类型（去掉 _str 后缀）
    type = type.replace(/(_str)/gi, "");
  }

  const entry = document.createElement("div");
  entry.className = "log-entry";
  const dataClass = type === "send" ? "send-data" : "";
  entry.innerHTML = `
                <span class="log-time">${time}</span>
                <span class="log-type ${type}">${type}</span>
                <span class="log-data ${dataClass}">${formattedMessage}</span>
            `;

  bleLogContainer.appendChild(entry);
  bleLogContainer.scrollTop = bleLogContainer.scrollHeight;

  const entries = bleLogContainer.querySelectorAll(".log-entry");
  if (entries.length > 200) entries[0].remove();
}

function clearBleLogs() {
  bleLogContainer.innerHTML = '<div class="log-empty">日志已清除</div>';
}

// ========== MQTT 配置与自动连接 ==========
let MQTT_URL = "";
let MQTT_OPTIONS = {
  username: "",
  password: "",
  clientId: "heating-bed-web-" + Math.random().toString(16).substring(2, 10),
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
};

let mqttClient = null;
let isMqttConnected = false;

function mqttConnect() {
  try {
    bleAddLog("info", "MQTT 自动连接中...");
    mqttClient = mqtt.connect(MQTT_URL, MQTT_OPTIONS);
    mqttClient.on("connect", () => {
      isMqttConnected = true;
      bleAddLog("info", "MQTT 连接成功 ✓");
    });
    mqttClient.on("error", (error) =>
      bleAddLog("error", `MQTT 错误: ${error.message}`),
    );
    mqttClient.on("close", () => {
      if (isMqttConnected) bleAddLog("info", "MQTT 连接已断开");
      isMqttConnected = false;
    });
    mqttClient.on("reconnect", () => bleAddLog("info", "MQTT 正在重连..."));
    mqttClient.on("offline", () => bleAddLog("info", "MQTT 离线"));
  } catch (error) {
    bleAddLog("error", `MQTT 连接异常: ${error.message}`);
  }
}

async function loadMqttAndConnect() {
  try {
    const config = await fetchMqttConfig();
    MQTT_URL = config.url;
    MQTT_OPTIONS = {
      ...MQTT_OPTIONS,
      username: config.username,
      password: config.password,
      reconnectPeriod: config.reconnectPeriod ?? MQTT_OPTIONS.reconnectPeriod,
      connectTimeout: config.connectTimeout ?? MQTT_OPTIONS.connectTimeout,
    };
    mqttConnect();
  } catch (error) {
    bleAddLog("error", `MQTT 配置获取失败: ${error.message}`);
  }
}

loadMqttAndConnect();

// ========== MQTT 发送温度数据 ==========
function mqttPublishTemp(bodyTemp, footTemp) {
  if (!isMqttConnected || !mqttClient) {
    bleAddLog("[错误]", "MQTT 未连接，无法发送温度");
    return false;
  }

  const topic = "unito/heating-bed/ctrl-temp";
  const payload = JSON.stringify({
    body: bodyTemp,
    feet: footTemp,
  });

  mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
    if (error) {
      bleAddLog("[MQTT]", `发送失败 ✗ ${error.message}`);
    }
  });

  bleAddLog("[MQTT]", `发送温度 -> Topic: ${topic}, Payload: ${payload}`);
  return true;
}

const SERIAL_OPTIONS = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
};
const POWER_ON_HEX = "001001010B020102DEFF";
const POWER_OFF_HEX = "001001010B020101DFFF";
const SETTINGS_BASE = "001001050C03";

// WebSocket配置
const WS_URL = "wss://red.unito.top/wss/heating/vstool-bed";
let ws = null;
let wsReconnectInterval = null;

// --- 1. 将 parser 和 assembler 定义为全局变量 ---
let globalParser = null;
let globalAssembler = null;
let isReading = false; // 添加一个标志位
let currentPort = null;

let port = null,
  isConnected = false,
  isSerialConnected = false;
let writeQueue = [],
  writing = false;
let buffer = [];

let isPlaying = false;
let isStopPlayback = false; // 停止标志
let currentSecond = 0;
let animationTimer = null;
let totalDuration = 28800;
//最后保存的温度
let bodyLastTemp = 0;
let footLastTemp = 0;
let bodyRawTemp = 0;
let footRawTemp = 0;
let reader = null;
let devId = null;
let devVer = null;
let heatingRunTime = 0; //加热运行时间
let totalRunTime = 0; //总运行时间
// ============================================
// 当前状态（模拟从设备获取的数据）
// ============================================
let sysState = 0; // payload[16]
let bodyRunState = 0; // payload[17]
let footRunState = 0; // payload[18]

// 状态变量
let sysInfoRequestCount = 0; // 是否正在请求系统信息
let isSysInfoReceived = false; // 是否已收到系统信息
const MAX_RETRY = 4; // 最大重试秒4s
let sysInfoTimer = null; // 定时器句柄
const MAX_DATA_POINTS = 200;
const TARGET_ADDR = 0x02;
const SENDER_ADDR = 0x08;

const serialStatusText = document.getElementById("serialStatusText");
const serialStatusDot = document.getElementById("serialStatusDot");
const connectSerialBtn = document.getElementById("connectSerialBtn");
// const serialWarning = document.getElementById('serialWarning');
const playBtn = document.getElementById("playBtn");
const playIcon = document.getElementById("playIcon");
const playText = document.getElementById("playText");
const resetBtn = document.getElementById("resetBtn");
const currentTimeDisplay = document.getElementById("currentTimeDisplay");
const progressFill = document.getElementById("progressFill");
const bodyTempEl = document.getElementById("bodyTemp");
const footTempEl = document.getElementById("footTemp");
const bodyTargetTempEl = document.getElementById("bodyTargetTemp");
const footTargetTempEl = document.getElementById("footTargetTemp");
const bodyRawSetTempEl = document.getElementById("bodyRawSetTemp");
const footRawSetTempEl = document.getElementById("footRawSetTemp");
const timerIntervalInput = document.getElementById("timerIntervalInput");
const startTimerBtn = document.getElementById("startTimerBtn");

document.addEventListener("DOMContentLoaded", () => {
  initDefaultPoints();
  bindEvents();
  updateHardwareUptime(0);
  updateCurrentDisplay(0, 0, 24.0, 24.0);
  renderTestPanel();
});

function initDefaultPoints() {
  // ✅ 将默认目标温度显示到页面（元素可能已被移除）
  if (bodyTargetTempEl) bodyTargetTempEl.textContent = "--";
  if (footTargetTempEl) footTargetTempEl.textContent = "--";
  if (bodyRawSetTempEl) bodyRawSetTempEl.textContent = "--";
  if (footRawSetTempEl) footRawSetTempEl.textContent = "--";
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("您的浏览器不支持 Web Serial API");
    return;
  }
  if (isReading) {
    // 如果已经在读取，则不允许重复连接
    bleAddLog("串口", "已在读取数据，无法重复连接。请先断开现有连接。");
    return;
  }

  try {
    port = await navigator.serial.requestPort();
    await port.open(SERIAL_OPTIONS);
    currentPort = port;
    isSerialConnected = true;
    isConnected = true;
    serialStatusText.textContent = "已连接";
    serialStatusText.classList.add("connected");
    serialStatusDot.classList.add("connected");
    // --- 确保只在此处初始化一次 ---
    if (!globalParser) {
      // 检查是否已经初始化过
      globalParser = new SerialDataParser();
      // console.log("Parser 初始化"); // 调试日志
    }
    if (!globalAssembler) {
      globalAssembler = new SerialDataAssembler();
      // console.log("Assembler 初始化"); // 调试日志
    }
    bleAddLog("串口", "串口已连接");
    isReading = true; // 设置标志位
    updateHeatingButtonStates();
    // 仅在"测试加热"模式下获取器件ID
    const rocker = document.getElementById("rockerToggle");
    if (rocker && rocker.checked) {
      startGetSystemInfoRequest(); // 获取器件ID&Ver
    }
    await readSerialData(port); // 注意：这里用了 await
  } catch (error) {
    console.error("串口连接失败:", error.message, error);
    serialStatusText.textContent = "连接失败";
    bleAddLog("串口", `连接失败: ${error.message}`);
  }
}
// 在 disconnectFromPort 中也要重置标志位
async function disconnectFromPort() {
  if (reader) {
    await reader.cancel(); // 这会导致 readSerialData 中的 while 循环退出
    reader = null;
  }
  // ... 关闭 writer 和 port ...
  if (currentPort) {
    await currentPort.close();
    currentPort = null;
    document.getElementById("status").textContent = "已断开";
    bleAddLog("串口", "串口已断开");
    // isReading 会在 readSerialData 的 finally 中被重置，但也可以在这里提前重置
    isReading = false;
    isConnected = false;
    serialStatusText.textContent = "未连接";
    updateHeatingButtonStates();
    //   updateControlStates();
  }
}
// 判断是否是可打印字符串
function isPrintableString(data) {
  if (data.length === 0) return false;

  let printableCount = 0;
  for (const byte of data) {
    // 32-126 是可打印 ASCII，9是Tab，10是换行，13是回车
    if (
      (byte >= 32 && byte <= 126) ||
      byte === 9 ||
      byte === 10 ||
      byte === 13
    ) {
      printableCount++;
    }
  }
  // 超过80%可打印字符就认为是文本
  return printableCount / data.length >= 0.8;
}
// --- 3. 修改 readSerialData 函数，使用全局 parser 和 assembler ---
async function readSerialData(port) {
  if (!port || !port.readable) {
    bleAddLog("串口", "端口未打开");
    isReading = false; // 确保出错时也重置
    return;
  }
  reader = port.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        bleAddLog("串口", "串口读取器已关闭");
        break;
      }

      if (value && value.length > 0) {
        const isText = isPrintableString(value);
        if (isText) {
          // 字符串：直接显示
          const str = new TextDecoder().decode(value);
          bleAddLog("recv_str", str);
        } else {
          // --- 现在可以使用全局变量 globalParser ---
          const packets = globalParser.parseReceivedData(value);

          for (const packet of packets) {
            // --- 使用全局变量 globalParser 解析单个包 ---
            const parsedMessage = globalParser.parseMessage(packet);
            if (parsedMessage) {
              // --- 调用处理函数 ---
              handleMessage(parsedMessage);
            }
          }
        }
      }
    }
  } catch (error) {
    bleAddLog("串口", "读取数据出错:" + error.message);
    isSerialConnected = false;
    isConnected = false;
    serialStatusText.textContent = "未连接";
    serialStatusText.classList.remove("status-connected");
    serialStatusDot.classList.remove("status-connected");
    //   updateControlStates(); // 如果有此函数则取消注释
  } finally {
    try {
      reader.releaseLock();
      reader = null;
      isReading = false; // 读取结束时重置标志位
      currentPort = null; // 断开连接时也应重置
    } catch (e) {}
  }
}

function updateHardwareUptimeDisplay(seconds) {
  const h = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  document.getElementById("hardwareUptimeDisplay").textContent =
    `${h}:${m}:${s}`;
}

// ============================================
// 状态枚举
// ============================================
const HeaterMode = {
  OFF: 0, // 加热关闭
  RUNNING: 1, // 正在加热
  TEMP_SUSPENDED: 2, // 温度暂停加热
  TIM_SUSPENDED: 3, // 时间原因暂停加热
};

const SysState = {
  NON: 0,
  OFF: 1,
  ON: 2,
  ERROR: 3,
};

const modeNames = {
  [HeaterMode.OFF]: "已关闭",
  [HeaterMode.RUNNING]: "加热中",
  [HeaterMode.TEMP_SUSPENDED]: "加热暂停",
  [HeaterMode.TIM_SUSPENDED]: "时间暂停",
};

const sysStateNames = {
  [SysState.NON]: "未知",
  [SysState.OFF]: "已关闭",
  [SysState.ON]: "运行中",
  [SysState.ERROR]: "错误",
};

// 将C语言枚举映射为JS对象
const HEATER_ERROR_CODES = {
  0x00: "工作正常",
  0x02: "所有热敏电阻故障超过2分钟",
  0x03: "加热元件短路",
  0x04: "加热元件15分钟无功率",
  0xff: "未知错误代码",
};

// ========== 测试数据结构 ==========
const TEST_DEFS = {
  external: [
    { id: "ext-onoff", label: "ON/OFF 功能", result: "wait" },
    { id: "ext-time", label: "时间设置功能", result: "wait" },
    { id: "ext-body", label: "身体温度设置功能", result: "wait" },
    { id: "ext-foot", label: "脚温度设置功能", result: "wait" },
    { id: "ext-serial", label: "串口通信功能", result: "wait" },
  ],
  internal: [
    { id: "int-devid", label: "检测设备ID", result: "wait", actual: "" },
    { id: "int-fault", label: "故障代码", result: "wait", actual: "" },
    { id: "int-bsensor", label: "身体温度传感器", result: "wait", actual: "" },
    { id: "int-fsensor", label: "脚温度传感器", result: "wait", actual: "" },
    {
      id: "int-bsettemp",
      label: "身体设置温度(0或25~36°C)",
      result: "wait",
      actual: "",
    },
    {
      id: "int-fsettemp",
      label: "脚设置温度(0或25~40°C)",
      result: "wait",
      actual: "",
    },
    {
      id: "int-runstate",
      label: "运行状态(开+关)",
      result: "wait",
      actual: "",
    },
    {
      id: "int-runtime",
      label: "设置运行时间(1~12h)",
      result: "wait",
      actual: "",
    },
    { id: "int-boffcurr", label: "身体关电流", result: "wait", actual: "" },
    { id: "int-boncurr", label: "身体加热电流", result: "wait", actual: "" },
    { id: "int-foffcurr", label: "脚关电流", result: "wait", actual: "" },
    { id: "int-foncurr", label: "脚加热电流", result: "wait", actual: "" },
  ],
};
// 外部模式(测试遥控)追踪状态
let extTest = {
  onoffOk: false,
  lastPower: null,
  timeOk: false,
  bodyOk: false,
  footOk: false,
  bodyHas0: false,
  bodyHas36: false,
  footHas0: false,
  footHas40: false,
  serialResponse: false,
};
// 内部模式(测试加热)追踪状态
let intTest = {
  devIdOk: false,
  faultOk: false,
  bodySensorOk: false,
  footSensorOk: false,
  bodySetTempOk: false,
  footSetTempOk: false,
  runStateSeenOn: false,
  runStateSeenOff: false,
  runTimeOk: false,
  bodyOffCurrOk: false,
  bodyOnCurrOk: false,
  footOffCurrOk: false,
  footOnCurrOk: false,
  bodySensorOkCnt: 0,
  footSensorOkCnt: 0,
  bodyOffCurrOkCnt: 0,
  bodyOnCurrOkCnt: 0,
  footOffCurrOkCnt: 0,
  footOnCurrOkCnt: 0,
};
let testActive = false;
let currentTestMode = "external";

// 辅助函数：获取消息类型名称
function getMsgTypeName(msgId) {
  const names = {
    [MSGTYPE.WORK]: "工作设置",
    [MSGTYPE.ERROR]: "错误上报",
    [MSGTYPE.END]: "结束",
    [MSGTYPE.CTRL_WORK]: "远程控制工作",
    [MSGTYPE.TH]: "阈值设置",
    [MSGTYPE.PERIODIC_TEMP]: "温度周期",
    [MSGTYPE.UNITO_MSGTYPE_SYSID]: "设备ID",
    [MSGTYPE.UNITO_SET_TEMP01C]: "设置温度",
    [MSGTYPE.UNITO_SET_TIME]: "设置时间",
    [MSGTYPE.UNITO_SET_REBOOT]: "重启设备",
    [MSGTYPE.UNITO_SET_CLEAR_FAULT]: "清除故障",
    [MSGTYPE.UNITO_MSGTYPE_SIM_TEMP]: "模拟温度",
  };
  return names[msgId] || `UNKNOWN(0x${msgId.toString(16).toUpperCase()})`;
}
// 辅助函数：获取操作类型名称
function getOpTypeName(opType) {
  const names = {
    [MSGOP.GET]: "GET",
    [MSGOP.SET]: "SET",
    [MSGOP.CLEAR]: "CLEAR",
    [MSGOP.RESPONSE]: "RESPONSE",
    [MSGOP.REPORT]: "REPORT",
  };
  return names[opType] || `UNKNOWN(${opType})`;
}
/**
 * 根据错误代码更新故障显示UI，并记录日志
 * @param {number} errorCode - 接收到的错误代码 (Byte 0)
 */
function handleErrorCode(errorCode) {
  const errorDesc = HEATER_ERROR_CODES[errorCode] || "未知错误";
  const faultDisplay = document.getElementById("faultStatusDisplay");
  if (!faultDisplay) {
    // bleAddLog('[错误]', `故障代码 0x${errorCode.toString(16).toUpperCase()}: ${errorDesc}`);
    return;
  }

  if (errorCode === 0x00) {
    // 正常状态
    faultDisplay.innerText = "当前状态: 工作正常";
    faultDisplay.style.color = "green";
  } else {
    // 故障状态
    faultDisplay.innerText = `ERROR | ${errorDesc} (代码: 0x${errorCode.toString(16).toUpperCase()})`;
    faultDisplay.style.color = "red";
  }
}
// 辅助函数：将 msg 对象（包含协议各字段）格式化为日志字符串
function formatMsgToLog(msg) {
  // 使用已有的字段重新组装 HEX 字符串
  const bytes = [];

  // 帧头
  bytes.push(0x00);

  // 目标地址和源地址
  bytes.push(msg.targetAddr);
  bytes.push(msg.senderAddr);

  // msgId (小端序: 先低字节后高字节)
  bytes.push(msg.msgId & 0xff);
  bytes.push((msg.msgId >> 8) & 0xff);

  // msgOp
  bytes.push(msg.msgOp);

  // payload 长度
  bytes.push(msg.payload.length);

  // payload 数据
  bytes.push(...msg.payload);

  // 校验和
  bytes.push(msg.checksum);

  // 结束字节
  bytes.push(msg.endByte);

  // 转换为十六进制字符串
  const hexStr = bytes
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");

  return hexStr;
}
// --- 处理消息函数 ---
function handleMessage(msg) {
  const payload = msg.payload;
  const msgTypeName = getMsgTypeName(msg.msgId);

  switch (msg.msgId) {
    case MSGTYPE.PERIODIC_TEMP:
      if (msg.msgOp === MSGOP.REPORT) {
        // 温度上报：payload = [bodyTemp小数, bodyTemp整数, footTemp小数, footTemp整数]
        tempMsgHandle(payload);
      } else if (msg.msgOp === MSGOP.RESPONSE) {
        msg_ack_report(msgTypeName, payload);
      }
      break;

    case MSGTYPE.WORK:
      if (msg.msgOp === MSGOP.SET) {
        // 解析 WORK SET 数据并更新加热面板组件
        // 数据格式: payload[0]=身体温度, payload[1]=脚部温度, payload[2]=运行时间, payload[3]=开关状态
        if (payload.length === 4) {
          const hp = document.getElementById("heatingPanel");
          if (hp) {
            // 身体温度: 0xFF 表示 0 度
            if (hp.bodyTemp === undefined) hp.bodyTemp = 0;
            const bodyTemp = payload[0] !== 0xff ? payload[0] : hp.bodyTemp;
            // 脚部温度
            if (hp.feetTemp === undefined) hp.feetTemp = 0;
            const footTemp = payload[1] !== 0xff ? payload[1] : hp.feetTemp;
            // 运行时间: <=12 有效，否则身体温度设为 0
            const hours = payload[2] <= 12 ? payload[2] : 1;
            // 开关状态: 0x01=OFF, 0x02=ON
            const powerOn = payload[3] === 0x02;

            // 更新加热面板组件显示
            hp.power = powerOn;
            hp.hours = hours;
            hp.bodyTemp = bodyTemp;
            hp.feetTemp = footTemp;

            bleAddLog(
              "info",
              `加热面板更新 - 身体:${bodyTemp}°C 脚部:${footTemp}°C 时间:${hours}h 电源:${powerOn ? "ON" : "OFF"}`,
            );
          }
        }
        updateExtTest(payload); // 执行测试的遥控功能判断
        msg_ack_report(msgTypeName, payload);
      }
      break;
    case MSGTYPE.CTRL_WORK:
      if (msg.msgOp === MSGOP.RESPONSE) {
        if (payload.length === 2) {
          tempMsgHandle(payload);
        } else if (payload.length === 1) {
          msg_ack_report(msgTypeName, payload);
        }
      }
      break;

    case MSGTYPE.UNITO_MSGTYPE_SYSID:
      if (msg.msgOp === MSGOP.RESPONSE) {
        onSystemInfoReceived(payload, payload.length);
        // bleAddLog(
        // "[RECV <<<]",
        // `${msgTypeName} - RESPONSE | 设备信息已更新`,
        // );
      } else if (msg.msgOp === MSGOP.REPORT) {
        if (payload.length >= 14) {
          onSystemInfoReceived(payload, payload.length);
          // resetPlayback();
        }
      }
      break;

    case MSGTYPE.ERROR:
      if (msg.msgOp === MSGOP.REPORT) {
        // --- 新增：构建完整的 HEX 字符串日志 ---
        bleAddLog("[RECV <<<]", `错误数据包: ${formatMsgToLog(msg)}`);
        // --- 新增结束 ---
        const errorCode = payload[0]; // 获取错误代码
        handleErrorCode(errorCode); // 更新UI显示并记录日志
        constructPacket(MSGTYPE.ERROR, MSGOP.RESPONSE, [0x06]); // 发送ACK响应
      } else if (msg.msgOp === MSGOP.RESPONSE) {
        bleAddLog("[RECV <<<]", `错误数据应答包: ${formatMsgToLog(msg)}`);
        if (!testActive || currentTestMode !== "external") break; // 在测试模式下
        const defs = TEST_DEFS.external;
        extTest.serialResponse = true;
        defs.find((d) => d.id === "ext-serial").result = "ok";
        renderTestPanel();
      }
      break;

    case MSGTYPE.TH:
    case MSGTYPE.UNITO_SET_TEMP01C:
    case MSGTYPE.UNITO_SET_TIME:
    case MSGTYPE.UNITO_SET_REBOOT:
    case MSGTYPE.UNITO_SET_CLEAR_FAULT:
    case MSGTYPE.UNITO_MSGTYPE_SIM_TEMP:
      if (msg.msgOp === MSGOP.RESPONSE) {
        msg_ack_report(msgTypeName, payload);
      }
      break;

    default:
      bleAddLog(
        "[RECV <<<]",
        `[UNKNOWN] - MSGID: 0x${msg.msgId.toString(16).toUpperCase()} | Payload: [${payload.join(", ")}]`,
      );
  }
}
// ACK响应处理
// ACK响应处理 - 增加消息类型名称参数
function msg_ack_report(msgTypeName, payload) {
  if (payload && payload.length === 1) {
    const timestamp = new Date().toLocaleTimeString();
    if (payload[0] === 0x06) {
      bleAddLog(`[RECV <<<]`, `${msgTypeName} - ACK | ✓ 操作成功`);
    } else {
      bleAddLog(
        `[RECV <<<]`,
        `${msgTypeName} - ACK | ✗ 操作失败(错误码: ${payload[0]})`,
      );
    }
  } else if (payload && payload.length > 1) {
    const hexStr = payload
      .map((b) => "0x" + b.toString(16).toUpperCase().padStart(2, "0"))
      .join(", ");
    bleAddLog(`[RECV <<<]`, `${msgTypeName} - RESPONSE | Payload: [${hexStr}]`);
  }
}

/**
 * 更新硬件运行时间显示
 * @param {number} uptimeSeconds - 运行时间（秒）
 */
function updateHardwareUptime(uptimeSeconds) {
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  // 格式化为 HH:MM:SS
  const formattedTime =
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0");

  // 更新显示
  const displayElement = document.getElementById("hardwareSetUptimeDisplay");
  if (displayElement) {
    displayElement.textContent = formattedTime;
  }
}

// 更新硬件运行状态显示
function tempMsgHandle(payload) {
  if (isSysInfoReceived) {
    sysInfoRequestCount = 0; // 收到温度数据，重置系统信息请求计数
  }
  // 处理短包（2字节）- 只包含温度数据
  if (payload.length === 2) {
    try {
      const bodyTemp = parseFloat(payload[0]);
      const footTemp = parseFloat(payload[1]);
      updateTemperatureMsg({
        bodyTemp,
        footTemp,
        bodyTempRaw: { decimal: payload[0], integer: payload[0] },
        footTempRaw: { decimal: payload[1], integer: payload[1] },
      });
    } catch (error) {
      bleAddLog("[错误]", `解析短包温度消息时出错: ${error.message}`);
    }
    return; // 短包处理完毕，直接返回
  }

  // 处理长包（至少12字节）- 包含完整信息
  if (payload.length >= 12) {
    try {
      // 检查必要的最小长度以避免访问越界
      const bodyTemp =
        payload.length >= 2
          ? parseFloat((payload[1] + payload[0] / 10).toFixed(1))
          : 0.0;
      const footTemp =
        payload.length >= 4
          ? parseFloat((payload[3] + payload[2] / 10).toFixed(1))
          : 0.0;

      // 更新温度显示
      updateTemperatureMsg({
        bodyTemp,
        footTemp,
        bodyTempRaw: {
          decimal: payload.length >= 1 ? payload[0] : 0,
          integer: payload.length >= 2 ? payload[1] : 0,
        },
        footTempRaw: {
          decimal: payload.length >= 3 ? payload[2] : 0,
          integer: payload.length >= 4 ? payload[3] : 0,
        },
      });

      // 目标原始温度 4-7
      const bodyRawTemp =
        payload.length >= 6
          ? parseFloat((payload[5] + payload[4] / 10).toFixed(1))
          : 0.0;
      const footRawTemp =
        payload.length >= 8
          ? parseFloat((payload[7] + payload[6] / 10).toFixed(1))
          : 0.0;

      if (typeof bodyRawSetTempEl !== "undefined" && bodyRawSetTempEl) {
        bodyRawSetTempEl.textContent = bodyRawTemp === 0 ? "OFF" : bodyRawTemp; // 更新原始设定温度
      }
      if (typeof footRawSetTempEl !== "undefined" && footRawSetTempEl) {
        footRawSetTempEl.textContent = footRawTemp === 0 ? "OFF" : footRawTemp;
      }

      // 目标温度 8-11
      const bodyTargetTemp =
        payload.length >= 10
          ? parseFloat((payload[9] + payload[8] / 10).toFixed(1))
          : 0.0;
      const footTargetTemp =
        payload.length >= 12
          ? parseFloat((payload[11] + payload[10] / 10).toFixed(1))
          : 0.0;

      if (typeof bodyTargetTempEl !== "undefined" && bodyTargetTempEl) {
        bodyTargetTempEl.textContent = bodyTargetTemp; // 更新目标温度
      }
      if (typeof footTargetTempEl !== "undefined" && footTargetTempEl) {
        footTargetTempEl.textContent = footTargetTemp;
      }

      // 当前运行时间 12-13 (uint16, LE: data[0]=temp&0xFF, data[1]=temp>>8)
      if (payload.length >= 14) {
        heatingRunTime = (parseInt(payload[13]) << 8) | parseInt(payload[12]);
      } else {
        heatingRunTime = 0;
      }

      // 设置加热时间总时间 14-15 (uint16)
      if (payload.length >= 16) {
        totalRunTime = (parseInt(payload[15]) << 8) | parseInt(payload[14]);
      } else {
        totalRunTime = 0;
      }
      totalDuration = totalRunTime;
      currentSecond = heatingRunTime;

      if (typeof updateHardwareUptime !== "undefined") {
        updateHardwareUptime(totalRunTime);
      }
      if (typeof updatePlaybackDisplay !== "undefined") {
        updatePlaybackDisplay();
      }

      // 硬件运行时间 16-17 (uint16)
      let hardwareRunTime = 0;
      if (payload.length >= 18) {
        hardwareRunTime = (parseInt(payload[17]) << 8) | parseInt(payload[16]);
      }
      if (typeof updateHardwareUptimeDisplay !== "undefined") {
        updateHardwareUptimeDisplay(hardwareRunTime);
      }

      // 状态信息 18-20
      sysState = payload.length >= 19 ? payload[18] : 0;
      bodyRunState = payload.length >= 20 ? payload[19] : 0;
      footRunState = payload.length >= 21 ? payload[20] : 0;

      if (typeof updateStatusDisplay !== "undefined") {
        updateStatusDisplay("heatingStatusDisplay", sysState, true);
        updateStatusDisplay("bodyStatusDisplay", bodyRunState, false);
        updateStatusDisplay("footStatusDisplay", footRunState, false);
      }

      // 电流数据 21-24
      let bodyCurrent = 0.0,
        footCurrent = 0.0;
      let bodyVoltage = 24.0,
        footVoltage = 24.0;

      if (payload.length >= 23) {
        bodyCurrent = (parseInt(payload[22]) << 8) | parseInt(payload[21]);
        bodyVoltage = bodyCurrent;
        bodyCurrent = adcToCurrent(bodyCurrent) / 1000;
        if (bodyCurrent < 0.1) bodyCurrent = 0;
      }
      if (payload.length >= 25) {
        footCurrent = (parseInt(payload[24]) << 8) | parseInt(payload[23]);
        footVoltage = footCurrent;
        footCurrent = adcToCurrent(footCurrent) / 1000;
        if (footCurrent < 0.1) footCurrent = 0;
      }

      // Body 升温时间 25-26 (uint16)
      let bodyOpenTimerCnt = 0;
      if (payload.length >= 27) {
        bodyOpenTimerCnt = (parseInt(payload[26]) << 8) | parseInt(payload[25]);
        const el = document.getElementById("bodyOpenTimerCnt");
        if (el) el.textContent = bodyOpenTimerCnt;
      }

      // Body 降温时间 27-28 (uint16)
      let bodyCloseTimerCnt = 0;
      if (payload.length >= 29) {
        bodyCloseTimerCnt =
          (parseInt(payload[28]) << 8) | parseInt(payload[27]);
        const el = document.getElementById("bodyCloseTimerCnt");
        if (el) el.textContent = bodyCloseTimerCnt;
      }

      // Foot 升温时间 29-30 (uint16)
      let footOpenTimerCnt = 0;
      if (payload.length >= 31) {
        footOpenTimerCnt = (parseInt(payload[30]) << 8) | parseInt(payload[29]);
        const el = document.getElementById("footOpenTimerCnt");
        if (el) el.textContent = footOpenTimerCnt;
      }

      // Foot 降温时间 31-32 (uint16)
      let footCloseTimerCnt = 0;
      if (payload.length >= 33) {
        footCloseTimerCnt =
          (parseInt(payload[32]) << 8) | parseInt(payload[31]);
        const el = document.getElementById("footCloseTimerCnt");
        if (el) el.textContent = footCloseTimerCnt;
      }

      // 身体升温剩余时间 33-34 (uint16)
      let bodyHeatUpTimerCnt = 0;
      if (payload.length >= 35) {
        bodyHeatUpTimerCnt =
          (parseInt(payload[34]) << 8) | parseInt(payload[33]);
        const el = document.getElementById("bodyHeatUpTimeSec");
        if (el) el.textContent = bodyHeatUpTimerCnt;
      }

      // 脚部升温剩余时间 35-36 (uint16)
      let footHeatUpTimerCnt = 0;
      if (payload.length >= 37) {
        footHeatUpTimerCnt =
          (parseInt(payload[36]) << 8) | parseInt(payload[35]);
        const el = document.getElementById("footHeatUpTimeSec");
        if (el) el.textContent = footHeatUpTimerCnt;
      }

      // 阀值温度 37-38
      if (payload.length >= 38) {
        const bodyThresholdTemp = (parseInt(payload[37]) / 10).toFixed(1);
        const btEl = document.getElementById("bodyThresholdTemp");
        if (btEl) btEl.textContent = bodyThresholdTemp;
      }
      if (payload.length >= 39) {
        const footThresholdTemp = (parseInt(payload[38]) / 10).toFixed(1);
        const ftEl = document.getElementById("footThresholdTemp");
        if (ftEl) ftEl.textContent = footThresholdTemp;
      }

      updateCurrentDisplay(bodyCurrent, footCurrent, bodyVoltage, footVoltage);
      // 内部测试模式：更新传感器/电流/设置温度数据
      const bodyInt = payload.length >= 2 ? payload[1] : 0;
      const footInt = payload.length >= 4 ? payload[3] : 0;
      let bodySensorText, footSensorText;
      if (bodyInt === 225) bodySensorText = "传感器短路";
      else if (bodyInt === 226) bodySensorText = "传感器开路";
      else bodySensorText = bodyTemp.toFixed(1) + "°C";
      if (footInt === 225) footSensorText = "传感器短路";
      else if (footInt === 226) footSensorText = "传感器开路";
      else footSensorText = footTemp.toFixed(1) + "°C";
      updateIntTest("bodySensor", bodySensorText);
      updateIntTest("footSensor", footSensorText);
      // 身体设置温度范围检测
      updateIntTest("bodySetTemp", bodyRawTemp);
      // 脚设置温度范围检测
      updateIntTest("footSetTemp", footRawTemp);
      // 运行状态：同时记录开关状态
      updateIntTest("runState", sysState);
      // 设置运行时间范围检测
      const devHours = Math.round(totalRunTime / 3600);
      updateIntTest("runTime", devHours);
      // 身体电流检测（使用原始ADC值 bodyVoltage/footVoltage）
      updateIntTest("bodyCurrCheck", { raw: bodyVoltage, state: bodyRunState });
      updateIntTest("footCurrCheck", { raw: footVoltage, state: footRunState });
      updateHeatingButtonStates();

      // 故障代码
      if (payload.length >= 40) {
        updateIntTest("faultCode", payload[39]);
        handleErrorCode(payload[39]);
      }

      // 身体总输出功率 heating_pw_s 40-41 (uint16)
      let bodyHeatingPwS = 0;
      if (payload.length >= 42) {
        bodyHeatingPwS = (parseInt(payload[41]) << 8) | parseInt(payload[40]);
        const el = document.getElementById("bodyHeatingPwS");
        if (el) el.textContent = bodyHeatingPwS;
      }

      // 脚部总输出功率 heating_pw_s 42-43 (uint16)
      let footHeatingPwS = 0;
      if (payload.length >= 44) {
        footHeatingPwS = (parseInt(payload[43]) << 8) | parseInt(payload[42]);
        const el = document.getElementById("footHeatingPwS");
        if (el) el.textContent = footHeatingPwS;
      }

      // 身体最大加热时间 max_heat_time_s 44-45 (uint16)
      let bodyMaxHeatTimeS = 0;
      if (payload.length >= 46) {
        bodyMaxHeatTimeS = (parseInt(payload[45]) << 8) | parseInt(payload[44]);
        const el = document.getElementById("bodyMaxHeatTimeS");
        if (el) el.textContent = bodyMaxHeatTimeS;
      }

      // 脚部最大加热时间 max_heat_time_s 46-47 (uint16)
      let footMaxHeatTimeS = 0;
      if (payload.length >= 48) {
        footMaxHeatTimeS = (parseInt(payload[47]) << 8) | parseInt(payload[46]);
        const el = document.getElementById("footMaxHeatTimeS");
        if (el) el.textContent = footMaxHeatTimeS;
      }

      // 加热计算模式 48-49 (uint8)  1=时间模式 0=温度模式
      const heatModelNames = { 0: "温度模式", 1: "时间模式" };
      if (payload.length >= 49) {
        const el = document.getElementById("bodyHeatModel");
        if (el)
          el.textContent =
            heatModelNames[payload[48]] || `未知(${payload[48]})`;
      }
      if (payload.length >= 50) {
        const el = document.getElementById("footHeatModel");
        if (el)
          el.textContent =
            heatModelNames[payload[49]] || `未知(${payload[49]})`;
      }
    } catch (error) {
      bleAddLog("[错误]", `解析长包温度消息时出错: ${error.message}`);
      console.error("tempMsgHandle error:", error);
    }
  } else {
    // 数据长度不足且不是2字节的短包
    bleAddLog(
      "[警告]",
      `温度消息数据长度不足: ${payload.length} 字节，期望2字节或至少12字节`,
    );
  }
}
function adcToCurrent(adcValue) {
  if (adcValue === undefined || adcValue === null) {
    return 0;
  }
  return adcValue * 0.72; // 简化计算系数
}
// 更新温度显示
function updateTemperatureMsg(parsedMsg) {
  const bodyTemp = parsedMsg.bodyTemp;
  const footTemp = parsedMsg.footTemp;
  const bodyIntPart = parsedMsg.bodyTempRaw?.integer;
  const footIntPart = parsedMsg.footTempRaw?.integer;

  // 处理特殊温度值
  if (bodyIntPart === 225) {
    bodyTempEl.textContent = "传感器短路";
  } else if (bodyIntPart === 226) {
    bodyTempEl.textContent = "传感器开路";
  } else {
    bodyTempEl.textContent = bodyTemp.toFixed(1);
  }

  if (footIntPart === 225) {
    footTempEl.textContent = "传感器短路";
  } else if (footIntPart === 226) {
    footTempEl.textContent = "传感器开路";
  } else {
    footTempEl.textContent = footTemp.toFixed(1);
  }

  // 更新遥控器图片温度显示
  updateRemoteDisplay(bodyTemp, footTemp);
}

// 更新遥控器面板（Web Component）上的温度文字
function updateRemoteDisplay(bodyTemp, footTemp) {
  const hp = document.getElementById("heatingPanel");
  if (hp && hp.mode === "external") {
    // 外部控制模式下，仅更新温度显示（保留其他设置不变）
    if (typeof bodyTemp === "number" && bodyTemp > 0) {
      hp.bodyTemp = Math.round(bodyTemp);
    }
    if (typeof footTemp === "number" && footTemp > 0) {
      hp.feetTemp = Math.round(footTemp);
    }
  }
}

async function sendToSerial(data) {
  if (!port || !port.writable) return false;
  let uint8ArrayData;
  if (typeof data === "string") {
    const hex = data.replace(/\s/g, "");
    const arr = [];
    for (let i = 0; i < hex.length; i += 2)
      arr.push(parseInt(hex.substr(i, 2), 16));
    uint8ArrayData = new Uint8Array(arr);
  } else {
    uint8ArrayData = new Uint8Array(data);
  }
  writeQueue.push(uint8ArrayData);
  await processWriteQueue();
  return true;
}

async function processWriteQueue() {
  if (writing) return;
  writing = true;
  while (writeQueue.length > 0) {
    const data = writeQueue.shift();
    if (!port || !port.writable) break;
    try {
      const writer = port.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
    } catch (e) {
      console.error(e);
    }
  }
  writing = false;
}

// // 修改构造包的函数，使用新的组装器
async function constructPacket(messageId, operationType, data) {
  if (!globalAssembler || !isSerialConnected) {
    alert("串口未连接，请先连接串口再测试。");
    bleAddLog("[警告]", "串口未连接，请先连接串口再测试。");
    return;
  }
  // 使用新的组装器
  const packet = globalAssembler.assembleMessage(
    TARGET_ADDR,
    SENDER_ADDR,
    messageId,
    operationType,
    data,
  );

  // 获取消息类型名称和操作类型名称
  const msgTypeName = getMsgTypeName(messageId);
  const opTypeName = getOpTypeName(operationType);

  // 格式化HEX数据
  const hexStr = Array.from(packet)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");

  // 输出发送日志
  // bleAddLog(`[SEND >>>]`, `${msgTypeName} - ${opTypeName} Payload: [${data.map(d => '0x' + d.toString(16).toUpperCase()).join(', ')}]`);

  try {
    await sendToSerial(packet);
    // bleAddLog(`[SEND >>>]`, `${msgTypeName} - ${opTypeName} 发送成功 ✓`);
    // 发送完成后延时10ms
    // await new Promise(resolve => setTimeout(resolve, 10));
  } catch (error) {
    bleAddLog(
      `[SEND >>>]`,
      `${msgTypeName} - ${opTypeName} 发送失败 ✗ 错误: `,
      error,
    );
    throw error;
  }
}

async function setPeriodTimer() {
  const interval = parseInt(timerIntervalInput.value, 10) || 10;
  // 使用新的组装器
  await constructPacket(MSGTYPE.PERIODIC_TEMP, MSGOP.SET, [interval]);
  startTimerBtn.textContent = `周期(${interval}s)`;
}

function updatePlaybackDisplay() {
  const h = Math.floor(currentSecond / 3600);
  const m = Math.floor((currentSecond % 3600) / 60);
  const s = currentSecond % 60;
  currentTimeDisplay.textContent =
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0");
  progressFill.style.width = (currentSecond / totalDuration) * 100 + "%";
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + "h" + String(m).padStart(2, "0") + "m" + s + "s";
  else if (m > 0) return m + "m" + s + "s";
  return s + "s";
}

function formatTimeFull(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}

// 修改 ID 以匹配 HTML
function updateDeviceId(id) {
  // 改为 'deviceIdText'
  document.getElementById("deviceIdText").textContent = id || "未知";
}

// 修改 ID 以匹配 HTML
function updateDeviceVersion(version) {
  // 改为 'deviceVersionText'
  document.getElementById("deviceVersionText").textContent = version || "未知";
}

/**
 * 启动获取设备信息的请求流程
 */
function startGetSystemInfoRequest() {
  // 如果之前有残留的定时器，先清除
  if (sysInfoTimer) {
    clearTimeout(sysInfoTimer);
    sysInfoTimer = null;
  }
  bleAddLog("info", "请求设备信息...");

  // UI 更新：请求开始时，可以将界面设为“未知”或“获取中...”
  updateDeviceId("获取中...");
  updateDeviceVersion("-");
  sysInfoRequestCount = 0; // 重置请求计数
  isSysInfoReceived = false; // 重置接收标志
  // 执行第一次发送
  sendRequestWithRetry();
}

/**
 * 发送请求并设置重试机制
 */
function sendRequestWithRetry() {
  constructPacket(MSGTYPE.UNITO_MSGTYPE_SYSID, MSGOP.GET, [0x01]);

  sysInfoTimer = setInterval(() => {
    // 定时器触发时，如果还没有被“成功回调”清除，说明没收到回复
    if (!isConnected) {
      console.log("Connection lost, clearing sysInfoTimer.");
      clearInterval(sysInfoTimer);
      sysInfoTimer = null;
      return;
    }
    sysInfoRequestCount++;
    // --- 添加调试日志 ---
    if (sysInfoRequestCount % MAX_RETRY === 0 && !isSysInfoReceived) {
      // console.log(`[Retry] Requesting SysInfo again after ${sysInfoRequestCount} seconds (no response yet).`);
      constructPacket(MSGTYPE.UNITO_MSGTYPE_SYSID, MSGOP.GET, [0x01]);
    }
    let num2 = parseInt(timerIntervalInput.value);
    if (isNaN(num2)) {
      console.error("输入的值不是有效数字");
      return;
    }
    const checkThreshold = num2 + MAX_RETRY; // 计算阈值
    // console.log(`[Check Monitor] Threshold: ${checkThreshold}, Current Count: ${sysInfoRequestCount}`);
    if (sysInfoRequestCount >= checkThreshold) {
      // console.log(`[After Reset] sysInfoRequestCount set to: ${sysInfoRequestCount}`);
      sysInfoRequestCount = 0;
      if (timerIntervalInput.value > 0 && isSysInfoReceived) {
        isSysInfoReceived = false; // 重置接收标志，准备下一轮请求
        // console.log(`[After Flag Reset] isSysInfoReceived set to: ${isSysInfoReceived}`);
      }
    }
  }, 1000); // 1秒超时
}

/**
 * 成功接收到数据时的处理函数 (需要在你的串口解析逻辑中调用)
 */
function onSystemInfoReceived(payload, len) {
  // --- 修复点：在这里添加 parsedData 的定义 ---
  let parsedData = {}; // 创建一个空对象，或者直接初始化为包含 deviceIdStr 的对象
  sysInfoRequestCount = 0;
  // --- 数据有效性验证开始 ---
  // 检查 payload 长度是否满足基本要求 (至少要有 设备ID 12字节 + 版本号 2字节 + 周期间隔 1字节 = 15字节)
  if (!payload || payload.length < 15) {
    // console.error("[onSystemInfoReceived] Error: Payload too short. Expected at least 15 bytes, got:", payload?.length);
    return; // 如果长度不够，直接返回，不继续处理也不设置标志
  }
  // 1. 解析 12 字节设备 ID
  let idHexArray = [];
  for (let i = 0; i < 12; i++) {
    // .slice(-2) 确保是两位数，.toUpperCase() 确保是大写字母
    idHexArray.push(("0" + payload[i].toString(16)).slice(-2).toUpperCase());
  }
  // 在 onSystemInfoReceived 函数中
  const fullHex = idHexArray.join(""); // 先拼成完整的 AABBCC... 这种格式
  bleAddLog(`[RECV <<<]`, `原始设备ID: ${fullHex}`);
  // 只显示开始8位
  // parsedData.deviceIdStr = `HT-${fullHex.slice(8)}`;
  parsedData.deviceIdStr = `HT-${fullHex.substring(0, 8)}`;
  devId = parsedData.deviceIdStr;
  // 修改点：这里使用 '' (空字符串) 连接，并且因为上面已经 toUpperCase 了，这里就不需要了
  // parsedData.deviceIdStr = idHexArray.join('');

  // 2. 解析版本号
  parsedData.versionMajor = payload[12];
  parsedData.versionMinor = payload[13];
  parsedData.versionStr = `v${payload[12]}.${payload[13]}`;
  devVer = parsedData.versionStr;

  // 3. 更新 UI
  bleAddLog(
    `[RECV <<<]`,
    `成功获取设备信息: ${parsedData.deviceIdStr}, 版本: ${parsedData.versionStr}`,
  );
  updateDeviceId(parsedData.deviceIdStr);
  updateDeviceVersion(parsedData.versionStr);
  updateIntTest("devIdOk", true); // 测试模式：标记设备ID检测成功
  const periodicValue = payload[14];
  timerIntervalInput.value = periodicValue;
  startTimerBtn.textContent = `周期(${timerIntervalInput.value}s)`;
  if (len > 15) {
    const totalRunTime =
      payload[15] +
      (payload[16] << 8) +
      (payload[17] << 16) +
      (payload[18] << 24);

    // bleAddLog(`[RECV <<<]`, `时间：${totalRunTime}`);
    const bodyTemp = parseFloat((payload[20] + payload[19] / 10).toFixed(1));
    const footTemp = parseFloat((payload[22] + payload[21] / 10).toFixed(1));

    const trTempBody = parseFloat((payload[24] + payload[23] / 10).toFixed(1));
    const trTempFoot = parseFloat((payload[26] + payload[25] / 10).toFixed(1));

    updateTemperatureMsg({
      bodyTemp,
      footTemp,
      bodyTempRaw: { decimal: payload[20], integer: payload[19] },
      footTempRaw: { decimal: payload[22], integer: payload[21] },
    });
    if (bodyTargetTempEl) bodyTargetTempEl.textContent = bodyLastTemp; // 更新目标温度
    if (footTargetTempEl) footTargetTempEl.textContent = footLastTemp;
    updatePlaybackDisplay(); // 重绘秒
  }
  isSysInfoReceived = true; // 设置标志，表示已经成功接收系统信息
  // 获取器件信息后，自动设置周期为1秒
  constructPacket(MSGTYPE.PERIODIC_TEMP, MSGOP.SET, [1]);
  bleAddLog("info", "已自动设置周期为 1 秒");
}

// POWER消息组装函数
function assemblePowerMessage(
  msgOp,
  powerState,
  bodyTemp,
  footTemp,
  totalDuration,
) {
  let payload = [];
  // let operationDesc = "";
  switch (msgOp) {
    case MSGOP.GET:
      // 获取电源状态
      return;
    case MSGOP.SET:
      // 设置电源开关 footLastTemp
      payload = [
        bodyTemp & 0xff,
        footTemp & 0xff,
        totalDuration & 0xff,
        powerState ? 0x02 : 0x01,
      ];
      // operationDesc = `设置电源状态为: ${powerState ? "ON" : "OFF"}(值: ${powerState ? 0x02 : 0x01})`;
      break;
  }

  constructPacket(MSGTYPE.WORK, msgOp, payload);
}

// 更新温度
function updateHeatingTemp(targetBodyTemp, targetFootTemp) {
  let bodyTemp = targetBodyTemp * 10;
  let footTemp = targetFootTemp * 10;
  let payload = [
    bodyTemp & 0xff, // 低字节 (LSB)
    (bodyTemp >> 8) & 0xff, // 高字节 (MSB)
    footTemp & 0xff, // 低字节 (LSB)
    (footTemp >> 8) & 0xff, // 高字节 (MSB)
  ];
  constructPacket(MSGTYPE.UNITO_SET_TEMP01C, MSGOP.SET, payload);
  bleAddLog(
    `[SEND >>>]`,
    `更新温度 - body: ${targetBodyTemp}°C, foot: ${targetFootTemp}°C, bodyTemp(raw): ${bodyTemp}, footTemp(raw): ${footTemp}, payload: [${payload.map((d) => "0x" + d.toString(16).toUpperCase()).join(", ")}]`,
  );
}

// --- 新增或修改 ---
function updateSysStatusDisplay(stateValue) {
  const element = document.getElementById("heatingStatusDisplay"); // 确保 ID 正确
  if (!element) {
    bleAddLog(`[警告]`, "Element with ID heatingStatusDisplay not found.");
    return;
  }

  const statusText = sysStateNames[stateValue] || "未知";
  element.textContent = statusText;

  // 清除旧的状态类
  element.classList.remove(
    "status-running",
    "status-paused",
    "status-off",
    "status-error",
    "status-non",
  );

  // 根据 SysState 添加新的 CSS 类
  if (stateValue === SysState.ON) {
    element.classList.add("status-running"); // 运行中用绿色
  } else if (stateValue === SysState.OFF) {
    element.classList.add("status-off"); // 已关闭用红色
  } else if (stateValue === SysState.ERROR) {
    element.classList.add("status-error"); // 错误用红色或其他颜色
  } else if (stateValue === SysState.NON) {
    element.classList.add("status-non"); // 未连接用灰色
  }
  // 如果是 "未知" 状态，则不添加特殊颜色类
}

// --- 修改原函数，区分 HeaterMode 和 SysState ---
function updateStatusDisplay(elementId, stateValue, isSysState = false) {
  // 添加 isSysState 参数
  const element = document.getElementById(elementId);
  if (!element) {
    bleAddLog(`[警告]`, `Element with ID ${elementId} not found.`);
    return;
  }

  let statusText;
  let stateMap;

  if (isSysState) {
    // 使用 SysState 映射表
    stateMap = sysStateNames;
  } else {
    // 使用 HeaterMode 映射表
    stateMap = modeNames;
  }

  statusText = stateMap[stateValue] || "未知";
  element.textContent = statusText;

  // 清除所有可能的颜色类
  element.classList.remove(
    "status-running",
    "status-paused",
    "status-off",
    "status-error",
    "status-non",
  );

  // 根据传入的类型判断应用哪个颜色
  if (isSysState) {
    if (stateValue === SysState.ON) {
      element.classList.add("status-running");
    } else if (stateValue === SysState.OFF) {
      element.classList.add("status-off");
    } else if (stateValue === SysState.ERROR) {
      element.classList.add("status-error");
    } else if (stateValue === SysState.NON) {
      element.classList.add("status-non");
    }
  } else {
    // HeaterMode
    if (stateValue === HeaterMode.RUNNING) {
      element.classList.add("status-running");
    } else if (
      [HeaterMode.TEMP_SUSPENDED, HeaterMode.TIM_SUSPENDED].includes(stateValue)
    ) {
      element.classList.add("status-paused");
    } else if (stateValue === HeaterMode.OFF) {
      element.classList.add("status-off");
    }
  }
}
// 添加这些函数到页面的 JavaScript 部分
function updateThresholdHeating() {
  if (!isConnected) {
    bleAddLog("[错误]", "设备未连接，无法通讯");
    return;
  }
  // 获取输入值
  const bodyThresholdInput =
    document.getElementById("bodyThresholdInput").value;
  const footThresholdInput =
    document.getElementById("footThresholdInput").value;

  bleAddLog(
    `[信息]`,
    `更新阀值, 身体阀值温度: ${bodyThresholdInput}/10°C, 脚部阀值温度: ${footThresholdInput}/10°C`,
  );

  const payload = [bodyThresholdInput & 0xff, footThresholdInput & 0xff];

  constructPacket(MSGTYPE.TH, MSGOP.SET, payload);
}

function updateTempHeating() {
  if (!isConnected) {
    bleAddLog("[错误]", "设备未连接，无法开始加热");
    return;
  }
  // 获取输入值
  const runtimeHours = document.getElementById("runtimeHoursInput").value;
  const bodyTemp = document.getElementById("bodyTempInput").value;
  const footTemp = document.getElementById("footTempInput").value;

  bleAddLog(
    `[信息]`,
    `直接设置开始加热 - 运行时间: ${runtimeHours}小时, 身体温度: ${bodyTemp}°C, 脚部温度: ${footTemp}°C`,
  );

  const payload = [bodyTemp & 0xff, footTemp & 0xff, runtimeHours & 0xff, 0x02];

  constructPacket(MSGTYPE.WORK, MSGOP.SET, payload);
}
// 添加这些函数到页面的 JavaScript 部分
function manuallyStartHeating() {
  if (!isConnected) {
    bleAddLog("[错误]", "设备未连接，无法开始加热");
    return;
  }
  // 获取输入值
  const runtimeHours = document.getElementById("runtimeHoursInput").value;
  const bodyTemp = document.getElementById("bodyTempInput").value;
  const footTemp = document.getElementById("footTempInput").value;
  bleAddLog(
    `[信息]`,
    `直接设置开始加热 - 运行时间: ${runtimeHours}小时, 身体温度: ${bodyTemp}°C, 脚部温度: ${footTemp}°C`,
  );

  // 更新按钮状态
  document.getElementById("startHeatingBtn").disabled = true;
  document.getElementById("manuallyStartHeatingBtn").disabled = true;
  document.getElementById("stopHeatingBtn").disabled = false;
  document.getElementById("updateTempBtn").disabled = false;

  const payload = [bodyTemp & 0xff, footTemp & 0xff, runtimeHours & 0xff, 0x02];

  constructPacket(MSGTYPE.CTRL_WORK, MSGOP.SET, payload);
}
// 添加这些函数到页面的 JavaScript 部分
function startHeating() {
  if (!isConnected) {
    bleAddLog("[错误]", "设备未连接，无法开始加热");
    return;
  }
  // 获取输入值
  const runtimeHours = document.getElementById("runtimeHoursInput").value;
  const bodyTemp = document.getElementById("bodyTempInput").value;
  const footTemp = document.getElementById("footTempInput").value;

  bleAddLog(
    `[信息]`,
    `开始加热 - 运行时间: ${runtimeHours}小时, 身体温度: ${bodyTemp}°C, 脚部温度: ${footTemp}°C`,
  );

  // 更新按钮状态
  document.getElementById("startHeatingBtn").disabled = true;
  document.getElementById("manuallyStartHeatingBtn").disabled = true;
  document.getElementById("stopHeatingBtn").disabled = false;
  document.getElementById("updateTempBtn").disabled = false;
  assemblePowerMessage(MSGOP.SET, true, bodyTemp, footTemp, runtimeHours); // 发送开机命令
  // 在这里添加实际的加热启动逻辑
  // 例如发送蓝牙命令、更新UI状态等
}

function stopHeating() {
  if (!isConnected) {
    bleAddLog("[错误]", "设备未连接，无法开始加热");
    return;
  }
  bleAddLog(`[信息]`, "停止加热");
  const runtimeHours = document.getElementById("runtimeHoursInput").value;
  const bodyTemp = document.getElementById("bodyTempInput").value;
  const footTemp = document.getElementById("footTempInput").value;
  // 更新按钮状态
  document.getElementById("startHeatingBtn").disabled = false;
  document.getElementById("manuallyStartHeatingBtn").disabled = false;
  document.getElementById("stopHeatingBtn").disabled = true;
  document.getElementById("updateTempBtn").disabled = true;
  assemblePowerMessage(MSGOP.SET, false, bodyTemp, footTemp, runtimeHours); // 发送关机命令
  // 在这里添加实际的加热停止逻辑
  // 例如发送蓝牙命令、更新UI状态等
}

// 更新加热按钮状态的函数（按钮已移除，仅保留状态检查逻辑）
function updateHeatingButtonStates() {
  const startBtn = document.getElementById("startHeatingBtn");
  const manuallyStartBtn = document.getElementById("manuallyStartHeatingBtn");
  const stopBtn = document.getElementById("stopHeatingBtn");
  const element = document.getElementById("heatingStatusDisplay");
  const updateThresholdBtn = document.getElementById("updateThresholdBtn");
  const updateTempBtn = document.getElementById("updateTempBtn");
  let isRunning = false;

  if (!element) {
    console.warn("heatingStatusDisplay 元素不存在");
  } else {
    isRunning =
      element.textContent.trim() === "运行中" ||
      element.classList.contains("status-running");
  }

  if (typeof isConnected !== "undefined" && isConnected) {
    if (isRunning) {
      if (startBtn) startBtn.disabled = true;
      if (manuallyStartBtn) manuallyStartBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (updateTempBtn) updateTempBtn.disabled = false;
    } else {
      if (startBtn) startBtn.disabled = false;
      if (manuallyStartBtn) manuallyStartBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (updateTempBtn) updateTempBtn.disabled = true;
    }
    if (updateThresholdBtn) updateThresholdBtn.disabled = false;
  } else {
    if (startBtn) startBtn.disabled = true;
    if (manuallyStartBtn) manuallyStartBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    if (updateThresholdBtn) updateThresholdBtn.disabled = true;
    if (updateTempBtn) updateTempBtn.disabled = true;
  }
}

// 更新电流显示的函数
function updateCurrentDisplay(
  bodyCurrent,
  footCurrent,
  bodyVoltage = 24.0,
  footVoltage = 24.0,
) {
  const powerVoltage = 24.0;
  const bc = document.getElementById("bodyCurrent");
  const fc = document.getElementById("footCurrent");
  const bv = document.getElementById("bodyVoltage");
  const fv = document.getElementById("footVoltage");
  const bp = document.getElementById("bodyPower");
  const fp = document.getElementById("footPower");
  if (bc) bc.textContent = bodyCurrent.toFixed(2);
  if (fc) fc.textContent = footCurrent.toFixed(2);
  if (bv) bv.textContent = bodyVoltage;
  if (fv) fv.textContent = footVoltage;
  if (bp) bp.textContent = (bodyCurrent * powerVoltage).toFixed(1);
  if (fp) fp.textContent = (footCurrent * powerVoltage).toFixed(1);
}
function startHardwareResetRequest() {
  const payload = [0xa5 & 0xff, 0x5a & 0xff];

  constructPacket(MSGTYPE.UNITO_SET_REBOOT, MSGOP.SET, payload);
}

function startClearFaultRequest() {
  const payload = [0xa5 & 0xff, 0x5a & 0xff];
  constructPacket(MSGTYPE.UNITO_SET_CLEAR_FAULT, MSGOP.SET, payload);
}

// 假设 startTimerBtn.textContent 的格式是 "周期(XXs)" 或者按钮初始文本是 "设置周期"
// 我们需要一个函数来提取当前按钮上显示的时间间隔
function getCurrentDisplayInterval() {
  const text = startTimerBtn.textContent;
  // 使用正则表达式匹配 "周期(Xs)" 或 "周期(XXs)" 等模式
  const match = text.match(/周期\((\d+)s\)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  // 如果没有匹配到（比如按钮文本还是初始的 "设置周期"），则返回 null 或 undefined
  return null;
}

// ========== 页面关闭时释放串口和MQTT ==========
window.addEventListener("beforeunload", function () {
  // 断开串口连接
  if (reader) {
    try {
      reader.cancel();
    } catch (e) {}
    reader = null;
  }
  if (currentPort) {
    try {
      currentPort.close();
    } catch (e) {}
    currentPort = null;
  }
  isReading = false;
  isConnected = false;
  isSerialConnected = false;
  globalParser = null;
  globalAssembler = null;

  // 清理MQTT
  if (mqttClient) {
    try {
      mqttClient.end(true);
    } catch (e) {}
    mqttClient = null;
  }
});
// ========== 测试面板渲染 ==========
function renderTestPanel() {
  const panel = document.getElementById("testPanel");
  if (!panel) return;
  const mode = currentTestMode;
  const defs = TEST_DEFS[mode] || [];
  let html = "";
  let idx = 0;
  for (const item of defs) {
    idx++;
    let resultHtml = "";
    if (item.result === "wait") {
      resultHtml = '<span class="test-item-result wait">⏳</span>';
    } else if (item.result === "ok") {
      resultHtml = '<span class="test-item-result ok">✅ PASS</span>';
    } else if (item.result === "fail") {
      resultHtml = '<span class="test-item-result fail">❌</span>';
    } else {
      resultHtml = `<span class="test-item-result" style="color:var(--accent-cyan)">${item.result}</span>`;
    }
    html += `<div class="test-item"><span class="test-item-label">${idx}. ${item.label}</span>${resultHtml}</div>`;
  }
  if (!html) {
    html = '<div class="test-panel-empty">无测试项</div>';
  }
  panel.innerHTML = html;
}

function resetAllTests() {
  // 重置外部测试状态
  extTest = {
    onoffOk: false,
    lastPower: null,
    timeOk: false,
    bodyOk: false,
    footOk: false,
    bodyHas0: false,
    bodyHas36: false,
    footHas0: false,
    footHas40: false,
    serialResponse: false,
  };
  // 重置内部测试状态
  intTest = {
    devIdOk: false,
    faultOk: false,
    bodySensorOk: false,
    footSensorOk: false,
    bodySetTempOk: false,
    footSetTempOk: false,
    runStateSeenOn: false,
    runStateSeenOff: false,
    runTimeOk: false,
    bodyOffCurrOk: false,
    bodyOnCurrOk: false,
    footOffCurrOk: false,
    footOnCurrOk: false,
    bodySensorOkCnt: 0,
    footSensorOkCnt: 0,
    bodyOffCurrOkCnt: 0,
    bodyOnCurrOkCnt: 0,
    footOffCurrOkCnt: 0,
    footOnCurrOkCnt: 0,
  };
  // 重置定义中的 result 和 actual
  for (const key of Object.keys(TEST_DEFS)) {
    TEST_DEFS[key].forEach((item) => {
      item.result = "wait";
      item.actual = "";
    });
  }
}

function startTest(isSave = false) {
  if (!isSerialConnected) {
    alert("串口未连接，请先连接串口再测试。");
    return;
  }
  // 如果之前已有测试数据，先通过 MQTT 发送上次结果
  if (testActive && isMqttConnected && mqttClient) {
    const prevMode = currentTestMode;
    const prevDefs = TEST_DEFS[prevMode];
    if (prevDefs && prevDefs.some((item) => item.result !== "wait")) {
      const topic = isSave
        ? prevMode === "external"
          ? "/unito/stoov/heating-bed/save/yaokong"
          : "/unito/stoov/heating-bed/save/heating"
        : prevMode === "external"
          ? "/unito/stoov/heating-bed/yaokong"
          : "/unito/stoov/heating-bed/heating";
      const barcode = document.getElementById("barcodeInput")?.value || "";
      const itemsObj = {};
      prevDefs.forEach((item, i) => {
        itemsObj[String(i + 1)] = item.actual || item.result;
      });
      const jsonData = {
        mode: prevMode,
        barcode: barcode,
        timestamp: new Date()
          .toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
          .replace(/\//g, "-")
          .replace(/, /, " "),
        ...(prevMode === "internal"
          ? { deviceId: devId || "未知", deviceVer: devVer || "未知" }
          : {}),
        items: itemsObj,
      };
      const payload = JSON.stringify(jsonData);
      mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) bleAddLog("[MQTT]", `测试结果发送失败 ✗ ${err.message}`);
        else bleAddLog("[MQTT]", `测试结果已发送 → ${topic}`);
      });
      bleAddLog(
        "[MQTT]",
        `发送上次测试结果 → Topic: ${topic}, Payload: ${payload}`,
      );
    }
  }
  const btn = document.getElementById("startTestBtn");
  btn.innerHTML = "⏳ 测试中...";
  testActive = true;
  resetAllTests();
  currentTestMode = document.getElementById("rockerToggle")?.checked
    ? "internal"
    : "external";
  renderTestPanel();
  bleAddLog(
    "info",
    `开始测试 → 模式: ${currentTestMode === "external" ? "测试遥控" : "测试加热"}`,
  );
  // 测试加热模式：先获取一次设备ID
  if (currentTestMode === "internal") {
    startGetSystemInfoRequest();
  }
}

// 保存测试：使用 currentTestMode（与 startTest 一致），确保保存的模式与实际测试模式匹配
function saveTest() {
  const saveMode = currentTestMode;
  // 如果之前已有测试数据，先通过 MQTT 发送上次结果
  if (testActive && isMqttConnected && mqttClient) {
    const prevDefs = TEST_DEFS[saveMode];
    if (prevDefs && prevDefs.some((item) => item.result !== "wait")) {
      const topic =
        saveMode === "external"
          ? "/unito/stoov/heating-bed/save/yaokong"
          : "/unito/stoov/heating-bed/save/heating";
      const barcode = document.getElementById("barcodeInput")?.value || "";
      const itemsObj = {};
      prevDefs.forEach((item, i) => {
        itemsObj[String(i + 1)] = item.actual || item.result;
      });
      const jsonData = {
        mode: saveMode,
        barcode: barcode,
        timestamp: new Date()
          .toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
          .replace(/\//g, "-")
          .replace(/, /, " "),
        ...(saveMode === "internal"
          ? { deviceId: devId || "未知", deviceVer: devVer || "未知" }
          : {}),
        items: itemsObj,
      };
      const payload = JSON.stringify(jsonData);
      mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) bleAddLog("[MQTT]", `测试结果发送失败 ✗ ${err.message}`);
        else bleAddLog("[MQTT]", `测试结果已发送 → ${topic}`);
      });
      bleAddLog(
        "[MQTT]",
        `发送上次测试结果 → Topic: ${topic}, Payload: ${payload}`,
      );
    }
  }
  // 保存完成后重置测试状态
  testActive = false;
  currentTestMode = saveMode;
  const barcodeEl = document.getElementById("barcodeInput");
  if (barcodeEl) {
    barcodeEl.value = "";
    updateTestBtnState();
  }
  const btn = document.getElementById("startTestBtn");
  btn.innerHTML = "⏵ 开始测试";
}

// 更新外部模式测试结果（由 handleMessage 中 WORK SET 触发）
function updateExtTest(payload) {
  if (!testActive || currentTestMode !== "external") return;
  // payload: [bodyTemp, footTemp, hours, powerState]
  if (payload.length < 4) return;
  const bodyTemp = payload[0];
  const footTemp = payload[1];
  const hours = payload[2];
  const power = payload[3]; // 0x01=OFF, 0x02=ON

  const defs = TEST_DEFS.external;
  // 1. ON/OFF: 必须由 OFF→ON 才算 OK
  if (!extTest.onoffOk) {
    if (extTest.lastPower === 0x01 && power === 0x02) {
      extTest.onoffOk = true;
      defs.find((d) => d.id === "ext-onoff").result = "ok";
    }
    extTest.lastPower = power;
  }
  // 2. 时间设置: 非默认值1，在2-12之间
  if (!extTest.timeOk && hours >= 2 && hours <= 12) {
    extTest.timeOk = true;
    defs.find((d) => d.id === "ext-time").result = "ok";
  }
  // 3. 身体温度: 必须出现0和36
  if (bodyTemp === 0) extTest.bodyHas0 = true;
  if (bodyTemp === 36) extTest.bodyHas36 = true;
  if (!extTest.bodyOk && extTest.bodyHas0 && extTest.bodyHas36) {
    extTest.bodyOk = true;
    defs.find((d) => d.id === "ext-body").result = "ok";
  }
  // 4. 脚温度: 必须出现0和40
  if (footTemp === 0) extTest.footHas0 = true;
  if (footTemp === 40) extTest.footHas40 = true;
  if (!extTest.footOk && extTest.footHas0 && extTest.footHas40) {
    extTest.footOk = true;
    defs.find((d) => d.id === "ext-foot").result = "ok";
  }
  renderTestPanel();
  // 5,如果extTest.serialResponse为False，则发送一次数据，激活测试
  if (extTest.serialResponse === false) {
    constructPacket(MSGTYPE.ERROR, MSGOP.REPORT, [0x00]);
  }
}

// 更新内部模式测试结果（由 tempMsgHandle / onSystemInfoReceived 触发）
function updateIntTest(key, value) {
  if (!testActive || currentTestMode !== "internal") return;
  intTest[key] = value;
  const defs = TEST_DEFS.internal;
  const setItem = (id, result, actual) => {
    const d = defs.find((d) => d.id === id);
    if (d) {
      const wasOk = d.result === "ok";
      d.result = result;
      // 只在首次变为 OK 时锁定 actual 值，避免后续数据覆盖
      if (actual !== undefined && !wasOk) {
        d.actual = actual;
      }
    }
  };
  // 1. 设备ID (不附加 actual，deviceId 已在 json 顶层)
  if (key === "devIdOk" && value) {
    setItem("int-devid", "ok", "");
  }
  // 2. 故障代码：0 为 OK
  if (key === "faultCode") {
    intTest.faultOk = true;
    const faultHex = "0x" + value.toString(16).toUpperCase();
    setItem(
      "int-fault",
      value === 0 ? "✅ PASS" : `❌ ${faultHex}`,
      value === 0 ? "Ok(" + faultHex + ")" : "Err(" + faultHex + ")",
    );
  }
  // 3. 身体温度传感器（连续4次OK才判定通过）
  if (key === "bodySensor") {
    const numVal = parseFloat(value);
    const valStr = !isNaN(numVal) ? numVal.toFixed(1) + "°C" : value;
    const pass =
      !isNaN(numVal) &&
      numVal >= currRange.bodySensorMin &&
      numVal <= currRange.bodySensorMax;
    if (pass) {
      intTest.bodySensorOkCnt++;
      if (intTest.bodySensorOkCnt >= 4) intTest.bodySensorOk = true;
    } else {
      intTest.bodySensorOkCnt = 0;
    }
    setItem(
      "int-bsensor",
      intTest.bodySensorOk ? "✅ PASS" : `❌ ${valStr}`,
      intTest.bodySensorOk ? "Ok(" + valStr + ")" : "Err(" + valStr + ")",
    );
  }
  // 4. 脚温度传感器（连续4次OK才判定通过）
  if (key === "footSensor") {
    const numVal = parseFloat(value);
    const valStr = !isNaN(numVal) ? numVal.toFixed(1) + "°C" : value;
    const pass =
      !isNaN(numVal) &&
      numVal >= currRange.footSensorMin &&
      numVal <= currRange.footSensorMax;
    if (pass) {
      intTest.footSensorOkCnt++;
      if (intTest.footSensorOkCnt >= 4) intTest.footSensorOk = true;
    } else {
      intTest.footSensorOkCnt = 0;
    }
    setItem(
      "int-fsensor",
      intTest.footSensorOk ? "✅ PASS" : `❌ ${valStr}`,
      intTest.footSensorOk ? "Ok(" + valStr + ")" : "Err(" + valStr + ")",
    );
  }
  // 5. 身体设置温度
  if (key === "bodySetTemp") {
    if (value === 0 || (value >= 25 && value <= 36))
      intTest.bodySetTempOk = true;
    const valStr = value.toFixed(1) + "°C";
    setItem(
      "int-bsettemp",
      intTest.bodySetTempOk ? "✅ PASS" : `❌ ${valStr}`,
      intTest.bodySetTempOk ? "Ok(" + valStr + ")" : "Err(" + valStr + ")",
    );
  }
  // 6. 脚设置温度
  if (key === "footSetTemp") {
    if (value === 0 || (value >= 25 && value <= 40))
      intTest.footSetTempOk = true;
    const valStr = value.toFixed(1) + "°C";
    setItem(
      "int-fsettemp",
      intTest.footSetTempOk ? "✅ PASS" : `❌ ${valStr}`,
      intTest.footSetTempOk ? "Ok(" + valStr + ")" : "Err(" + valStr + ")",
    );
  }
  // 7. 运行状态
  if (key === "runState") {
    if (value === SysState.ON) intTest.runStateSeenOn = true;
    if (value === SysState.OFF) intTest.runStateSeenOff = true;
    const ok = intTest.runStateSeenOn && intTest.runStateSeenOff;
    const stateName =
      value === SysState.ON
        ? "运行中"
        : value === SysState.OFF
          ? "已关闭"
          : String(value);
    const actualStates =
      (intTest.runStateSeenOn ? "ON" : "") +
      (intTest.runStateSeenOff ? ",OFF" : "");
    setItem(
      "int-runstate",
      ok ? "✅ PASS" : stateName,
      ok ? "Ok(" + actualStates + ")" : "Err(" + stateName + ")",
    );
  }
  // 8. 设置运行时间
  if (key === "runTime") {
    if (value >= 1 && value <= 12) intTest.runTimeOk = true;
    const valStr = value + "h";
    setItem(
      "int-runtime",
      intTest.runTimeOk ? "✅ PASS" : `❌ ${valStr}`,
      intTest.runTimeOk ? "Ok(" + valStr + ")" : "Err(" + valStr + ")",
    );
  }
  // 9/10. 身体电流检测（仅更新当前状态对应的项，连续4次OK才判定通过）
  if (key === "bodyCurrCheck") {
    const raw = value.raw,
      state = value.state;
    // RUNNING(1) / TEMP_SUSPENDED(2) / TIM_SUSPENDED(3) 均视为加热开启
    if (state !== HeaterMode.OFF) {
      const pass = raw >= currRange.bodyOnMin && raw <= currRange.bodyOnMax;
      if (pass) {
        intTest.bodyOnCurrOkCnt++;
        if (intTest.bodyOnCurrOkCnt >= 4) intTest.bodyOnCurrOk = true;
      } else {
        intTest.bodyOnCurrOkCnt = 0;
      }
      setItem(
        "int-boncurr",
        intTest.bodyOnCurrOk ? "✅ PASS" : `❌ ADC:${raw}`,
        intTest.bodyOnCurrOk ? "Ok(" + raw + ")" : "Err(" + raw + ")",
      );
    } else {
      const pass = raw >= currRange.bodyOffMin && raw <= currRange.bodyOffMax;
      if (pass) {
        intTest.bodyOffCurrOkCnt++;
        if (intTest.bodyOffCurrOkCnt >= 4) intTest.bodyOffCurrOk = true;
      } else {
        intTest.bodyOffCurrOkCnt = 0;
      }
      setItem(
        "int-boffcurr",
        intTest.bodyOffCurrOk ? "✅ PASS" : `❌ ADC:${raw}`,
        intTest.bodyOffCurrOk ? "Ok(" + raw + ")" : "Err(" + raw + ")",
      );
    }
  }
  // 11/12. 脚电流检测（仅更新当前状态对应的项，连续4次OK才判定通过）
  if (key === "footCurrCheck") {
    const raw = value.raw,
      state = value.state;
    // RUNNING(1) / TEMP_SUSPENDED(2) / TIM_SUSPENDED(3) 均视为加热开启
    if (state !== HeaterMode.OFF) {
      const pass = raw >= currRange.footOnMin && raw <= currRange.footOnMax;
      if (pass) {
        intTest.footOnCurrOkCnt++;
        if (intTest.footOnCurrOkCnt >= 4) intTest.footOnCurrOk = true;
      } else {
        intTest.footOnCurrOkCnt = 0;
      }
      setItem(
        "int-foncurr",
        intTest.footOnCurrOk ? "✅ PASS" : `❌ ADC:${raw}`,
        intTest.footOnCurrOk ? "Ok(" + raw + ")" : "Err(" + raw + ")",
      );
    } else {
      const pass = raw >= currRange.footOffMin && raw <= currRange.footOffMax;
      if (pass) {
        intTest.footOffCurrOkCnt++;
        if (intTest.footOffCurrOkCnt >= 4) intTest.footOffCurrOk = true;
      } else {
        intTest.footOffCurrOkCnt = 0;
      }
      setItem(
        "int-foffcurr",
        intTest.footOffCurrOk ? "✅ PASS" : `❌ ADC:${raw}`,
        intTest.footOffCurrOk ? "Ok(" + raw + ")" : "Err(" + raw + ")",
      );
    }
  }
  renderTestPanel();
}

// ──────── 加热面板控制模式切换 ────────
function toggleControlMode() {
  const hp = document.getElementById("heatingPanel");
  const rocker = document.getElementById("rockerToggle");
  if (!hp) return;
  const newMode = rocker && rocker.checked ? "internal" : "external";
  hp.mode = newMode;
  currentTestMode = newMode;
  resetAllTests();
  testActive = false;
  renderTestPanel();

  if (newMode === "external") {
    updateDeviceId("未知");
    updateDeviceVersion("未知");
    if (isConnected) {
      const payload = [0, 0, 0, 0x01];
      bleAddLog("info", "测试遥控模式 → 发送加热关闭指令");
      constructPacket(MSGTYPE.WORK, MSGOP.SET, payload);
    }
    bleAddLog("info", "加热面板模式切换 → 测试遥控");
  } else {
    bleAddLog("info", "加热面板模式切换 → 测试加热");
    if (isConnected) {
      startGetSystemInfoRequest();
    }
  }
}

// ──────── 监听加热面板数据变更 (1.5秒防抖发送) ────────
let heatingPanelDebounceTimer = null;
function setupHeatingPanelListener() {
  const hp = document.getElementById("heatingPanel");
  if (!hp) return;
  hp.addEventListener("data-change", (e) => {
    const d = e.detail;
    bleAddLog(
      "info",
      `加热面板操作 → isOn:${d.isOn} hours:${d.hours} body:${d.bodyTemp}° feet:${d.feetTemp}°`,
    );

    // 清除之前的防抖定时器
    if (heatingPanelDebounceTimer) {
      clearTimeout(heatingPanelDebounceTimer);
    }

    // 1.5秒防抖：停止更新后才发送
    heatingPanelDebounceTimer = setTimeout(() => {
      heatingPanelDebounceTimer = null;
      if (!isSerialConnected) {
        alert("串口未连接，请先连接串口再测试。");
        bleAddLog("[警告]", "串口未连接，请先连接串口再测试。");
        return;
      }
      // 按照 assemblePowerMessage 格式组装并发送
      const payload = [
        d.bodyTemp & 0xff,
        d.feetTemp & 0xff,
        d.hours & 0xff,
        d.isOn ? 0x02 : 0x01,
      ];
      bleAddLog(
        "info",
        `加热面板发送 → body:${d.bodyTemp}°C feet:${d.feetTemp}°C hours:${d.hours}h power:${d.isOn ? "ON" : "OFF"}`,
      );
      constructPacket(MSGTYPE.WORK, MSGOP.SET, payload);
    }, 1500);
  });
}

// ========== 键盘快捷键处理 ==========
function handleKeyboardShortcut(event) {
  // Alt+I: 聚焦条码输入框（全局生效，不受焦点限制）
  if (event.altKey && (event.key === "i" || event.key === "I")) {
    event.preventDefault();
    const barcodeEl = document.getElementById("barcodeInput");
    if (barcodeEl) barcodeEl.focus();
    return;
  }

  // 当焦点在输入框时，不拦截快捷键
  const tag = document.activeElement ? document.activeElement.tagName : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  const hp = document.getElementById("heatingPanel");
  if (!hp || hp.mode !== "internal") return; // 仅在"测试加热"模式下生效

  const key = event.key;
  let handled = true;

  if (key === "p" || key === "P") {
    // 开关电源
    hp._state.isOn = !hp._state.isOn;
  } else if (key === "ArrowUp") {
    if (event.shiftKey) {
      // Shift+↑ → 时间 +1
      hp._state.main.value = Math.min(12, hp._state.main.value + 1);
    } else {
      // 身体温度 +1
      adjustTemp(hp._state.left, 1);
    }
  } else if (key === "ArrowDown") {
    if (event.shiftKey) {
      // Shift+↓ → 时间 -1
      hp._state.main.value = Math.max(1, hp._state.main.value - 1);
    } else {
      // 身体温度 -1
      adjustTemp(hp._state.left, -1);
    }
  } else if (key === "ArrowRight") {
    // 脚部温度 +1
    adjustTemp(hp._state.right, 1);
  } else if (key === "ArrowLeft") {
    // 脚部温度 -1
    adjustTemp(hp._state.right, -1);
  } else {
    handled = false;
  }

  if (handled) {
    event.preventDefault();
    hp._scheduleUI();
    hp._sendToExternal();
    bleAddLog(
      "info",
      `快捷键 ${event.shiftKey ? "Shift+" : ""}${key} → 电源:${hp._state.isOn ? "ON" : "OFF"} 时间:${hp._state.main.value}h 身体:${hp._state.left.value}°C 脚部:${hp._state.right.value}°C`,
    );
  }
}

/** 调整温度值，处理 minWork 和 snap-to-zero 逻辑 */
function adjustTemp(stateRef, delta) {
  const { min, max, minWork } = stateRef;
  let val = stateRef.value;

  if (delta > 0) {
    // 增加温度
    if (val === 0) {
      val = minWork; // 从0直接跳到 minWork
    } else {
      val = Math.min(max, val + delta);
    }
  } else {
    // 减少温度
    if (val > 0 && val <= minWork) {
      val = 0; // 在 minWork 及以下时，减到0
    } else {
      val = Math.max(0, val + delta);
      if (val > 0 && val < minWork) val = 0; // snap to zero
    }
  }
  stateRef.value = val;
}

// ========== 范围配置（默认值，可密码修改） ==========
const currRange = {
  bodyOffMin: 0,
  bodyOffMax: 160,
  bodyOnMin: 2200,
  bodyOnMax: 2800,
  footOffMin: 0,
  footOffMax: 220,
  footOnMin: 1800,
  footOnMax: 2200,
  bodySensorMin: 18,
  bodySensorMax: 25,
  footSensorMin: 18,
  footSensorMax: 25,
};
const CURR_SETTINGS_PWD = "1234";

function showCurrSettings() {
  const pwd = prompt("请输入设置密码：");
  if (pwd !== CURR_SETTINGS_PWD) {
    alert("密码错误！");
    return;
  }
  const msg =
    `当前电流范围设置：\n\n` +
    `身体关电流范围: ${currRange.bodyOffMin} ~ ${currRange.bodyOffMax}  (最大可设 0~200)\n` +
    `身体加热电流范围: ${currRange.bodyOnMin} ~ ${currRange.bodyOnMax}  (最大可设 1200~3400)\n` +
    `脚关电流范围: ${currRange.footOffMin} ~ ${currRange.footOffMax}  (最大可设 0~200)\n` +
    `脚加热电流范围: ${currRange.footOnMin} ~ ${currRange.footOnMax}  (最大可设 1200~3400)\n\n` +
    `请输入新值（格式：min-max，如 0-100），不修改请按取消或留空。\n` +
    `示例身体关电流: ${currRange.bodyOffMin}-${currRange.bodyOffMax}`;
  const input = prompt(msg, `${currRange.bodyOffMin}-${currRange.bodyOffMax}`);
  if (!input) return;
  const parts = input.split("-").map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    if (parts[0] < 0 || parts[1] > 200) {
      alert("身体关电流范围超出最大限制 0~200！");
      return;
    }
    currRange.bodyOffMin = parts[0];
    currRange.bodyOffMax = parts[1];
  }
  const input2 = prompt(
    `身体加热电流范围 (最大 1200~3400):`,
    `${currRange.bodyOnMin}-${currRange.bodyOnMax}`,
  );
  if (input2) {
    const p2 = input2.split("-").map(Number);
    if (p2.length === 2 && !isNaN(p2[0]) && !isNaN(p2[1])) {
      if (p2[0] < 1200 || p2[1] > 3400) {
        alert("身体加热电流范围超出最大限制 1200~3400！");
        return;
      }
      currRange.bodyOnMin = p2[0];
      currRange.bodyOnMax = p2[1];
    }
  }
  const input3 = prompt(
    `脚关电流范围 (最大 0~200):`,
    `${currRange.footOffMin}-${currRange.footOffMax}`,
  );
  if (input3) {
    const p3 = input3.split("-").map(Number);
    if (p3.length === 2 && !isNaN(p3[0]) && !isNaN(p3[1])) {
      if (p3[0] < 0 || p3[1] > 200) {
        alert("脚关电流范围超出最大限制 0~200！");
        return;
      }
      currRange.footOffMin = p3[0];
      currRange.footOffMax = p3[1];
    }
  }
  const input4 = prompt(
    `脚加热电流范围 (最大 1200~3400):`,
    `${currRange.footOnMin}-${currRange.footOnMax}`,
  );
  if (input4) {
    const p4 = input4.split("-").map(Number);
    if (p4.length === 2 && !isNaN(p4[0]) && !isNaN(p4[1])) {
      if (p4[0] < 1200 || p4[1] > 3400) {
        alert("脚加热电流范围超出最大限制 1200~3400！");
        return;
      }
      currRange.footOnMin = p4[0];
      currRange.footOnMax = p4[1];
    }
  }
  const input5 = prompt(
    `身体温度传感器范围 (最大 0~60°C):`,
    `${currRange.bodySensorMin}-${currRange.bodySensorMax}`,
  );
  if (input5) {
    const p5 = input5.split("-").map(Number);
    if (p5.length === 2 && !isNaN(p5[0]) && !isNaN(p5[1])) {
      if (p5[0] < 0 || p5[1] > 60) {
        alert("身体温度传感器范围超出最大限制 0~60！");
        return;
      }
      currRange.bodySensorMin = p5[0];
      currRange.bodySensorMax = p5[1];
    }
  }
  const input6 = prompt(
    `脚温度传感器范围 (最大 0~50°C):`,
    `${currRange.footSensorMin}-${currRange.footSensorMax}`,
  );
  if (input6) {
    const p6 = input6.split("-").map(Number);
    if (p6.length === 2 && !isNaN(p6[0]) && !isNaN(p6[1])) {
      if (p6[0] < 0 || p6[1] > 60) {
        alert("脚温度传感器范围超出最大限制 0~60！");
        return;
      }
      currRange.footSensorMin = p6[0];
      currRange.footSensorMax = p6[1];
    }
  }
  bleAddLog(
    "info",
    `范围已更新: 电流-身体关:${currRange.bodyOffMin}-${currRange.bodyOffMax} 身体开:${currRange.bodyOnMin}-${currRange.bodyOnMax} 脚关:${currRange.footOffMin}-${currRange.footOffMax} 脚开:${currRange.footOnMin}-${currRange.footOnMax} 温度-身体:${currRange.bodySensorMin}-${currRange.bodySensorMax}°C 脚:${currRange.footSensorMin}-${currRange.footSensorMax}°C`,
  );
}

// 条码输入框监听：至少6位才使能测试按钮
function updateTestBtnState() {
  const barcode = document.getElementById("barcodeInput");
  const startBtn = document.getElementById("startTestBtn");
  const saveBtn = document.getElementById("saveTestBtn");
  const enabled = barcode && barcode.value.trim().length >= 6;
  if (startBtn) startBtn.disabled = !enabled;
  if (saveBtn) saveBtn.disabled = !enabled;
}

// 下载数据：通过统一 Stoov API 生成并返回 CSV
async function downloadData() {
  const url = "/api/stoov/test-data/download";
  const mode = currentTestMode || "external";
  const barcode = document.getElementById("barcodeInput")?.value || "";
  try {
    bleAddLog("info", `下载数据 → 模式:${mode} 条码:${barcode || "无"}`);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, barcode }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `heat-bed-test-${mode}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    bleAddLog("info", `数据下载完成 → heat-bed-test-${mode}.csv`);
  } catch (error) {
    bleAddLog("error", `下载数据失败: ${error.message}`);
  }
}

function bindEvents() {
  connectSerialBtn.addEventListener("click", connectSerial);
  startTimerBtn.addEventListener("click", setPeriodTimer);
  document
    .getElementById("startTestBtn")
    .addEventListener("click", () => startTest());
  document
    .getElementById("saveTestBtn")
    .addEventListener("click", () => saveTest());
  document
    .getElementById("downloadDataBtn")
    .addEventListener("click", downloadData);
  document
    .getElementById("barcodeInput")
    .addEventListener("input", updateTestBtnState);
  // 条码输入框：Enter键直接开始测试（需≥6位）
  document
    .getElementById("barcodeInput")
    .addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        if (this.value.trim().length >= 6) {
          startTest(false);
        }
      }
    });
  // 初始化加热面板事件监听
  setupHeatingPanelListener();
  // 注册全局键盘快捷键
  document.addEventListener("keydown", handleKeyboardShortcut);
  // document.getElementById('totalHours').addEventListener('change', updateTotalDuration);
  // document.getElementById('totalMinutes').addEventListener('change', updateTotalDuration);
  timerIntervalInput.addEventListener("keydown", async function (event) {
    if (event.key === "Enter") {
      event.preventDefault();

      const inputValue = parseInt(timerIntervalInput.value, 10) || 10; // 获取输入框的值
      const currentDisplayValue = getCurrentDisplayInterval(); // 获取按钮上当前显示的值

      console.log(
        `Input Value: ${inputValue}, Displayed Value: ${currentDisplayValue}`,
      ); // 用于调试

      // 判断输入值是否与当前显示值不同
      if (inputValue !== currentDisplayValue) {
        await setPeriodTimer(); // 只有不同时才执行
      } else {
        console.log("Value unchanged, skipping setPeriodTimer."); // 值未改变，跳过执行
      }
    }
  });
}
