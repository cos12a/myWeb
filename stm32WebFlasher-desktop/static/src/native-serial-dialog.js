// ---------------------------------------------------------------------------
// 桌面版原生串口「参数选择 + 设置」弹窗组件（独立、可复用）。
//
// 用法：
//   const session = await openNativeSerialDialog({
//     log,                                   // 可选：日志回调
//     getDebugRaw: () => checkbox.checked,   // 可选：传输层是否打印原始字节
//     defaults: { baudRate, parity },        // 可选：初始参数（来自主界面）
//   });
//   // session = { port, transport, settings }
//   //   port      : { path, getInfo } 描述对象（兼容原 Web Serial 端口形状）
//   //   transport : 已 open() 成功的 NativeSerialTransport，可直接交给上层复用
//   //   settings  : { portPath, baudRate, dataBits, stopBits, parity }
//   // 用户取消则 Promise 以 { cancelled: true } 拒绝。
//
// 交互约定：
//   - 点“确定”后由本组件真正打开串口；打开成功才关闭弹窗并交付传输层；
//   - 打开失败保持弹窗、就地显示失败原因，可调整参数再次尝试；
//   - “取消”/ESC/点遮罩退出（打开过程中禁用这些，避免中途丢会话）。
//
// 依赖：仅依赖同目录的 native-serial-transport.js（WS 桥传输层）与本地服务的
//   /api/serial/ports、/ws/serial 端点。不修改原项目，桌面版经补丁挂载。
// ---------------------------------------------------------------------------

import { NativeSerialTransport } from "./native-serial-transport.js?v=desktop";

const BAUD_RATES = [9600, 57600, 115200, 230400, 256000, 512000, 921600];
const DATA_BITS = [8, 7, 6, 5];
const STOP_BITS = [1, 2];
const PARITIES = [
  { value: "none", label: "无 None" },
  { value: "even", label: "偶校验 Even (STM32 协议必须)" },
  { value: "odd", label: "奇校验 Odd" },
];

async function listPortPaths() {
  const response = await fetch("/api/serial/ports");
  if (!response.ok) throw new Error(`串口枚举失败 HTTP ${response.status}`);
  const { ports } = await response.json();
  return Array.isArray(ports) ? ports.map((p) => p.path) : [];
}

// 组件自带样式，幂等注入一次，保证独立可复用（不依赖宿主页面额外 CSS）。
const STYLE_ID = "native-serial-dialog-style";
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .native-serial-dialog { min-width: 340px; max-width: 90vw; }
    .native-serial-dialog .nsd-row {
      display: flex; align-items: center; gap: 10px; margin: 10px 0;
    }
    .native-serial-dialog .nsd-label { flex: 0 0 64px; font-size: 13px; }
    .native-serial-dialog select {
      flex: 1 1 auto; padding: 6px 8px; border-radius: 6px;
      border: 1px solid var(--border-color, #cbd5e1); background: var(--card-bg, #fff);
      color: inherit;
    }
    .native-serial-dialog .nsd-port-row select { flex: 1 1 auto; }
    .native-serial-dialog .nsd-error {
      margin: 10px 0 0; min-height: 1em; color: #dc2626; font-size: 13px;
      white-space: pre-wrap; word-break: break-word;
    }
    .native-serial-dialog .nsd-actions {
      display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;
    }
  `;
  document.head.appendChild(style);
}

function buildOption(value, label, selected) {
  const option = document.createElement("option");
  option.value = String(value);
  option.textContent = label;
  if (selected) option.selected = true;
  return option;
}

function fillSelect(select, items) {
  select.textContent = "";
  for (const { value, label, selected } of items) {
    select.appendChild(buildOption(value, label, selected));
  }
}

export async function openNativeSerialDialog({
  log = () => {},
  getDebugRaw = () => false,
  defaults = {},
} = {}) {
  return new Promise((resolve, reject) => {
    ensureStyles();
    const initial = {
      baudRate: String(defaults.baudRate ?? "115200"),
      dataBits: String(defaults.dataBits ?? "8"),
      stopBits: String(defaults.stopBits ?? "1"),
      parity: String(defaults.parity ?? "even"),
    };

    const dialog = document.createElement("dialog");
    dialog.className = "circuit-dialog native-serial-dialog";

    dialog.innerHTML =
      '<div class="dialog-header"><h3>打开原生串口</h3></div>' +
      '<div class="dialog-body">' +
      '<div class="nsd-row nsd-port-row">' +
      '<span class="nsd-label">串口</span>' +
      '<select class="nsd-port" aria-label="串口"></select>' +
      '<button type="button" class="small-btn nsd-refresh" title="重新枚举本机串口">刷新</button>' +
      "</div>" +
      '<div class="nsd-row">' +
      '<span class="nsd-label">波特率</span>' +
      '<select class="nsd-baud" aria-label="波特率"></select>' +
      "</div>" +
      '<div class="nsd-row">' +
      '<span class="nsd-label">数据位</span>' +
      '<select class="nsd-databits" aria-label="数据位"></select>' +
      "</div>" +
      '<div class="nsd-row">' +
      '<span class="nsd-label">停止位</span>' +
      '<select class="nsd-stopbits" aria-label="停止位"></select>' +
      "</div>" +
      '<div class="nsd-row">' +
      '<span class="nsd-label">校验位</span>' +
      '<select class="nsd-parity" aria-label="校验位"></select>' +
      "</div>" +
      '<p class="nsd-error" role="alert"></p>' +
      '<div class="nsd-actions">' +
      '<button type="button" class="small-btn nsd-cancel">取消</button>' +
      '<button type="button" class="small-btn primary nsd-confirm">确定</button>' +
      "</div>" +
      "</div>";

    const portSelect = dialog.querySelector(".nsd-port");
    const baudSelect = dialog.querySelector(".nsd-baud");
    const dataBitsSelect = dialog.querySelector(".nsd-databits");
    const stopBitsSelect = dialog.querySelector(".nsd-stopbits");
    const paritySelect = dialog.querySelector(".nsd-parity");
    const refreshBtn = dialog.querySelector(".nsd-refresh");
    const cancelBtn = dialog.querySelector(".nsd-cancel");
    const confirmBtn = dialog.querySelector(".nsd-confirm");
    const errorEl = dialog.querySelector(".nsd-error");

    fillSelect(baudSelect, BAUD_RATES.map((b) => ({
      value: b,
      label: String(b),
      selected: String(b) === initial.baudRate,
    })));
    fillSelect(dataBitsSelect, DATA_BITS.map((d) => ({
      value: d,
      label: String(d),
      selected: String(d) === initial.dataBits,
    })));
    fillSelect(stopBitsSelect, STOP_BITS.map((s) => ({
      value: s,
      label: String(s),
      selected: String(s) === initial.stopBits,
    })));
    fillSelect(paritySelect, PARITIES.map((p) => ({
      value: p.value,
      label: p.label,
      selected: p.value === initial.parity,
    })));

    let settling = false; // 已决定结果（成功或取消），避免 close 事件重复处理
    let result = null; // 成功时的交付内容

    function setError(message) {
      errorEl.textContent = message || "";
      errorEl.hidden = !message;
    }

    function setBusy(busy) {
      confirmBtn.disabled = busy;
      cancelBtn.disabled = busy;
      refreshBtn.disabled = busy;
      portSelect.disabled = busy;
      baudSelect.disabled = busy;
      dataBitsSelect.disabled = busy;
      stopBitsSelect.disabled = busy;
      paritySelect.disabled = busy;
      confirmBtn.textContent = busy ? "打开中…" : "确定";
    }

    async function loadPorts(preserve) {
      setError("");
      const previous = preserve ? portSelect.value : "";
      try {
        const paths = await listPortPaths();
        if (!paths.length) {
          fillSelect(portSelect, [{ value: "", label: "未检测到可用串口", selected: true }]);
          return;
        }
        fillSelect(portSelect, paths.map((path) => ({
          value: path,
          label: path,
          selected: path === (previous || paths[0]),
        })));
      } catch (e) {
        fillSelect(portSelect, [{ value: "", label: `枚举失败：${e.message}`, selected: true }]);
      }
    }

    async function handleConfirm() {
      const path = portSelect.value;
      if (!path) {
        setError("请先选择有效的串口");
        return;
      }
      setError("");
      setBusy(true);

      const settings = {
        portPath: path,
        baudRate: Number(baudSelect.value),
        dataBits: Number(dataBitsSelect.value),
        stopBits: Number(stopBitsSelect.value),
        parity: paritySelect.value,
      };

      const port = { path, getInfo: () => ({}) };
      const transport = new NativeSerialTransport(port, log, getDebugRaw);
      try {
        await transport.open({
          baudRate: settings.baudRate,
          dataBits: settings.dataBits,
          stopBits: settings.stopBits,
          parity: settings.parity,
          flowControl: "none",
        });
        // 打开成功：交付已打开的传输层并关闭弹窗
        settling = true;
        result = { port, transport, settings };
        dialog.close();
      } catch (e) {
        // 打开失败：释放残留连接，保持弹窗，就地显示原因供重试
        await transport.close().catch(() => {});
        setError(`打开失败：${e.message}`);
        setBusy(false);
      }
    }

    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", () => dialog.close());
    refreshBtn.addEventListener("click", () => loadPorts(true));

    // ESC / 遮罩关闭：打开过程中禁止，其余情况视为取消
    dialog.addEventListener("cancel", (event) => {
      if (confirmBtn.disabled) event.preventDefault();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && !confirmBtn.disabled) dialog.close();
    });

    dialog.addEventListener("close", () => {
      dialog.remove();
      if (result) {
        resolve(result);
      } else if (!settling) {
        reject({ cancelled: true, message: "No port selected by the user" });
      }
    }, { once: true });

    document.body.appendChild(dialog);
    setBusy(false);
    setError("");
    loadPorts(false);
    dialog.showModal();
  });
}
