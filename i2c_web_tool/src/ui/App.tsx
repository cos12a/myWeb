import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import type {
  Ch224RequestResult,
  Ch224Snapshot,
  DeviceStatus,
  HistoryEntry,
  I2cBusConfig,
  I2cBusConfigPatch,
  I2cCapabilities,
  I2cReportFrame,
  I2cReportTask,
  I2cStreamFrame,
  I2cStreamRequest,
  Lis3dhConfig,
  Lis3dhSample,
  ScanResult,
  Theme,
  TransferResult,
  TransportDevice,
  TransportKind,
} from "../types.ts";
import AutoReportPanel from "./AutoReportPanel.tsx";
import BusConfigPanel from "./BusConfigPanel.tsx";
import Ch224Panel from "./Ch224Panel.tsx";
import Lis3dhPanel from "./Lis3dhPanel.tsx";
import Mlx90614Panel from "./Mlx90614Panel.tsx";

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const EEPROM_OPTIONS = [
  { id: 0, label: "24C01 · 128 B" },
  { id: 1, label: "24C02 · 256 B" },
  { id: 2, label: "24C04 · 512 B" },
  { id: 3, label: "24C08 · 1 KB" },
  { id: 4, label: "24C16 · 2 KB" },
  { id: 5, label: "24C32 · 4 KB" },
  { id: 6, label: "24C64 · 8 KB" },
  { id: 7, label: "24C128 · 16 KB" },
  { id: 8, label: "24C256 · 32 KB" },
  { id: 9, label: "24C512 · 64 KB" },
  { id: 10, label: "24C1024 · 128 KB" },
  { id: 11, label: "24C2048 · 256 KB" },
  { id: 12, label: "24C4096 · 512 KB" },
];

const EMPTY_STATUS: DeviceStatus = {
  connected: false,
  kind: null,
  port: null,
  baud: null,
  crcErrors: 0,
  frames: 0,
};

/** 传输种类的中文展称；未连接时默认串口，兼容旧文案。 */
function transportName(kind: TransportKind | null): string {
  if (kind === "ble") return "蓝牙";
  if (kind === "usb") return "USB";
  return "串口";
}

function numberFrom(value: string, fallback = 0): number {
  const parsed = value.trim().toLowerCase().startsWith("0x")
    ? Number.parseInt(value, 16)
    : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hex(value: number, digits = 2): string {
  return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
}

function formatFrequency(hz: number): string {
  if (hz >= 1_000_000) {
    const mhz = hz / 1_000_000;
    return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(2)} MHz`;
  }
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function initialTheme(): Theme {
  try {
    return localStorage.getItem("i2c-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function App() {
  const [activePage, setActivePage] = useState<
    "i2c" | "ch224" | "mlx" | "lis3dh" | "report"
  >("i2c");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [status, setStatus] = useState<DeviceStatus>(EMPTY_STATUS);
  const transports = useMemo(() => api.transports(), []);
  const [transportKind, setTransportKind] = useState<TransportKind>("serial");
  const [devices, setDevices] = useState<TransportDevice[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const [address, setAddress] = useState("0x50");
  const [register, setRegister] = useState("0x00");
  const [writeValue, setWriteValue] = useState("0x00");
  const [scanStart, setScanStart] = useState("0x08");
  const [scanEnd, setScanEnd] = useState("0x77");
  const [rawWrite, setRawWrite] = useState("AA 74 80 A0 80 00 75 00");
  const [rawReadLength, setRawReadLength] = useState("0");
  const [eepromType, setEepromType] = useState(1);
  const [eepromOffset, setEepromOffset] = useState("0x00");
  const [eepromLength, setEepromLength] = useState("16");
  const [eepromWriteData, setEepromWriteData] = useState("AA BB CC DD");
  const [activeTab, setActiveTab] = useState<"register" | "raw" | "eeprom">(
    "register",
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [transferResult, setTransferResult] = useState<TransferResult | null>(
    null,
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busConfig, setBusConfig] = useState<I2cBusConfig | null>(null);
  const [busCapabilities, setBusCapabilities] =
    useState<I2cCapabilities | null>(null);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus(EMPTY_STATUS);
    }
  }, []);

  /**
   * 连接后读取当前引脚/频率与芯片能力；任一步失败都不阻断连接，
   * 参数面板会自动降级为“自由引脚/未上报能力”。
   */
  const loadBusInfo = useCallback(async () => {
    try {
      setBusConfig(await api.readBusConfig());
    } catch {
      setBusConfig(null);
    }
    try {
      setBusCapabilities(await api.readBusCapabilities());
    } catch {
      setBusCapabilities(null);
    }
  }, []);

  // 断开（主动或被动）后清空参数，避免旧配置误导下次连接。
  useEffect(() => {
    if (status.connected) return;
    setBusConfig(null);
    setBusCapabilities(null);
  }, [status.connected]);

  const transportKindRef = useRef(transportKind);
  useEffect(() => {
    transportKindRef.current = transportKind;
  }, [transportKind]);

  const refreshDevices = useCallback(
    async (kind: TransportKind, announce = false) => {
      setRefreshingDevices(true);
      try {
        const list = await api.devices(kind);
        setDevices(list);
        setDeviceId((current) =>
          list.some((device) => device.id === current)
            ? current
            : list[0]?.id ?? ""
        );
      } catch (error) {
        // 浏览器缺少对应硬件 API 时不阻断页面，由能力提示体现。
        setDevices([]);
        if (announce) {
          notify(error instanceof Error ? error.message : "枚举设备失败。");
        }
      } finally {
        setRefreshingDevices(false);
      }
    },
    [notify],
  );

  /** 浏览器设备授权必须发生在用户手势中。 */
  const chooseDevice = async () => {
    if (busy) return;
    try {
      const device = await api.requestDevice(transportKind);
      await refreshDevices(transportKind);
      setDeviceId(device.id);
      record(
        `授权${transportName(transportKind)}`,
        device.label,
        "已加入设备列表",
        true,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      notify(error instanceof Error ? error.message : "选择设备失败。");
    }
  };

  useEffect(() => {
    void refreshStatus();
    void refreshDevices(transportKind);
    const stop = api.watchTransportEvents((event) => {
      if (event.type === "disconnected") {
        void (async () => {
          if (statusRef.current.connected) await api.disconnect();
          await refreshStatus();
          await refreshDevices(transportKindRef.current);
        })();
      } else if (event.kind === transportKindRef.current) {
        void refreshDevices(event.kind);
      }
    });
    return stop;
    // 仅在挂载/切换传输时订阅：其余状态由回调自行刷新。
  }, [refreshStatus, refreshDevices, transportKind]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("i2c-theme", theme);
    } catch {
      // Theme remains available for this session when storage is disabled.
    }
  }, [theme]);

  const record = useCallback(
    (operation: string, detail: string, result: string, ok: boolean) => {
      setHistory((current) => [{
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        operation,
        detail,
        result,
        ok,
      }, ...current].slice(0, 100));
    },
    [],
  );

  const busyRef = useRef(false);

  const run = useCallback(
    async <T,>(
      operation: string,
      detail: string,
      action: () => Promise<T>,
      describe: (value: T) => string,
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const value = await action();
        const result = describe(value);
        record(operation, detail, result, true);
        await refreshStatus();
        return value;
      } catch (error) {
        const message = error instanceof Error ? error.message : "操作失败。";
        record(operation, detail, message, false);
        notify(message);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [notify, record, refreshStatus],
  );

  const activeTransport = transports.find((item) =>
    item.kind === transportKind
  );
  const transportLabel = activeTransport?.label ?? transportName(transportKind);
  const selectedDevice = devices?.find((device) => device.id === deviceId);
  const connectionLabel = status.connected
    ? `${transportName(status.kind)}已连接`
    : "未连接设备";

  const toggleConnection = async () => {
    if (status.connected) {
      const current = transportName(status.kind);
      await run(
        `断开${current}`,
        status.port ?? selectedDevice?.label ?? current,
        api.disconnect,
        () => "已安全断开",
      );
      return;
    }
    if (!deviceId) {
      notify(`请先选择并授权一个${transportLabel}设备。`);
      return;
    }
    const baud = activeTransport?.supportsBaudRate ? baudRate : undefined;
    await run(
      `连接${transportLabel}`,
      `${selectedDevice?.label ?? deviceId}${baud ? ` · ${baud} bps` : ""} · LWPKT 握手`,
      async () => {
        const value = await api.connect({
          kind: transportKind,
          deviceId,
          baudRate: baud,
        });
        // 在 busy 窗口内读取参数/能力，避免用户抢点击触发“已有请求”。
        await loadBusInfo();
        return value;
      },
      () => "连接成功，ECHO 握手通过",
    );
  };

  const scan = async () => {
    const start = numberFrom(scanStart, 0x08);
    const end = numberFrom(scanEnd, 0x77);
    const result = await run(
      "总线扫描",
      `${hex(start)} – ${hex(end)}`,
      () => api.scan(start, end),
      (value) => `发现 ${value.addresses.length} 个设备`,
    );
    if (result) setScanResult(result);
  };

  const applyBusConfig = async (patch: I2cBusConfigPatch) => {
    const result = await run(
      "设置 I²C 参数",
      `SDA ${patch.sda ?? "—"} · SCL ${patch.scl ?? "—"} · ${formatFrequency(patch.freqHz ?? 0)}`,
      () => api.configureBus(patch),
      (value) =>
        `SDA ${value.sda} · SCL ${value.scl} · ${formatFrequency(value.freqHz)}`,
    );
    if (!result) return;
    setBusConfig(result);
    // 引脚/频率变了，旧扫描结果不再可信。
    setScanResult(null);
  };

  const applyBusScheme = async (
    instance: number,
    scheme: number,
    freqHz: number,
  ) => {
    const result = await run(
      "切换 I²C 实例",
      `I2C${instance} · 方案 ${scheme} · ${formatFrequency(freqHz)}`,
      () => api.selectBus(instance, scheme, freqHz),
      (value) =>
        `I2C${value.busId ?? instance} · SDA ${value.sda} · SCL ${value.scl} · ${
          formatFrequency(value.freqHz)
        }`,
    );
    if (!result) return;
    setBusConfig(result);
    setScanResult(null);
  };

  const swapBusPins = async () => {
    const result = await run(
      "交换 SDA/SCL",
      "重建 I²C 总线",
      api.swapBusPins,
      (value) => `SDA ${value.sda} · SCL ${value.scl}`,
    );
    if (!result) return;
    setBusConfig((current) =>
      current ? { ...current, sda: result.sda, scl: result.scl } : current
    );
    setScanResult(null);
  };

  const recoverBus = () =>
    run(
      "总线恢复",
      "释放引脚 + 9 个 SCL 脉冲",
      api.recoverBus,
      () => "总线已恢复",
    );

  const readRegister = async () => {
    const addr = numberFrom(address);
    const reg = numberFrom(register);
    const result = await run(
      "寄存器读取",
      `${hex(addr)} / ${hex(reg)}`,
      () => api.read(addr, reg),
      (value) => hex(value.value),
    );
    if (result) setWriteValue(hex(result.value));
  };

  const writeRegister = () =>
    run(
      "寄存器写入",
      `${hex(numberFrom(address))} / ${hex(numberFrom(register))}`,
      () =>
        api.write(
          numberFrom(address),
          numberFrom(register),
          numberFrom(writeValue),
        ),
      () => "写入成功",
    );

  const rawTransfer = async () => {
    const result = await run(
      "原始 I²C 传输",
      `${rawWrite || "无发送"} · 读取 ${numberFrom(rawReadLength)} B`,
      () => api.transfer(rawWrite, numberFrom(rawReadLength)),
      (value) => value.hex || "无返回数据",
    );
    if (result) setTransferResult(result);
  };

  const readEeprom = async () => {
    const offset = numberFrom(eepromOffset);
    const length = numberFrom(eepromLength);
    const eepromName = EEPROM_OPTIONS[eepromType]?.label ?? "24Cxx";
    const result = await run(
      "EEPROM 读取",
      `${eepromName} · ${hex(offset, 4)} · ${length} B`,
      () => api.eepromRead(eepromType, offset, length),
      (value) => value.hex || "读取完成",
    );
    if (result) setTransferResult(result);
  };

  const writeEeprom = () => {
    const eepromName = EEPROM_OPTIONS[eepromType]?.label ?? "24Cxx";
    return run(
      "EEPROM 写入",
      `${eepromName} · ${hex(numberFrom(eepromOffset), 4)}`,
      () =>
        api.eepromWrite(
          eepromType,
          numberFrom(eepromOffset),
          eepromWriteData,
        ),
      () => "写入成功",
    );
  };

  const discoverCh224 = () =>
    run(
      "扫描 CH224A",
      "I²C 地址 0x22–0x23",
      api.ch224Discover,
      (value) =>
        `发现 ${value.addresses.map((item) => hex(item)).join(", ") || "未发现"}`,
    );

  const listCh224Registers = useCallback(async () => {
    try {
      return await api.ch224Registers();
    } catch {
      return undefined;
    }
  }, []);

  const readCh224Capabilities = (address: number) =>
    run(
      "读取 CH224A PD 能力",
      hex(address),
      () => api.ch224Capabilities(address),
      (value) => value.message,
    );

  const readCh224Register = (address: number, registerAddress: number) =>
    run(
      "读取 CH224A 寄存器",
      `${hex(address)} / ${hex(registerAddress)}`,
      () => api.ch224ReadRegister(address, registerAddress),
      (value) => `${value.hex} · ${value.name}`,
    );

  const writeCh224Register = (
    address: number,
    registerAddress: number,
    value: number,
  ) =>
    run(
      "写入 CH224A 寄存器",
      `${hex(address)} / ${hex(registerAddress)} ← ${hex(value)}`,
      () => api.ch224WriteRegister(address, registerAddress, value),
      (result) =>
        result.writeOnly
          ? `已写入只写寄存器 ${hex(registerAddress)}`
          : `回读 ${hex(result.readBack ?? 0)}${
            result.matches ? " · 一致" : " · 不一致"
          }`,
    );

  const requestCh224Power = (
    address: number,
    mode: "fixed" | "pps" | "avs" | "qc",
    voltage: number,
  ) =>
    run(
      "请求 CH224 取电",
      mode === "fixed"
        ? `${hex(address)} · ${voltage} V 固定 PDO`
        : mode === "qc"
        ? `${hex(address)} · QC/其它协议 ${voltage} V`
        : mode === "pps"
        ? `${hex(address)} · PPS ${(voltage / 1000).toFixed(2)} V`
        : `${hex(address)} · AVS ${(voltage / 1000).toFixed(2)} V`,
      () => api.ch224RequestPower(address, mode, voltage),
      (value) => value.message,
    );

  const listMlxRegisters = useCallback(async () => {
    try {
      return await api.mlxRegisters();
    } catch {
      return undefined;
    }
  }, []);

  // 温度轮询：不经过 run()，避免每次自动读取都写操作记录并闪烁 busy。
  const pollMlxTemperature = useCallback(
    async (address: number, register: number) => {
      try {
        return await api.mlxReadTemperature(address, register);
      } catch {
        return undefined;
      }
    },
    [],
  );

  const discoverMlx = () =>
    run(
      "扫描 MLX90614",
      "I²C 地址 0x5A",
      api.mlxDiscover,
      (value) =>
        `发现 ${value.addresses.map((item) => hex(item)).join(", ") || "未发现"}`,
    );

  const readMlxRegister = (address: number, registerAddress: number) =>
    run(
      "读取 MLX90614 寄存器",
      `${hex(address)} / ${hex(registerAddress)}`,
      () => api.mlxReadRegister(address, registerAddress),
      (value) => `${value.detail.hex} · ${value.detail.name}`,
    );

  const writeMlxRegister = (
    address: number,
    registerAddress: number,
    value: number,
  ) =>
    run(
      "写入 MLX90614 寄存器",
      `${hex(address)} / ${hex(registerAddress)} ← 0x${
        (value & 0xffff).toString(16).toUpperCase().padStart(4, "0")
      }`,
      () => api.mlxWriteRegister(address, registerAddress, value),
      (result) => result.message,
    );

  const readLis3dhTemperature = useCallback(async (address: number) => {
    try {
      return await api.lis3dhReadTemperature(address);
    } catch {
      return undefined;
    }
  }, []);

  const listLis3dhRegisters = useCallback(async () => {
    try {
      return await api.lis3dhRegisters();
    } catch {
      return undefined;
    }
  }, []);

  /** FIFO 批量读：一次事务带回多组样本。 */
  const readLis3dhFifoBatch = useCallback(
    async (
      address: number,
      fullScale: number,
      maxSamples: number,
      odrHz: number,
    ) => {
      try {
        return await api.lis3dhFifoBatch(address, fullScale, maxSamples, odrHz);
      } catch {
        return undefined;
      }
    },
    [],
  );

  const resetLis3dhFifo = useCallback(async (address: number) => {
    try {
      await api.lis3dhResetFifo(address);
    } catch {
      // FIFO 复位失败不打断采集流程。
    }
  }, []);

  const getLis3dhFifoHint = useCallback(
    (odrCode: number, outputMode: string, threshold?: number) =>
      api.lis3dhFifoHint(odrCode, outputMode, threshold),
    [],
  );

  // 中断推送启动失败时抛错，由面板转换为带协议文档指引的提示。
  const startLis3dhStream = useCallback(
    (request: I2cStreamRequest) => api.lis3dhStartStream(request),
    [],
  );

  const stopLis3dhStream = useCallback(async () => {
    try {
      return await api.lis3dhStopStream();
    } catch {
      return undefined;
    }
  }, []);

  const subscribeLis3dhStream = useCallback(
    (
      listener: (sample: Lis3dhSample, frame: I2cStreamFrame) => void,
      fullScale: number,
    ) => api.lis3dhSubscribeStream(listener, fullScale),
    [],
  );

  /** LIS3DH 页「周期上报」模式：只接收指定槽位的 REPORT_DATA 帧。 */
  const subscribeLis3dhReport = useCallback(
    (
      taskId: number,
      listener: (sample: Lis3dhSample, frame: I2cReportFrame) => void,
      fullScale: number,
    ) => api.lis3dhSubscribeReport(taskId, listener, fullScale),
    [],
  );

  // 周期自动上报：配置 / 启动失败直接抛错，由面板给出协议指引式提示。
  const configureAutoReport = useCallback(
    (task: I2cReportTask) => api.autoReportConfigure(task),
    [],
  );

  const startAutoReport = useCallback(
    (taskId?: number) => api.autoReportStart(taskId),
    [],
  );

  const stopAutoReport = useCallback(
    (taskId?: number) => api.autoReportStop(taskId),
    [],
  );

  const queryAutoReport = useCallback(() => api.autoReportStatus(), []);

  const clearAutoReport = useCallback(() => api.autoReportClear(), []);

  const subscribeAutoReport = useCallback(
    (listener: (frame: I2cReportFrame) => void) =>
      api.autoReportSubscribe(listener),
    [],
  );

  // 三轴采样：走 100 ms 轮询，不写操作记录也不闪 busy。
  const pollLis3dhSample = useCallback(
    async (address: number, fullScale: number) => {
      try {
        return await api.lis3dhReadSample(address, fullScale);
      } catch {
        return undefined;
      }
    },
    [],
  );

  const discoverLis3dh = () =>
    run(
      "扫描 LIS3DH",
      "I²C 地址 0x18 / 0x19",
      api.lis3dhDiscover,
      (value) =>
        value.devices.length === 0
          ? "0x18 / 0x19 无应答"
          : value.devices.map((item) =>
            `${hex(item.address)} · WHO_AM_I ${
              item.whoAmI === null ? "读失败" : hex(item.whoAmI)
            }`
          ).join("；"),
    );

  const configureLis3dh = (address: number, config: Lis3dhConfig) =>
    run(
      "配置 LIS3DH",
      `${hex(address)} · FS ${config.fullScale} · ODR ${config.odrCode} · ${config.outputMode}`,
      () => api.lis3dhConfigure(address, config),
      (value) => value.message,
    );

  const readLis3dhRegister = (address: number, registerAddress: number) =>
    run(
      "读取 LIS3DH 寄存器",
      `${hex(address)} / ${hex(registerAddress)}`,
      () => api.lis3dhReadRegister(address, registerAddress),
      (value) => `${value.detail.hex} · ${value.detail.name}`,
    );

  const writeLis3dhRegister = (
    address: number,
    registerAddress: number,
    value: number,
  ) =>
    run(
      "写入 LIS3DH 寄存器",
      `${hex(address)} / ${hex(registerAddress)} ← ${hex(value)}`,
      () => api.lis3dhWriteRegister(address, registerAddress, value),
      (result) => result.message,
    );

  const exportHistory = () => {
    const file = new Blob([JSON.stringify(history, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = `i2c-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const addressPills = useMemo(
    () => scanResult?.addresses ?? [],
    [scanResult],
  );

  const deviceLabel = status.port ?? selectedDevice?.label ?? "—";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span>⌁</span></div>
          <div>
            <div className="brand-name">I²C <span>WEB TOOL</span></div>
            <div className="brand-subtitle">WEB SERIAL / BLUETOOTH WORKBENCH</div>
          </div>
        </div>
        <div className="topbar-right">
          <div className={`connection-chip ${status.connected ? "online" : ""}`}>
            <i />
            <span>{connectionLabel}</span>
            {status.connected && <b>{deviceLabel}</b>}
          </div>
          <button
            className="icon-button theme-button"
            title={theme === "dark" ? "切换亮色主题" : "切换暗色主题"}
            aria-label={theme === "dark" ? "切换亮色主题" : "切换暗色主题"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☼" : "☾"}
          </button>
        </div>
      </header>

      <section className="intro-row">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> 浏览器串口 / 蓝牙工作台
          </div>
          <h1>
            {activePage === "i2c"
              ? "把总线，掌握在手中"
              : activePage === "mlx"
              ? "MLX90614 红外测温"
              : activePage === "lis3dh"
              ? "LIS3DH 三轴加速度"
              : activePage === "report"
              ? "周期自动上报"
              : "CH224A PD 取电控制"}
            <span>.</span>
          </h1>
          <p>
            {activePage === "i2c"
              ? "Web Serial / Web Bluetooth 直连 ESP32-Bus-Pirate，连接、探索并精确控制 I²C 设备。"
              : activePage === "mlx"
              ? "读取物体与环境温度、手动读写 16 位寄存器，支持自动轮询与曲线。"
              : activePage === "lis3dh"
              ? "轮询 / FIFO 批量 / 中断推送三种读取模式，立体显示姿态，可配置输出模式与 ODR。"
              : activePage === "report"
              ? "设备端按间隔自读寄存器并主动推帧，最多 16 个任务槽位并行；主机只收数据，不轮询。"
              : "读取电源能力、核验支持档位，再安全请求 USB-C PD 电压。"}
          </p>
        </div>
        <div className="intro-badge">
          <span>Serial / BLE</span><i /> {activePage === "i2c"
            ? "CTRL · I²C"
            : activePage === "mlx"
            ? "SMBus · MLX90614"
            : activePage === "lis3dh"
            ? "I²C · LIS3DH"
            : activePage === "report"
            ? "REPORT · AR-1.0"
            : "I²C · CH224A"}
        </div>
      </section>

      <nav className="protocol-nav" aria-label="功能页面">
        <button
          type="button"
          className={activePage === "i2c" ? "active" : ""}
          aria-current={activePage === "i2c" ? "page" : undefined}
          onClick={() => setActivePage("i2c")}
        >
          I²C 操作台
        </button>
        <button
          type="button"
          className={activePage === "ch224" ? "active" : ""}
          aria-current={activePage === "ch224" ? "page" : undefined}
          onClick={() => setActivePage("ch224")}
        >
          CH224A PD 取电
        </button>
        <button
          type="button"
          className={activePage === "mlx" ? "active" : ""}
          aria-current={activePage === "mlx" ? "page" : undefined}
          onClick={() => setActivePage("mlx")}
        >
          MLX90614 测温
        </button>
        <button
          type="button"
          className={activePage === "lis3dh" ? "active" : ""}
          aria-current={activePage === "lis3dh" ? "page" : undefined}
          onClick={() => setActivePage("lis3dh")}
        >
          LIS3DH 加速度计
        </button>
        <button
          type="button"
          className={activePage === "report" ? "active" : ""}
          aria-current={activePage === "report" ? "page" : undefined}
          onClick={() => setActivePage("report")}
        >
          周期自动上报
        </button>
      </nav>

      {activePage === "i2c" ? <>
        <div className="workspace">
          <aside className="sidebar">
            <section className="panel connection-panel">
              <div className="section-heading">
                <div className="section-icon usb-icon">⌁</div>
                <div>
                  <h2>设备连接</h2>
                  <p>ESP32-Bus-Pirate · Web Serial / Web Bluetooth</p>
                </div>
                <span
                  className={`status-dot ${status.connected ? "live" : ""}`}
                />
              </div>
              <div
                className="transport-switch"
                role="group"
                aria-label="连接方式"
              >
                {transports.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    className={item.kind === transportKind ? "selected" : ""}
                    disabled={status.connected || busy || !item.available}
                    title={item.available
                      ? `通过${item.label}连接`
                      : `当前浏览器不支持${item.label}（需 Chrome/Edge + https/localhost）`}
                    onClick={() => setTransportKind(item.kind)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {activeTransport && !activeTransport.available && (
                <div className="connection-note warning">
                  <span>!</span>{" "}
                  当前浏览器不支持{activeTransport.label}：请使用 Chrome / Edge
                  并通过 https 或 localhost 访问
                </div>
              )}
              <div className="device-index-heading">
                <label className="field-label" htmlFor="transport-device">
                  {transportLabel}
                </label>
                <button
                  className="text-button device-refresh"
                  type="button"
                  disabled={busy || refreshingDevices ||
                    !activeTransport?.available}
                  onClick={() => void refreshDevices(transportKind, true)}
                >
                  {refreshingDevices ? "查找中…" : "↻ 刷新"}
                </button>
              </div>
              <div className="input-with-suffix">
                <select
                  id="transport-device"
                  value={deviceId}
                  disabled={status.connected || devices === null}
                  onChange={(event) => setDeviceId(event.target.value)}
                >
                  {devices === null
                    ? <option value="">加载中…</option>
                    : devices.length === 0
                    ? (
                      <option value="">
                        {transportKind === "ble"
                          ? "未发现 BUS 开头的蓝牙设备"
                          : `尚未授权任何${transportLabel}设备`}
                      </option>
                    )
                    : devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                </select>
                <span>{transportKind === "ble" ? "BLE" : "PORT"}</span>
              </div>
              <button
                className="button secondary full-button choose-port-button"
                type="button"
                disabled={busy || !activeTransport?.available}
                onClick={() => void chooseDevice()}
              >
                ＋ 选择{transportLabel}设备（浏览器授权）
              </button>
              {activeTransport?.supportsBaudRate && (
                <>
                  <label className="field-label speed-label">波特率</label>
                  <div className="input-with-suffix">
                    <select
                      value={baudRate}
                      disabled={status.connected}
                      onChange={(event) =>
                        setBaudRate(Number(event.target.value))}
                    >
                      {BAUD_OPTIONS.map((baud) => (
                        <option key={baud} value={baud}>{baud} bps</option>
                      ))}
                    </select>
                    <span>BAUD</span>
                  </div>
                </>
              )}
              {status.connected && (
                <div className="device-meta">
                  <div>
                    <span>传输</span>
                    <b>{transportName(status.kind)}</b>
                  </div>
                  <div><span>设备</span><b>{deviceLabel}</b></div>
                  {status.kind === "serial" && (
                    <div>
                      <span>波特率</span>
                      <b>{status.baud ?? "—"}</b>
                    </div>
                  )}
                  <div><span>CRC 错帧</span><b>{status.crcErrors}</b></div>
                </div>
              )}
              <button
                className={`button primary connect-button ${
                  status.connected ? "disconnect-button" : ""
                }`}
                disabled={busy ||
                  (!status.connected && (!deviceId || !activeTransport?.available))}
                onClick={() => void toggleConnection()}
              >
                <span>{status.connected ? "↗" : "⌁"}</span>
                {busy
                  ? "正在操作…"
                  : status.connected
                  ? "断开设备"
                  : `连接${transportLabel}`}
              </button>
              <div className="connection-note">
                <span>i</span>{" "}
                {activeTransport?.supportsBaudRate
                  ? "固件 UART2 默认 115200 8N1；连接时自动 ECHO 握手校验帧/CRC"
                  : "仅列出名称以 BUS 开头的蓝牙设备；走 NUS 串口服务，默认 20 字节分片"}
              </div>
            </section>

            <BusConfigPanel
              connected={status.connected}
              busy={busy}
              config={busConfig}
              capabilities={busCapabilities}
              onApplyFree={applyBusConfig}
              onApplyScheme={applyBusScheme}
              onSwap={swapBusPins}
              onRecover={recoverBus}
            />

            <section className="panel scan-panel">
              <div className="panel-title-row">
                <div><h2>地址扫描</h2><p>探测总线上的响应设备</p></div>
                <span className="tiny-symbol">⌕</span>
              </div>
              <div className="scan-range">
                <div>
                  <label className="field-label" htmlFor="scan-start">
                    起始地址
                  </label>
                  <input
                    id="scan-start"
                    value={scanStart}
                    onChange={(event) => setScanStart(event.target.value)}
                  />
                </div>
                <span className="range-divider">—</span>
                <div>
                  <label className="field-label" htmlFor="scan-end">
                    结束地址
                  </label>
                  <input
                    id="scan-end"
                    value={scanEnd}
                    onChange={(event) => setScanEnd(event.target.value)}
                  />
                </div>
              </div>
              <button
                className="button secondary full-button"
                disabled={!status.connected || busy}
                onClick={() => void scan()}
              >
                <span>⌕</span> {busy ? "扫描中…" : "扫描 I²C 总线"}
              </button>
              {scanResult && (
                <div className="scan-results">
                  <div className="result-caption">
                    <span>{scanResult.addresses.length} 个设备响应</span>
                    <span>{hex(scanResult.start)} – {hex(scanResult.end)}</span>
                  </div>
                  {addressPills.length
                    ? (
                      <div className="address-pills">
                        {addressPills.map((item) => (
                          <button
                            key={item}
                            onClick={() => setAddress(hex(item))}
                          >
                            {hex(item)}
                          </button>
                        ))}
                      </div>
                    )
                    : (
                      <div className="empty-result">
                        未发现设备，请检查接线与上拉电阻。
                      </div>
                    )}
                </div>
              )}
            </section>
          </aside>

          <div className="operations-column">
            <section className="panel operations-panel">
              <div className="operation-heading">
                <div>
                  <div className="eyebrow small-eyebrow">BUS OPERATIONS</div>
                  <h2>总线操作</h2>
                </div>
                <span
                  className={`operation-state ${
                    status.connected ? "ready" : ""
                  }`}
                >
                  <i /> {status.connected ? "串口 · 就绪" : "等待连接"}
                </span>
              </div>
              <div className="tabs" role="tablist" aria-label="I²C 操作模式">
                {([
                  ["register", "寄存器读写", "▤"],
                  ["raw", "原始传输", "⌘"],
                  ["eeprom", "EEPROM", "▧"],
                ] as const).map(([tab, label, icon]) => (
                  <button
                    key={tab}
                    className={activeTab === tab ? "active" : ""}
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                  >
                    <span>{icon}</span>{label}
                  </button>
                ))}
              </div>

              {activeTab === "register" && (
                <div className="tab-content">
                  <div className="operation-description">
                    <span className="mode-glyph">⌗</span>
                    <div>
                      <h3>寄存器访问</h3>
                      <p>读取或写入 8 位寄存器及数据</p>
                    </div>
                    <span className="protocol-tag">7-BIT ADDRESS</span>
                  </div>
                  <div className="form-grid">
                    <div className="form-field">
                      <label htmlFor="i2c-address">从设备地址</label>
                      <div className="hex-field">
                        <span>HEX</span>
                        <input
                          id="i2c-address"
                          value={address}
                          onChange={(event) => setAddress(event.target.value)}
                        />
                      </div>
                      <small>7 位地址 · 有效范围 0x08–0x77</small>
                    </div>
                    <div className="form-field">
                      <label htmlFor="register-address">寄存器地址</label>
                      <div className="hex-field">
                        <span>HEX</span>
                        <input
                          id="register-address"
                          value={register}
                          onChange={(event) => setRegister(event.target.value)}
                        />
                      </div>
                      <small>8 位寄存器偏移</small>
                    </div>
                    <div className="form-field">
                      <label htmlFor="register-value">写入数据</label>
                      <div className="hex-field">
                        <span>HEX</span>
                        <input
                          id="register-value"
                          value={writeValue}
                          onChange={(event) => setWriteValue(event.target.value)}
                        />
                      </div>
                      <small>单字节 · 0x00–0xFF</small>
                    </div>
                    <div className="form-field action-field">
                      <label>执行操作</label>
                      <div className="button-pair">
                        <button
                          className="button secondary"
                          disabled={!status.connected || busy}
                          onClick={() => void readRegister()}
                        >
                          读取
                        </button>
                        <button
                          className="button primary"
                          disabled={!status.connected || busy}
                          onClick={() => void writeRegister()}
                        >
                          写入
                        </button>
                      </div>
                      <small>数据写入会直接修改设备</small>
                    </div>
                  </div>
                  <div className="info-strip">
                    <span>i</span>
                    <p>
                      此模式适用于单字节寄存器。多字节命令、重复起始条件及自定义时序请使用「原始传输」。
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "raw" && (
                <div className="tab-content">
                  <div className="operation-description">
                    <span className="mode-glyph">⌘</span>
                    <div>
                      <h3>原始 I²C 数据流</h3>
                      <p>首字节为 8 位写地址，其后为寄存器/数据前缀</p>
                    </div>
                    <span className="protocol-tag">HEX STREAM</span>
                  </div>
                  <div className="form-field full-width">
                    <label htmlFor="raw-write">发送数据流</label>
                    <div className="hex-field stream-input">
                      <span>HEX</span>
                      <textarea
                        id="raw-write"
                        rows={4}
                        value={rawWrite}
                        onChange={(event) => setRawWrite(event.target.value)}
                        placeholder="A0 00"
                      />
                    </div>
                    <small>
                      例：A0 00 表示向 0x50 写寄存器指针 0x00；空格分隔，最多 4096 字节。
                    </small>
                  </div>
                  <div className="raw-action-row">
                    <div className="form-field">
                      <label htmlFor="raw-read-length">接收长度</label>
                      <div className="input-with-suffix">
                        <input
                          id="raw-read-length"
                          type="number"
                          min="0"
                          max="4096"
                          value={rawReadLength}
                          onChange={(event) =>
                            setRawReadLength(event.target.value)}
                        />
                        <span>BYTES</span>
                      </div>
                    </div>
                    <button
                      className="button primary"
                      disabled={!status.connected || busy}
                      onClick={() => void rawTransfer()}
                    >
                      {busy ? "传输中…" : "执行传输"} <span>→</span>
                    </button>
                  </div>
                  {transferResult && <TransferOutput result={transferResult} />}
                </div>
              )}

              {activeTab === "eeprom" && (
                <div className="tab-content">
                  <div className="operation-description">
                    <span className="mode-glyph">▧</span>
                    <div>
                      <h3>EEPROM 存储器</h3>
                      <p>按芯片型号读取或写入存储区</p>
                    </div>
                    <span className="protocol-tag">24C SERIES</span>
                  </div>
                  <div className="form-grid eeprom-grid">
                    <div className="form-field">
                      <label htmlFor="eeprom-type">芯片型号</label>
                      <select
                        id="eeprom-type"
                        value={eepromType}
                        onChange={(event) =>
                          setEepromType(Number(event.target.value))}
                      >
                        {EEPROM_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <small>确认型号与地址容量相符</small>
                    </div>
                    <div className="form-field">
                      <label htmlFor="eeprom-offset">起始偏移</label>
                      <div className="hex-field">
                        <span>HEX</span>
                        <input
                          id="eeprom-offset"
                          value={eepromOffset}
                          onChange={(event) => setEepromOffset(event.target.value)}
                        />
                      </div>
                      <small>芯片内存储地址</small>
                    </div>
                    <div className="form-field">
                      <label htmlFor="eeprom-length">读取长度</label>
                      <div className="input-with-suffix">
                        <input
                          id="eeprom-length"
                          type="number"
                          min="1"
                          max="4096"
                          value={eepromLength}
                          onChange={(event) =>
                            setEepromLength(event.target.value)}
                        />
                        <span>BYTES</span>
                      </div>
                      <small>单次最多读写 4096 字节</small>
                    </div>
                    <div className="form-field">
                      <label htmlFor="eeprom-write">写入数据</label>
                      <div className="hex-field">
                        <span>HEX</span>
                        <input
                          id="eeprom-write"
                          value={eepromWriteData}
                          onChange={(event) =>
                            setEepromWriteData(event.target.value)}
                        />
                      </div>
                      <small>十六进制字节序列</small>
                    </div>
                  </div>
                  <div className="button-pair eeprom-actions">
                    <button
                      className="button secondary"
                      disabled={!status.connected || busy}
                      onClick={() => void readEeprom()}
                    >
                      读取 EEPROM
                    </button>
                    <button
                      className="button primary"
                      disabled={!status.connected || busy}
                      onClick={() => void writeEeprom()}
                    >
                      写入 EEPROM
                    </button>
                  </div>
                  <div className="warning-strip">
                    <span>!</span>
                    <p>
                      EEPROM 写入会永久修改存储内容。写入前请确认芯片型号、偏移与供电电压。
                    </p>
                  </div>
                  {transferResult && <TransferOutput result={transferResult} />}
                </div>
              )}
            </section>

            <section className="panel history-panel">
              <div className="history-heading">
                <div className="history-title">
                  <div className="history-icon">≡</div>
                  <div>
                    <h2>操作记录</h2>
                    <p>本次会话 · 最近 100 条</p>
                  </div>
                </div>
                <div className="history-actions">
                  <span>{history.length} 条记录</span>
                  <button
                    className="text-button"
                    onClick={exportHistory}
                    disabled={history.length === 0}
                  >
                    导出 JSON ↗
                  </button>
                  <button
                    className="text-button clear-button"
                    onClick={() => setHistory([])}
                    disabled={history.length === 0}
                  >
                    清除
                  </button>
                </div>
              </div>
              {history.length === 0
                ? (
                  <div className="history-empty">
                    <span>⌁</span>
                    <p>还没有操作记录</p>
                    <small>连接串口并执行 I²C 操作后，记录将显示在这里</small>
                  </div>
                )
                : (
                  <div className="history-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>操作</th>
                          <th>参数</th>
                          <th>结果</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((entry) => (
                          <tr key={entry.id}>
                            <td className="mono">{entry.time}</td>
                            <td>{entry.operation}</td>
                            <td className="mono muted-cell">{entry.detail}</td>
                            <td className="mono">{entry.result}</td>
                            <td>
                              <span
                                className={`result-badge ${
                                  entry.ok ? "ok" : "failed"
                                }`}
                              >
                                {entry.ok ? "成功" : "失败"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </section>
          </div>
        </div>
      </> : activePage === "ch224" ? (
        <Ch224Panel
          connected={status.connected}
          busy={busy}
          onGoConnect={() => setActivePage("i2c")}
          onDiscover={discoverCh224}
          onListRegisters={listCh224Registers}
          onReadCapabilities={readCh224Capabilities}
          onReadRegister={readCh224Register}
          onWriteRegister={writeCh224Register}
          onRequestPower={requestCh224Power}
        />
      ) : activePage === "mlx" ? (
        <Mlx90614Panel
          connected={status.connected}
          busy={busy}
          onGoConnect={() => setActivePage("i2c")}
          onDiscover={discoverMlx}
          onListRegisters={listMlxRegisters}
          onReadTemperature={pollMlxTemperature}
          onReadRegister={readMlxRegister}
          onWriteRegister={writeMlxRegister}
        />
      ) : activePage === "lis3dh" ? (
        <Lis3dhPanel
          connected={status.connected}
          busy={busy}
          capabilities={busCapabilities}
          busConfig={busConfig}
          onGoConnect={() => setActivePage("i2c")}
          onDiscover={discoverLis3dh}
          onListRegisters={listLis3dhRegisters}
          onReadSample={pollLis3dhSample}
          onReadTemperature={readLis3dhTemperature}
          onReadFifoBatch={readLis3dhFifoBatch}
          onResetFifo={resetLis3dhFifo}
          onFifoHint={getLis3dhFifoHint}
          onStartStream={startLis3dhStream}
          onStopStream={stopLis3dhStream}
          onSubscribeStream={subscribeLis3dhStream}
          onConfigure={configureLis3dh}
          onReadRegister={readLis3dhRegister}
          onWriteRegister={writeLis3dhRegister}
          onReportConfigure={configureAutoReport}
          onReportStart={startAutoReport}
          onReportStop={stopAutoReport}
          onReportStatus={queryAutoReport}
          onSubscribeReportSample={subscribeLis3dhReport}
        />
      ) : (
        <AutoReportPanel
          connected={status.connected}
          busy={busy}
          onGoConnect={() => setActivePage("i2c")}
          onConfigure={configureAutoReport}
          onStart={startAutoReport}
          onStop={stopAutoReport}
          onStatus={queryAutoReport}
          onClear={clearAutoReport}
          onSubscribe={subscribeAutoReport}
        />
      )}

      <footer className="footer">
        <span>I²C WEB TOOL</span>
        <span>浏览器直连串口 / 蓝牙 <i>·</i> v0.1.0</span>
        <span>数据不离开此设备</span>
      </footer>
      <div className="site-filing">© 2026 · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">粤ICP备2025393310号-2</a> · 粤公网安备 44030002011217号</div>
      {toast && <div className="toast" role="alert"><span>!</span>{toast}</div>}
    </main>
  );
}

function TransferOutput({ result }: { result: TransferResult }) {
  return (
    <div className="transfer-output">
      <div className="output-heading">
        <span>接收结果</span>
        <span>{result.bytesRead} BYTES</span>
      </div>
      <div className="output-data">
        <code>{result.hex || "—"}</code>
        <code className="ascii">{result.ascii || "—"}</code>
      </div>
    </div>
  );
}

export default App;
