import { useEffect, useMemo, useState } from "react";
import type {
  I2cBusConfig,
  I2cBusConfigPatch,
  I2cCapabilities,
  I2cPinCapability,
  I2cPinScheme,
} from "../types.ts";

// 频率预设（kHz）：ESP32 与多数 STM32 都支持 100k/400k，1 MHz 视器件而定。
const FREQ_PRESETS = [100, 400, 1000];
const MAX_GPIO = 63;

interface BusConfigPanelProps {
  connected: boolean;
  busy: boolean;
  config: I2cBusConfig | null;
  capabilities: I2cCapabilities | null;
  onApplyFree: (patch: I2cBusConfigPatch) => Promise<unknown>;
  onApplyScheme: (
    busId: number,
    schemeId: number,
    freqHz: number,
  ) => Promise<unknown>;
  onSwap: () => Promise<unknown>;
  onRecover: () => Promise<unknown>;
}

function formatHz(hz: number): string {
  if (hz >= 1_000_000) {
    const mhz = hz / 1_000_000;
    return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(2)} MHz`;
  }
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function toKilohertz(hz: number): string {
  const khz = hz / 1000;
  return Number.isInteger(khz) ? String(khz) : String(Number(khz.toFixed(3)));
}

const PORT_LETTERS = "ABCDEFGHI";

/** 固定复用模式：固件用 port*16+pin 编码（PA8=0x08、PB6=0x16、PC9=0x29）。 */
function formatPin(code: number, fixed: boolean): string {
  if (!fixed) return `GPIO${code}`;
  const port = Math.floor(code / 16);
  const pin = code % 16;
  const letter = PORT_LETTERS[port];
  return letter ? `P${letter}${pin}` : `PIN${code}`;
}

function describeScheme(scheme: I2cPinScheme, fixed: boolean): string {
  const pins = `${formatPin(scheme.scl, fixed)} / ${formatPin(scheme.sda, fixed)}`;
  return scheme.label || pins;
}

/** 自由引脚下拉的展示文本：标注默认引脚、启动引脚与内部上拉缺失。 */
function describePin(pin: I2cPinCapability, signal: "sda" | "scl"): string {
  const tags: string[] = [];
  const isDefault = signal === "sda" ? pin.defaultSda : pin.defaultScl;
  if (isDefault) tags.push("默认");
  if (pin.strap) tags.push("启动引脚");
  if (!pin.pullup) tags.push("无内部上拉");
  return `GPIO${pin.gpio}${tags.length > 0 ? ` · ${tags.join(" · ")}` : ""}`;
}

function BusConfigPanel({
  connected,
  busy,
  config,
  capabilities,
  onApplyFree,
  onApplyScheme,
  onSwap,
  onRecover,
}: BusConfigPanelProps) {
  const [sdaInput, setSdaInput] = useState("13");
  const [sclInput, setSclInput] = useState("12");
  const [freqInput, setFreqInput] = useState("100");
  const [busId, setBusId] = useState(1);
  const [schemeId, setSchemeId] = useState(1);
  const [error, setError] = useState("");

  const fixed = capabilities?.pinMode === "fixed" &&
    capabilities.buses.length > 0;
  // CAPS v2 自由引脚表：固件明确声明哪些 GPIO 可用作 SDA/SCL。
  const reportedPins = (capabilities?.pins?.length ?? 0) > 0;
  const sdaPins = useMemo(
    () =>
      (capabilities?.pins ?? []).filter((pin) => pin.sda && !pin.reserved),
    [capabilities],
  );
  const sclPins = useMemo(
    () =>
      (capabilities?.pins ?? []).filter((pin) => pin.scl && !pin.reserved),
    [capabilities],
  );
  const reservedPins = useMemo(
    () => (capabilities?.pins ?? []).filter((pin) => pin.reserved),
    [capabilities],
  );
  const activeBus = useMemo(
    () =>
      capabilities?.buses.find((bus) => bus.id === busId) ??
        capabilities?.buses[0] ?? null,
    [capabilities, busId],
  );
  const activeScheme = useMemo(
    () =>
      activeBus?.schemes.find((scheme) => scheme.id === schemeId) ??
        activeBus?.schemes[0] ?? null,
    [activeBus, schemeId],
  );

  const freqMin = capabilities?.freqMin ?? 1000;
  const freqMax = capabilities?.freqMax ?? 1_000_000;

  useEffect(() => {
    if (!config) return;
    setSdaInput(String(config.sda));
    setSclInput(String(config.scl));
    setFreqInput(toKilohertz(config.freqHz));
  }, [config]);

  // CONFIG 查询失败但 CAPS 成功时，用固件声明的默认引脚兜底。
  useEffect(() => {
    if (!capabilities || config || capabilities.pins.length === 0) return;
    setSdaInput((current) => {
      const usable = capabilities.pins.some((pin) =>
        pin.sda && !pin.reserved && String(pin.gpio) === current
      );
      if (usable) return current;
      const fallback = capabilities.defaultSda ??
        capabilities.pins.find((pin) => pin.sda && !pin.reserved)?.gpio;
      return fallback === undefined ? current : String(fallback);
    });
    setSclInput((current) => {
      const usable = capabilities.pins.some((pin) =>
        pin.scl && !pin.reserved && String(pin.gpio) === current
      );
      if (usable) return current;
      const fallback = capabilities.defaultScl ??
        capabilities.pins.find((pin) => pin.scl && !pin.reserved)?.gpio;
      return fallback === undefined ? current : String(fallback);
    });
  }, [capabilities, config]);

  useEffect(() => {
    if (!capabilities || capabilities.buses.length === 0) return;
    setBusId((current) =>
      capabilities.buses.some((bus) => bus.id === current)
        ? current
        : capabilities.buses[0]?.id ?? 1
    );
  }, [capabilities]);

  useEffect(() => {
    if (!activeBus) return;
    setSchemeId((current) =>
      activeBus.schemes.some((scheme) => scheme.id === current)
        ? current
        : activeBus.schemes[0]?.id ?? 1
    );
  }, [activeBus]);

  const platformName = capabilities?.name ||
    (capabilities?.machine === "stm32"
      ? "STM32"
      : capabilities?.machine === "esp32"
      ? "ESP32"
      : "未知芯片");
  const modeLabel = !connected
    ? "未连接"
    : !capabilities
    ? "兼容模式 · 自由引脚"
    : fixed
    ? `${platformName} · 固定复用`
    : `${platformName} · 自由引脚`;

  const parsePin = (value: string, label: string): number | null => {
    const pin = Number(value);
    if (!Number.isInteger(pin) || pin < 0 || pin > MAX_GPIO) {
      setError(`${label} 必须是 0–${MAX_GPIO} 的整数引脚号。`);
      return null;
    }
    // 有固件引脚表时以表为准；不同 ESP32 型号的 UART/USB 占用引脚并不相同。
    if (!reportedPins && (pin === 43 || pin === 44)) {
      setError(`${label} 不能使用 GPIO43/44（UART0 控制台）。`);
      return null;
    }
    return pin;
  };

  const parseFrequency = (): number | null => {
    const khz = Number(freqInput);
    if (!Number.isFinite(khz) || khz <= 0) {
      setError("频率必须为正数（kHz）。");
      return null;
    }
    const hz = Math.round(khz * 1000);
    if (hz < freqMin || hz > freqMax) {
      setError(`频率必须在 ${formatHz(freqMin)} – ${formatHz(freqMax)} 之间。`);
      return null;
    }
    return hz;
  };

  const apply = async () => {
    if (!connected || busy) return;
    setError("");
    const freqHz = parseFrequency();
    if (freqHz === null) return;
    if (fixed) {
      if (!activeBus || !activeScheme) {
        setError("固件未上报可用的 I²C 实例或引脚方案。");
        return;
      }
      await onApplyScheme(activeBus.id, activeScheme.id, freqHz);
      return;
    }
    const sda = parsePin(sdaInput, "SDA");
    if (sda === null) return;
    const scl = parsePin(sclInput, "SCL");
    if (scl === null) return;
    if (sda === scl) {
      setError("SDA 与 SCL 不能使用同一个引脚。");
      return;
    }
    if (reportedPins) {
      if (!sdaPins.some((pin) => pin.gpio === sda)) {
        setError(`GPIO${sda} 未在固件上报的 SDA 可用引脚中。`);
        return;
      }
      if (!sclPins.some((pin) => pin.gpio === scl)) {
        setError(`GPIO${scl} 未在固件上报的 SCL 可用引脚中。`);
        return;
      }
    }
    await onApplyFree({ sda, scl, freqHz });
  };

  const applyDisabled = !connected || busy ||
    (capabilities
      ? (fixed
        ? !capabilities.supportsBusSelect
        : !capabilities.supportsConfigSet)
      : false);
  const canSwap = !fixed && (!capabilities || capabilities.supportsSwap);
  const canRecover = !capabilities || capabilities.supportsRecover;

  return (
    <section className="panel bus-config-panel">
      <div className="panel-title-row">
        <div>
          <h2>I²C 参数</h2>
          <p>引脚映射与总线频率</p>
        </div>
        <span className="tiny-symbol">⚙</span>
      </div>

      <div className="bus-config-current">
        <span className={`bus-mode-badge ${fixed ? "fixed" : ""}`}>
          {modeLabel}
        </span>
        {config
          ? (
            <div className="bus-config-meta">
              <span>SDA <b>{formatPin(config.sda, fixed)}</b></span>
              <span>SCL <b>{formatPin(config.scl, fixed)}</b></span>
              <span>{formatHz(config.freqHz)}</span>
            </div>
          )
          : (
            <span className="bus-config-meta muted">
              {connected ? "读取中…" : "连接后读取"}
            </span>
          )}
      </div>

      {fixed
        ? (
          <>
            <div className="bus-config-field">
              <label className="field-label" htmlFor="bus-instance">
                I²C 实例
              </label>
              <select
                id="bus-instance"
                value={activeBus?.id ?? 1}
                disabled={busy}
                onChange={(event) => {
                  setBusId(Number(event.target.value));
                  setError("");
                }}
              >
                {(capabilities?.buses ?? []).map((bus) => (
                  <option key={bus.id} value={bus.id}>I2C{bus.id}</option>
                ))}
              </select>
            </div>
            <div className="bus-config-field">
              <label className="field-label" htmlFor="bus-scheme">
                引脚方案
              </label>
              <select
                id="bus-scheme"
                value={activeScheme?.id ?? 1}
                disabled={busy}
                onChange={(event) => {
                  setSchemeId(Number(event.target.value));
                  setError("");
                }}
              >
                {(activeBus?.schemes ?? []).map((scheme) => (
                  <option key={scheme.id} value={scheme.id}>
                    {describeScheme(scheme, true)}
                  </option>
                ))}
              </select>
            </div>
            {activeScheme && (
              <div className="bus-scheme-detail">
                <span>SCL <b>{formatPin(activeScheme.scl, true)}</b></span>
                <span>SDA <b>{formatPin(activeScheme.sda, true)}</b></span>
                {activeScheme.af > 0 && (
                  <span>复用 <b>AF{activeScheme.af}</b></span>
                )}
              </div>
            )}
          </>
        )
        : (
          <>
            <div className="bus-config-grid">
              <div>
                <label className="field-label" htmlFor="bus-sda">SDA 引脚</label>
                {reportedPins
                  ? (
                    <select
                      id="bus-sda"
                      value={sdaInput}
                      disabled={busy}
                      onChange={(event) => {
                        setSdaInput(event.target.value);
                        setError("");
                      }}
                    >
                      {!sdaPins.some((pin) => String(pin.gpio) === sdaInput) && (
                        <option value={sdaInput}>
                          GPIO{sdaInput}（未上报）
                        </option>
                      )}
                      {sdaPins.map((pin) => (
                        <option key={pin.gpio} value={pin.gpio}>
                          {describePin(pin, "sda")}
                        </option>
                      ))}
                    </select>
                  )
                  : (
                    <div className="input-with-suffix">
                      <input
                        id="bus-sda"
                        type="number"
                        min="0"
                        max={MAX_GPIO}
                        value={sdaInput}
                        disabled={busy}
                        onChange={(event) => {
                          setSdaInput(event.target.value);
                          setError("");
                        }}
                      />
                      <span>GPIO</span>
                    </div>
                  )}
              </div>
              <div>
                <label className="field-label" htmlFor="bus-scl">SCL 引脚</label>
                {reportedPins
                  ? (
                    <select
                      id="bus-scl"
                      value={sclInput}
                      disabled={busy}
                      onChange={(event) => {
                        setSclInput(event.target.value);
                        setError("");
                      }}
                    >
                      {!sclPins.some((pin) => String(pin.gpio) === sclInput) && (
                        <option value={sclInput}>
                          GPIO{sclInput}（未上报）
                        </option>
                      )}
                      {sclPins.map((pin) => (
                        <option key={pin.gpio} value={pin.gpio}>
                          {describePin(pin, "scl")}
                        </option>
                      ))}
                    </select>
                  )
                  : (
                    <div className="input-with-suffix">
                      <input
                        id="bus-scl"
                        type="number"
                        min="0"
                        max={MAX_GPIO}
                        value={sclInput}
                        disabled={busy}
                        onChange={(event) => {
                          setSclInput(event.target.value);
                          setError("");
                        }}
                      />
                      <span>GPIO</span>
                    </div>
                  )}
              </div>
            </div>
            {reportedPins && (
              <details className="bus-pin-details">
                <summary>
                  固件上报：{sdaPins.length} 个可用 SDA / {sclPins.length} 个可用 SCL
                  {reservedPins.length > 0
                    ? `，已排除 ${reservedPins.length} 个`
                    : ""}
                </summary>
                {reservedPins.length > 0 && (
                  <ul className="bus-pin-list">
                    {reservedPins.map((pin) => (
                      <li key={pin.gpio}>
                        GPIO{pin.gpio} · {pin.reasonText}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
          </>
        )}

      <label className="field-label bus-freq-label" htmlFor="bus-freq">
        总线频率
      </label>
      <div className="input-with-suffix">
        <input
          id="bus-freq"
          type="number"
          min={freqMin / 1000}
          max={freqMax / 1000}
          value={freqInput}
          disabled={busy}
          onChange={(event) => {
            setFreqInput(event.target.value);
            setError("");
          }}
        />
        <span>kHz</span>
      </div>
      <div className="bus-freq-presets">
        {FREQ_PRESETS.filter((khz) =>
          khz * 1000 >= freqMin && khz * 1000 <= freqMax
        ).map((khz) => (
          <button
            key={khz}
            type="button"
            className={Number(freqInput) === khz ? "selected" : ""}
            disabled={busy}
            onClick={() => {
              setFreqInput(String(khz));
              setError("");
            }}
          >
            {khz >= 1000 ? `${khz / 1000} MHz` : `${khz} kHz`}
          </button>
        ))}
      </div>

      {error && <div className="bus-config-error" role="alert">{error}</div>}

      <div className="bus-config-actions">
        <button
          className="button primary full-button"
          type="button"
          disabled={applyDisabled}
          onClick={() => void apply()}
        >
          {fixed ? "切换实例与引脚" : "应用引脚与频率"}
        </button>
        {(canSwap || canRecover) && (
          <div className="bus-config-subactions">
            {canSwap && (
              <button
                className="button secondary"
                type="button"
                disabled={applyDisabled}
                onClick={() => void onSwap()}
              >
                交换 SDA/SCL
              </button>
            )}
            {canRecover && (
              <button
                className="button secondary"
                type="button"
                disabled={applyDisabled}
                onClick={() => void onRecover()}
              >
                总线恢复
              </button>
            )}
          </div>
        )}
      </div>

      <div className="connection-note bus-config-note">
        <span>i</span>{" "}
        {fixed
          ? "STM32 引脚由复用功能固定，只能选择固件上报的方案。"
          : reportedPins
          ? "ESP32 固件已上报可用 GPIO；列表外的引脚会被固件拒绝，修改后重建总线（约 1 秒）。"
          : capabilities
          ? "固件未上报引脚表，按 0–63 自由输入（GPIO43/44 除外）；修改后重建总线（约 1 秒）。"
          : "固件未上报芯片能力，按 ESP32 自由引脚模式处理。"}
      </div>
      {fixed && capabilities?.supportsBusSelect === false && (
        <div className="connection-note warning">
          <span>!</span>{" "}
          当前固件声明固定引脚但未实现 BUS_SELECT，请更新固件后再设置。
        </div>
      )}
      {!fixed && capabilities && !capabilities.supportsConfigSet && (
        <div className="connection-note warning">
          <span>!</span>{" "}
          当前固件未声明 CONFIG 设置能力，请更新固件后再修改引脚/频率。
        </div>
      )}
    </section>
  );
}

export default BusConfigPanel;
