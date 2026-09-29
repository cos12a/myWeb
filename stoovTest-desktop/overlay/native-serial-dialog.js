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
  { value: "even", label: "偶校验 Even" },
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
    .native-serial-dialog {
      border: none; padding: 0; overflow: hidden;
      width: min(420px, 92vw); max-width: 92vw;
      border-radius: 14px;
      background: var(--bg-secondary, #161b22);
      color: var(--text-primary, #f0f6fc);
      box-shadow: 0 18px 50px rgba(0,0,0,.55), 0 0 0 1px var(--border-color, #30363d);
      font-size: 14px; line-height: 1.5;
    }
    .native-serial-dialog::backdrop {
      background: rgba(1,4,9,.6); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    }
    @keyframes nsd-pop { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
    .native-serial-dialog[open] { animation: nsd-pop .18s ease-out; }

    .native-serial-dialog .nsd-head {
      display: flex; align-items: center; gap: 12px; padding: 16px 18px;
      background: linear-gradient(135deg, rgba(88,166,255,.16), rgba(0,217,255,.10));
      border-bottom: 1px solid var(--border-color, #30363d);
    }
    .native-serial-dialog .nsd-head-icon {
      flex: 0 0 auto; width: 38px; height: 38px; border-radius: 10px;
      display: grid; place-items: center; color: var(--accent-blue, #58a6ff);
      background: var(--bg-card, #21262d); border: 1px solid var(--border-color, #30363d);
    }
    .native-serial-dialog .nsd-head-icon svg { width: 20px; height: 20px; display: block; }
    .native-serial-dialog .nsd-head-text { flex: 1 1 auto; min-width: 0; }
    .native-serial-dialog .nsd-title { margin: 0; font-size: 16px; font-weight: 600; }
    .native-serial-dialog .nsd-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--text-secondary, #8b949e); }
    .native-serial-dialog .nsd-close {
      flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; border: none;
      background: transparent; color: var(--text-secondary, #8b949e);
      font-size: 15px; cursor: pointer; display: grid; place-items: center; line-height: 1;
      transition: background .15s, color .15s;
    }
    .native-serial-dialog .nsd-close:hover { background: var(--bg-hover, #30363d); color: var(--text-primary, #f0f6fc); }

    .native-serial-dialog .nsd-body { padding: 16px 18px 4px; }
    .native-serial-dialog .nsd-field { margin-bottom: 14px; }
    .native-serial-dialog .nsd-grid .nsd-field { margin-bottom: 0; }
    .native-serial-dialog .nsd-label {
      display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600;
      letter-spacing: .3px; color: var(--text-secondary, #8b949e);
    }
    .native-serial-dialog .nsd-select-wrap { position: relative; }
    .native-serial-dialog .nsd-select-wrap::after {
      content: ""; position: absolute; right: 13px; top: 50%; width: 7px; height: 7px;
      border-right: 2px solid var(--text-muted, #6e7681); border-bottom: 2px solid var(--text-muted, #6e7681);
      transform: translateY(-70%) rotate(45deg); pointer-events: none;
    }
    .native-serial-dialog select {
      width: 100%; -webkit-appearance: none; appearance: none;
      padding: 9px 34px 9px 12px; border-radius: 9px; cursor: pointer;
      border: 1px solid var(--border-color, #30363d);
      background: var(--bg-input, #0d1117); color: var(--text-primary, #f0f6fc); font-size: 14px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      transition: border-color .15s, box-shadow .15s;
    }
    .native-serial-dialog select:hover:not(:disabled) { border-color: var(--accent-blue, #58a6ff); }
    .native-serial-dialog select:focus-visible {
      outline: none; border-color: var(--accent-blue, #58a6ff); box-shadow: 0 0 0 3px rgba(88,166,255,.25);
    }
    .native-serial-dialog select:disabled { opacity: .5; cursor: not-allowed; }
    .native-serial-dialog option { background: var(--bg-card, #21262d); color: var(--text-primary, #f0f6fc); }

    .native-serial-dialog .nsd-port-row { display: flex; align-items: stretch; gap: 8px; }
    .native-serial-dialog .nsd-port-row .nsd-select-wrap { flex: 1 1 auto; }
    .native-serial-dialog .nsd-refresh {
      flex: 0 0 auto; min-width: 44px; padding: 0 12px; border-radius: 9px; font-size: 16px; cursor: pointer;
      border: 1px solid var(--border-color, #30363d); background: var(--bg-card, #21262d);
      color: var(--text-secondary, #8b949e); transition: color .15s, border-color .15s;
    }
    .native-serial-dialog .nsd-refresh:hover:not(:disabled) { color: var(--accent-blue, #58a6ff); border-color: var(--accent-blue, #58a6ff); }
    .native-serial-dialog .nsd-refresh:disabled { opacity: .5; cursor: not-allowed; }

    .native-serial-dialog .nsd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 380px) { .native-serial-dialog .nsd-grid { grid-template-columns: 1fr; } }

    .native-serial-dialog .nsd-hint { margin: 10px 0 0; font-size: 12px; color: var(--text-muted, #6e7681); }

    .native-serial-dialog .nsd-error {
      display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; padding: 9px 11px;
      border-radius: 9px; font-size: 13px; white-space: pre-wrap; word-break: break-word;
      color: var(--accent-red, #f85149); background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.35);
    }
    .native-serial-dialog .nsd-error[hidden] { display: none; }
    .native-serial-dialog .nsd-error::before { content: "⚠"; font-weight: 700; }

    .native-serial-dialog .nsd-actions {
      display: flex; justify-content: flex-end; gap: 10px; padding: 16px 18px; margin-top: 6px;
      border-top: 1px solid var(--border-color, #30363d);
    }
    .native-serial-dialog .nsd-cancel, .native-serial-dialog .nsd-confirm {
      padding: 9px 18px; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer;
      border: 1px solid transparent; transition: filter .15s, transform .12s, background .15s, color .15s, opacity .15s;
    }
    .native-serial-dialog .nsd-cancel {
      background: transparent; border-color: var(--border-color, #30363d); color: var(--text-secondary, #8b949e);
    }
    .native-serial-dialog .nsd-cancel:hover:not(:disabled) { background: var(--bg-hover, #30363d); color: var(--text-primary, #f0f6fc); }
    .native-serial-dialog .nsd-confirm {
      background: linear-gradient(135deg, var(--btn-primary, #238636), var(--btn-primary-hover, #2ea043));
      color: #fff; box-shadow: 0 4px 12px rgba(46,160,67,.3);
    }
    .native-serial-dialog .nsd-confirm:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
    .native-serial-dialog .nsd-confirm:active:not(:disabled) { transform: none; }
    .native-serial-dialog .nsd-cancel:disabled, .native-serial-dialog .nsd-confirm:disabled {
      opacity: .6; cursor: not-allowed; box-shadow: none; transform: none;
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
    dialog.className = "native-serial-dialog";

    dialog.innerHTML =
      '<div class="nsd-head">' +
      '<div class="nsd-head-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="7" width="12" height="7" rx="3"/><path d="M9.5 2v4"/><path d="M14.5 2v4"/><path d="M12 14v6"/></svg></div>' +
      '<div class="nsd-head-text">' +
      '<h3 class="nsd-title">打开设备串口</h3>' +
      '<p class="nsd-subtitle">选择端口并配置串口参数</p>' +
      "</div>" +
      '<button type="button" class="nsd-close" aria-label="关闭">✕</button>' +
      "</div>" +
      '<div class="nsd-body">' +
      '<div class="nsd-field">' +
      '<label class="nsd-label">串口</label>' +
      '<div class="nsd-port-row">' +
      '<div class="nsd-select-wrap"><select class="nsd-port" aria-label="串口"></select></div>' +
      '<button type="button" class="nsd-refresh" title="重新枚举本机串口" aria-label="刷新串口列表">↻</button>' +
      "</div>" +
      "</div>" +
      '<div class="nsd-grid">' +
      '<div class="nsd-field"><label class="nsd-label">波特率</label>' +
      '<div class="nsd-select-wrap"><select class="nsd-baud" aria-label="波特率"></select></div></div>' +
      '<div class="nsd-field"><label class="nsd-label">数据位</label>' +
      '<div class="nsd-select-wrap"><select class="nsd-databits" aria-label="数据位"></select></div></div>' +
      '<div class="nsd-field"><label class="nsd-label">停止位</label>' +
      '<div class="nsd-select-wrap"><select class="nsd-stopbits" aria-label="停止位"></select></div></div>' +
      '<div class="nsd-field"><label class="nsd-label">校验位</label>' +
      '<div class="nsd-select-wrap"><select class="nsd-parity" aria-label="校验位"></select></div></div>' +
      "</div>" +
      '<p class="nsd-hint">提示：STM32 串口协议需使用「偶校验 Even」。</p>' +
      '<p class="nsd-error" role="alert"></p>' +
      "</div>" +
      '<div class="nsd-actions">' +
      '<button type="button" class="nsd-cancel">取消</button>' +
      '<button type="button" class="nsd-confirm">确定</button>' +
      "</div>";

    const portSelect = dialog.querySelector(".nsd-port");
    const baudSelect = dialog.querySelector(".nsd-baud");
    const dataBitsSelect = dialog.querySelector(".nsd-databits");
    const stopBitsSelect = dialog.querySelector(".nsd-stopbits");
    const paritySelect = dialog.querySelector(".nsd-parity");
    const refreshBtn = dialog.querySelector(".nsd-refresh");
    const closeBtn = dialog.querySelector(".nsd-close");
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
    // 头部关闭按钮：与取消等价，但打开过程中禁用（与 ESC/遮罩守卫一致）
    closeBtn.addEventListener("click", () => {
      if (!confirmBtn.disabled) dialog.close();
    });

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
