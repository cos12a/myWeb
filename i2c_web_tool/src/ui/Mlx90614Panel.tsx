import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MlxRegisterDetail,
  MlxRegisterInfo,
  MlxRegisterReadResult,
  MlxRegisterWriteResult,
  MlxTemperatureResult,
} from "../types.ts";

interface Mlx90614PanelProps {
  connected: boolean;
  busy: boolean;
  /** 跳到「I²C 操作台」建立连接：器件页不再自带串口 / 蓝牙连接按钮 */
  onGoConnect: () => void;
  onDiscover: () => Promise<{ addresses: number[] } | undefined>;
  onListRegisters: () => Promise<{ registers: MlxRegisterInfo[] } | undefined>;
  onReadTemperature: (
    address: number,
    register: number,
  ) => Promise<MlxTemperatureResult | undefined>;
  onReadRegister: (
    address: number,
    register: number,
  ) => Promise<MlxRegisterReadResult | undefined>;
  onWriteRegister: (
    address: number,
    register: number,
    value: number,
  ) => Promise<MlxRegisterWriteResult | undefined>;
}

const MLX_ADDRESS = 0x5a;
const TEMP_SOURCES = [
  { reg: 0x07, label: "物体温度 1 · TOBJ1 (0x07)" },
  { reg: 0x06, label: "环境温度 · TA (0x06)" },
  { reg: 0x08, label: "物体温度 2 · TOBJ2 (0x08)" },
];
const KIND_LABELS: Record<string, string> = {
  ram: "RAM · 只读",
  eeprom: "EEPROM · 可写",
  command: "命令 · 只写",
  reserved: "保留",
};
const MAX_SERIES_POINTS = 120;

/**
 * 自动读取间隔（秒）：先提供 0.3 / 0.5 / 0.8 / 1 秒四档，
 * 1 秒以上按 1 秒步进到 30 秒。
 */
const MAX_INTERVAL_SEC = 30;
const INTERVAL_OPTIONS: number[] = [
  0.3,
  0.5,
  0.8,
  1,
  ...Array.from({ length: MAX_INTERVAL_SEC - 1 }, (_, index) => index + 2),
];
const DEFAULT_INTERVAL_INDEX = Math.max(0, INTERVAL_OPTIONS.indexOf(5));

function formatInterval(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

function byteHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function wordHex(value: number): string {
  return `0x${(value & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}

function parseHexByte(value: string): number | null {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[\da-f]{1,2}$/i.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

function parseHexWord(value: string): number | null {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[\da-f]{1,4}$/i.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

interface SeriesPoint {
  at: number;
  celsius: number;
  fahrenheit: number;
  raw: number;
}

function Mlx90614Panel({
  connected,
  busy,
  onGoConnect,
  onDiscover,
  onListRegisters,
  onReadTemperature,
  onReadRegister,
  onWriteRegister,
}: Mlx90614PanelProps) {
  const [foundAddresses, setFoundAddresses] = useState<number[]>([]);
  const [autoOn, setAutoOn] = useState(false);
  const [intervalIndex, setIntervalIndex] = useState(DEFAULT_INTERVAL_INDEX);
  const intervalSec = INTERVAL_OPTIONS[intervalIndex] ?? 5;
  const [unit, setUnit] = useState<"c" | "f">("c");
  const [source, setSource] = useState(0x07);
  const [live, setLive] = useState<MlxTemperatureResult | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [notice, setNotice] = useState("");

  const [registerAddress, setRegisterAddress] = useState("07");
  const [registerWriteValue, setRegisterWriteValue] = useState("0000");
  const [readResult, setReadResult] = useState<MlxRegisterReadResult | null>(
    null,
  );
  const [writeResult, setWriteResult] = useState<MlxRegisterWriteResult | null>(
    null,
  );
  const [registerMap, setRegisterMap] = useState<MlxRegisterInfo[]>([]);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const pollingRef = useRef(false);
  const registerLoadedRef = useRef(false);

  useEffect(() => {
    if (registerLoadedRef.current) return;
    registerLoadedRef.current = true;
    void onListRegisters().then((result) => {
      if (result) setRegisterMap(result.registers);
    });
  }, [onListRegisters]);

  const pollTemperature = useCallback(async () => {
    // 亚秒档位下若上一次读数尚未结束，跳过本次，避免后端报“已有请求”。
    if (busyRef.current || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const result = await onReadTemperature(MLX_ADDRESS, source);
      if (!result) {
        setNotice("温度读取失败：请确认已连接串口设备、器件已上电且地址为 0x5A。");
        return;
      }
      setLive(result);
      if (
        result.valid && result.celsius !== null && result.fahrenheit !== null
      ) {
        setSeries((current) => [...current, {
          at: Date.now(),
          celsius: result.celsius as number,
          fahrenheit: result.fahrenheit as number,
          raw: result.raw,
        }].slice(-MAX_SERIES_POINTS));
        if (!result.pecValid) {
          setNotice("已读取温度，但 PEC 校验未通过：数据可能受干扰，建议重试或降低 I²C 速度。");
        } else {
          setNotice("");
        }
      } else if (result.noResponse) {
        setNotice("读数全为 0xFF：器件疑似未上电或 I²C 无应答。");
      } else {
        setNotice("原始值为 0 或 0x8000：尚未完成测量或超出量程。");
      }
    } finally {
      pollingRef.current = false;
    }
  }, [onReadTemperature, source]);

  useEffect(() => {
    if (!connected && autoOn) setAutoOn(false);
  }, [connected, autoOn]);

  useEffect(() => {
    if (!autoOn || !connected) return;
    void pollTemperature();
    const timer = window.setInterval(
      () => void pollTemperature(),
      Math.round(intervalSec * 1000),
    );
    return () => window.clearInterval(timer);
  }, [autoOn, connected, intervalSec, pollTemperature]);

  const discover = async () => {
    const result = await onDiscover();
    if (!result) return;
    setFoundAddresses(result.addresses);
    setNotice(
      result.addresses.length > 0
        ? `已在 0x5A 检测到 MLX90614。`
        : "未在 0x5A 检测到应答；请检查 VDD/GND、SDA/SCL、上拉电阻与地址。",
    );
  };

  const readManualRegister = async () => {
    const register = parseHexByte(registerAddress);
    if (register === null) {
      setNotice("寄存器地址必须为 00–FF 的十六进制字节。");
      return;
    }
    const result = await onReadRegister(MLX_ADDRESS, register);
    if (!result) return;
    setReadResult(result);
    setWriteResult(null);
    setNotice(result.message);
  };

  const writeManualRegister = async () => {
    const register = parseHexByte(registerAddress);
    const value = parseHexWord(registerWriteValue);
    if (register === null || value === null) {
      setNotice("寄存器地址为 00–FF，写入值为 0000–FFFF 的十六进制。");
      return;
    }
    const result = await onWriteRegister(MLX_ADDRESS, register, value);
    if (!result) return;
    setWriteResult(result);
    setReadResult(result.detail ? {
      address: result.address,
      register: result.register,
      raw: result.readBack ?? 0,
      low: (result.readBack ?? 0) & 0xff,
      high: ((result.readBack ?? 0) >> 8) & 0xff,
      pec: 0,
      pecValid: true,
      noResponse: false,
      detail: result.detail,
      message: result.message,
    } : readResult);
    setNotice(result.message);
  };

  const formatTemp = (c: number | null, f: number | null): string => {
    if (c === null || f === null) return "—";
    return unit === "c" ? `${c.toFixed(2)} °C` : `${f.toFixed(2)} °F`;
  };

  const seriesValues = series.map((point) =>
    unit === "c" ? point.celsius : point.fahrenheit
  );

  return (
    <section className="ch224-page" aria-label="MLX90614 红外测温">
      {!connected && (
        <div className="page-connect-hint">
          未连接设备 · 请先在
          <button
            type="button"
            className="text-button hint-link"
            onClick={onGoConnect}
          >
            I²C 操作台
          </button>
          完成串口 / 蓝牙连接，本页与总线操作台共用同一连接
        </div>
      )}

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>01</span>
          <div><h3>自动读取温度与曲线</h3><p>间隔可选 0.3 / 0.5 / 0.8 / 1 秒，1 秒以上按 1 秒步进；支持摄氏 / 华氏切换与实时曲线。</p></div>
        </div>
        <div className="mlx-toolbar">
          <div className="mlx-field">
            <label htmlFor="mlx-source">温度来源</label>
            <select id="mlx-source" value={source} onChange={(event) => setSource(Number(event.target.value))}>
              {TEMP_SOURCES.map((item) => <option key={item.reg} value={item.reg}>{item.label}</option>)}
            </select>
          </div>
          <div className="mlx-field">
            <label htmlFor="mlx-interval">读取间隔 · {formatInterval(intervalSec)} 秒</label>
            <input id="mlx-interval" type="range" min="0" max={INTERVAL_OPTIONS.length - 1} step="1" value={intervalIndex} disabled={!connected} onChange={(event) => setIntervalIndex(Number(event.target.value))} title="0.3 / 0.5 / 0.8 / 1 秒，之后每档 1 秒" />
          </div>
          <div className="mlx-field">
            <label htmlFor="mlx-unit">温度单位</label>
            <div className="mlx-unit-toggle" role="group">
              <button type="button" className={unit === "c" ? "active" : ""} onClick={() => setUnit("c")}>°C</button>
              <button type="button" className={unit === "f" ? "active" : ""} onClick={() => setUnit("f")}>°F</button>
            </div>
          </div>
          <div className="mlx-field mlx-toggle-field">
            <label>自动读取</label>
            <button
              type="button"
              className={`mlx-switch ${autoOn ? "on" : ""}`}
              role="switch"
              aria-checked={autoOn}
              disabled={!connected}
              onClick={() => setAutoOn((value) => !value)}
            >
              <i />
            </button>
          </div>
          <button className="button secondary" disabled={!connected || busy} onClick={() => void pollTemperature()}>读取一次</button>
          <button className="button primary" disabled={!connected || busy} onClick={() => void discover()}>扫描 0x5A</button>
        </div>

        <div className="mlx-readout">
          <div className="mlx-readout-main">
            <span>当前{TEMP_SOURCES.find((item) => item.reg === source)?.label.split(" ·")[0] ?? "温度"}</span>
            <b className={live && live.valid ? "good" : ""}>{live ? formatTemp(live.celsius, live.fahrenheit) : "—"}</b>
            <small>
              原始 {live ? wordHex(live.raw) : "—"} · PEC {live ? (live.pecValid ? "有效" : "无效") : "—"} · 数据点 {series.length}
            </small>
          </div>
          <button className="text-button clear-button" type="button" disabled={series.length === 0} onClick={() => setSeries([])}>清空曲线</button>
        </div>

        {foundAddresses.length > 0 && (
          <div className="ch224-notice">检测到的地址：{foundAddresses.map(byteHex).join("、")}。</div>
        )}
        {notice && <div className="ch224-notice" role="status">{notice}</div>}

        <TemperatureChart points={seriesValues} unit={unit} />
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>02</span>
          <div><h3>手动 16 位寄存器读写</h3><p>低字节在前。RAM（0x00–0x1F）只读；EEPROM（0x20–0x3F）写入采用“擦除→写入→回读校验”；0x60–0x7F 为命令。修改 EEPROM 后需重新上电完全生效。</p></div>
        </div>
        <div className="ch224-manual-grid">
          <div className="form-field">
            <label htmlFor="mlx-register-address">寄存器地址</label>
            <div className="hex-field"><span>HEX</span><input id="mlx-register-address" value={registerAddress} onChange={(event) => setRegisterAddress(event.target.value)} placeholder="07" /></div>
            <small>00–FF；点击下方地址表可快速填入</small>
          </div>
          <div className="form-field">
            <label htmlFor="mlx-register-value">写入数据（16 位）</label>
            <div className="hex-field"><span>HEX</span><input id="mlx-register-value" value={registerWriteValue} onChange={(event) => setRegisterWriteValue(event.target.value)} placeholder="0000" /></div>
            <small>0000–FFFF；仅 EEPROM / 命令区间可写</small>
          </div>
          <div className="button-pair ch224-manual-actions">
            <button className="button secondary" disabled={!connected || busy} onClick={() => void readManualRegister()}>读取寄存器</button>
            <button className="button primary" disabled={!connected || busy} onClick={() => void writeManualRegister()}>写入并回读</button>
          </div>
        </div>

        {readResult && <MlxRegisterCard result={readResult} writeResult={writeResult} />}

        <div className="ch224-register-map">
          <div className="ch224-subheading"><h4>全部地址功能一览</h4><span>地址 · 类型 · 属性 · 名称 · 功能</span></div>
          <div className="ch224-register-table-wrap">
            <table className="ch224-register-map-table">
              <thead><tr><th>地址</th><th>类型</th><th>属性</th><th>名称</th><th>功能</th></tr></thead>
              <tbody>{registerMap.map((item) => (
                <tr key={`${item.kind}-${item.address}`} className={item.access === "write" ? "write-only" : ""}
                  onClick={() => setRegisterAddress(item.address.toString(16).toUpperCase().padStart(2, "0"))}>
                  <td><code>{byteHex(item.address)}</code></td>
                  <td>{KIND_LABELS[item.kind] ?? item.kind}</td>
                  <td><span className={item.access === "read" ? "badge-read" : "badge-write"}>{item.access === "read" ? "可读" : "可写"}</span></td>
                  <td>{item.name}</td>
                  <td>{item.function}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {registerMap.length === 0 && <div className="ch224-none">正在载入寄存器表…若长时间为空，请确认本地硬件服务已启动。</div>}
        </div>
        <div className="warning-strip ch224-write-warning"><span>!</span><p>写入 EEPROM（发射率 0x24、配置 0x25、从机地址 0x2E 等）会永久改变器件参数，且部分需重新上电生效。误改从机地址会导致后续按 0x5A 通信失败，请务必记录原值并谨慎操作。</p></div>
      </section>

      <section className="panel ch224-section ch224-flow">
        <div className="ch224-section-title">
          <span>03</span>
          <div><h3>推荐操作流程</h3><p>按顺序确认，避免误写 EEPROM 或供电不足导致的读数异常。</p></div>
        </div>
        <ol>
          <li><b>共地接线</b><span>串口设备与 MLX90614 共地；SDA/SCL 接法正确，VDD 建议 3.3V 且就近去耦。MLX90614 为 SMBus 器件，需上拉电阻。</span></li>
          <li><b>连接串口</b><span>选择正确端口连接；I²C 速度先用标准 100 kHz，读数不稳时降到 20 kHz（或降低链路波特率）。</span></li>
          <li><b>扫描 0x5A</b><span>确认器件在默认地址应答；无应答时检查供电、地址焊盘与接线。</span></li>
          <li><b>单次读取温度</b><span>先“读取一次”确认 PEC 有效、数值合理（室温约 25–30 °C）。</span></li>
          <li><b>开启自动轮询</b><span>选择来源与间隔，打开自动读取开关，观察曲线趋势；关闭开关即停止。</span></li>
          <li><b>按需校准发射率</b><span>测量不同材质前，读取并按需写回发射率（0x24）；改后需重新上电生效。</span></li>
        </ol>
      </section>
    </section>
  );
}

function MlxRegisterCard({
  result,
  writeResult,
}: {
  result: MlxRegisterReadResult;
  writeResult: MlxRegisterWriteResult | null;
}) {
  const detail: MlxRegisterDetail = result.detail;
  return (
    <div className="ch224-bit-detail">
      <div className="ch224-bit-heading">
        <div><span>寄存器 {byteHex(result.register)} · {KIND_LABELS[detail.kind] ?? detail.kind}</span><h4>{detail.name} · {detail.hex}</h4></div>
        <code>{detail.binary}</code>
      </div>
      <p>{detail.description}</p>
      <div className="ch224-metric-grid">
        <div><span>原始 16 位</span><b>{detail.hex}（dec {detail.raw}）</b></div>
        <div><span>字节序（低/高）</span><b>{byteHex(result.low)} · {byteHex(result.high)}</b></div>
        <div><span>PEC 字节</span><b className={result.pecValid ? "good" : "bad"}>{byteHex(result.pec)} · {result.pecValid ? "校验通过" : "校验失败"}</b></div>
        {detail.temperature && detail.temperature.valid && (
          <>
            <div><span>摄氏</span><b className="good">{detail.temperature.celsius?.toFixed(2)} °C</b></div>
            <div><span>华氏</span><b className="good">{detail.temperature.fahrenheit?.toFixed(2)} °F</b></div>
          </>
        )}
        {detail.emissivity !== undefined && (
          <div><span>发射率</span><b>{detail.emissivity.toFixed(3)}</b></div>
        )}
      </div>
      {detail.configBits && (
        <div className="ch224-bit-grid">
          {detail.configBits.map((item) => (
            <div key={item.bit} className={item.value ? "set" : ""}>
              <b>bit {item.bit}</b><strong>{item.value}</strong><span>{item.name}：{item.description}</span>
            </div>
          ))}
        </div>
      )}
      {writeResult && (
        <div className="ch224-request-result" role="status">
          <b>写入结果</b>
          <span>{writeResult.message}</span>
        </div>
      )}
    </div>
  );
}

function TemperatureChart({ points, unit }: { points: number[]; unit: "c" | "f" }) {
  const width = 720;
  const height = 180;
  const padding = { top: 14, right: 14, bottom: 20, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  if (points.length < 2) {
    return (
      <div className="mlx-chart mlx-chart-empty">
        至少积累 2 个有效数据点后显示温度曲线。
      </div>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const niceMin = min - span * 0.1;
  const niceMax = max + span * 0.1;
  const range = niceMax - niceMin || 1;

  const stepX = innerW / (points.length - 1);
  const coords = points.map((value, index) => {
    const x = padding.left + index * stepX;
    const y = padding.top + innerH - ((value - niceMin) / range) * innerH;
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${padding.left},${padding.top + innerH} ${line} ${(
    padding.left + (points.length - 1) * stepX
  ).toFixed(1)},${padding.top + innerH}`;
  const gridLines = [niceMax, (niceMax + niceMin) / 2, niceMin];

  return (
    <div className="mlx-chart">
      <div className="mlx-chart-head"><span>温度趋势（最近 {points.length} 点 · {unit === "c" ? "°C" : "°F"}）</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="温度曲线图">
        {gridLines.map((value, index) => {
          const y = padding.top + innerH - ((value - niceMin) / range) * innerH;
          return (
            <g key={index}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="mlx-chart-grid" />
              <text x={4} y={y + 3} className="mlx-chart-label">{value.toFixed(1)}</text>
            </g>
          );
        })}
        <polygon points={area} className="mlx-chart-area" />
        <polyline points={line} className="mlx-chart-line" fill="none" />
        {coords.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={index === coords.length - 1 ? 3 : 1.6} className="mlx-chart-dot" />
        ))}
      </svg>
    </div>
  );
}

export default Mlx90614Panel;
