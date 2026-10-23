import { useEffect, useRef, useState } from "react";
import type {
  Ch224RegisterInfo,
  Ch224RegisterReadResult,
  Ch224RegisterValue,
  Ch224RegisterWriteResult,
  Ch224RequestResult,
  Ch224Snapshot,
} from "../types.ts";

interface Ch224PanelProps {
  connected: boolean;
  busy: boolean;
  /** 跳到「I²C 操作台」建立连接：器件页不再自带串口 / 蓝牙连接按钮 */
  onGoConnect: () => void;
  onDiscover: () => Promise<{ addresses: number[] } | undefined>;
  onListRegisters: () =>
    Promise<{ registers: Ch224RegisterInfo[] } | undefined>;
  onReadCapabilities: (address: number) => Promise<Ch224Snapshot | undefined>;
  onReadRegister: (
    address: number,
    register: number,
  ) => Promise<Ch224RegisterReadResult | undefined>;
  onWriteRegister: (
    address: number,
    register: number,
    value: number,
  ) => Promise<Ch224RegisterWriteResult | undefined>;
  onRequestPower: (
    address: number,
    mode: "fixed" | "pps" | "avs" | "qc",
    voltage: number,
  ) => Promise<Ch224RequestResult | undefined>;
}

const FIXED_VOLTAGE_OPTIONS = [5, 9, 12, 15, 20, 28];
const QC_FALLBACK_VOLTAGES = [5, 9, 12, 15, 20];
// 0x09 中代表“协议已激活”的位（bit5/6 是能力位，不属于激活协议）
const PROTOCOL_ACTIVE_LABELS: Record<string, string> = {
  BC_ACTIVATED: "BC 1.2",
  QC2_ACTIVATED: "QC2",
  QC3_ACTIVATED: "QC3",
  PD_ACTIVATED: "PD",
  EPR_ACTIVATED: "EPR",
};
const MODE_OPTIONS = [
  { id: "fixed", label: "固定电压 PDO", detail: "请求固定电压档（5–28 V）" },
  { id: "pps", label: "PPS 可编程电源", detail: "请求 3.3–25.5 V 连续电压" },
  { id: "avs", label: "AVS 可调电压", detail: "请求 5–20 V 连续电压" },
  { id: "qc", label: "QC/其它协议取电", detail: "PD 不支持时按 QC2/QC3/BC 固定档请求" },
] as const;
type RequestMode = typeof MODE_OPTIONS[number]["id"];

function parseHexInput(value: string): number | null {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[\da-f]{1,2}$/i.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

function byteHex(value: number | null): string {
  if (value === null) return "—";
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function voltageLabel(milliVolts: number): string {
  return `${(milliVolts / 1000).toFixed(2)} V`;
}

function Ch224Panel({
  connected,
  busy,
  onGoConnect,
  onDiscover,
  onListRegisters,
  onReadCapabilities,
  onReadRegister,
  onWriteRegister,
  onRequestPower,
}: Ch224PanelProps) {
  const [address, setAddress] = useState(0x23);
  const [foundAddresses, setFoundAddresses] = useState<number[]>([]);
  const [snapshot, setSnapshot] = useState<Ch224Snapshot | null>(null);
  const [selectedRegister, setSelectedRegister] =
    useState<Ch224RegisterValue | null>(null);
  const [registerAddress, setRegisterAddress] = useState("09");
  const [registerWriteValue, setRegisterWriteValue] = useState("00");
  const [registerMap, setRegisterMap] = useState<Ch224RegisterInfo[]>([]);
  const [requestedVoltage, setRequestedVoltage] = useState(9);
  const [requestVoltageMv, setRequestVoltageMv] = useState("5000");
  const [requestMode, setRequestMode] = useState<RequestMode>("fixed");
  const [requestResult, setRequestResult] =
    useState<Ch224RequestResult | null>(null);
  const [pageNotice, setPageNotice] = useState("");

  const registerLoadedRef = useRef(false);
  const [registerState, setRegisterState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    if (registerLoadedRef.current) return;
    registerLoadedRef.current = true;
    void onListRegisters().then((result) => {
      if (result) {
        setRegisterMap(result.registers);
        setRegisterState("ready");
      } else {
        setRegisterState("error");
      }
    });
  }, [onListRegisters]);

  const discover = async () => {
    const result = await onDiscover();
    if (!result) return;
    setFoundAddresses(result.addresses);
    const first = result.addresses[0];
    if (first !== undefined) {
      setAddress(first);
      setPageNotice(
        `已发现 CH224 I²C 地址：${result.addresses.map((item) => byteHex(item)).join("、")}。`,
      );
    } else {
      setPageNotice("未在 0x22 / 0x23 检测到应答；请检查 SDA、SCL、GND、供电和 I²C 地址焊盘。");
    }
  };

  const readCapabilities = async () => {
    const result = await onReadCapabilities(address);
    if (!result) return;
    setSnapshot(result);
    setRequestResult(null);
    setPageNotice(result.message);
    const statusRegister = result.registers.find((item) =>
      item.address === 0x09
    );
    if (statusRegister) setSelectedRegister(statusRegister);
  };

  const readManualRegister = async () => {
    const register = parseHexInput(registerAddress);
    if (register === null) {
      setPageNotice("寄存器地址必须为 00–FF 的十六进制字节。");
      return;
    }
    const result = await onReadRegister(address, register);
    if (!result) return;
    setSelectedRegister(result);
    setPageNotice(
      result.readOnly
        ? `已读取 ${byteHex(register)}：${result.hex}。注意：该寄存器为只写，读回值无意义。`
        : `已读取 ${byteHex(register)}：${result.hex}。`,
    );
  };

  const writeManualRegister = async () => {
    const register = parseHexInput(registerAddress);
    const value = parseHexInput(registerWriteValue);
    if (register === null || value === null) {
      setPageNotice("寄存器地址和写入值都必须为 00–FF 的十六进制字节。");
      return;
    }
    const result = await onWriteRegister(address, register, value);
    if (!result) return;
    setSelectedRegister(result.detail);
    setPageNotice(result.message);
    if (snapshot) {
      const registers = snapshot.registers.map((item) =>
        item.address === register ? result.detail : item
      );
      setSnapshot({ ...snapshot, registers });
    }
  };

  const parseVoltageMv = (): number | null => {
    const parsed = Number(requestVoltageMv);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };

  const requestPower = async () => {
    if (requestMode === "qc") {
      if (!snapshot?.nonPd?.kind) {
        setPageNotice(
          "未检测到可用的 QC/BC 协议（需 PD 未激活且 QC2/QC3/BC 已激活）。请先读取能力，未发送取电请求。",
        );
        return;
      }
    } else if (!snapshot?.pdActive || !snapshot.sourceCapabilities?.valid) {
      setPageNotice("尚无有效 PD 能力数据。请先读取 CH224A 能力，未发送取电请求。");
      return;
    }
    let voltage: number;
    if (requestMode === "fixed" || requestMode === "qc") {
      voltage = requestedVoltage;
    } else {
      const millivolts = parseVoltageMv();
      if (millivolts === null) {
        setPageNotice("请输入有效的目标电压（mV）。");
        return;
      }
      voltage = millivolts;
    }
    const result = await onRequestPower(address, requestMode, voltage);
    if (!result) return;
    setRequestResult(result);
    setPageNotice(result.message);
  };

  const statusFlags = snapshot?.protocols ?? [];
  const activeProtocols = statusFlags
    .filter((flag) => flag.active && flag.name in PROTOCOL_ACTIVE_LABELS)
    .map((flag) => PROTOCOL_ACTIVE_LABELS[flag.name]);
  const sourceCapabilities = snapshot?.sourceCapabilities;
  const advertisedFixedVoltages = (sourceCapabilities?.profiles ?? [])
    .filter((profile) => profile.type === "fixed")
    .map((profile) => `${((profile.voltageMv ?? 0) / 1000).toFixed(2)} V`);
  const ppsProfiles = (sourceCapabilities?.profiles ?? []).filter((profile) =>
    profile.type === "pps"
  );
  const avsProfiles = (sourceCapabilities?.profiles ?? []).filter((profile) =>
    profile.type === "avs"
  );
  const ppsRanges = ppsProfiles
    .map((profile) =>
      `${((profile.minVoltageMv ?? 0) / 1000).toFixed(2)}–${((profile.maxVoltageMv ?? 0) / 1000).toFixed(2)} V`
    );
  const avsRanges = avsProfiles
    .map((profile) =>
      `${((profile.minVoltageMv ?? 0) / 1000).toFixed(2)}–${((profile.maxVoltageMv ?? 0) / 1000).toFixed(2)} V`
    );
  const targetVoltageMv = parseVoltageMv();
  const qcVoltageOptions = snapshot?.nonPd?.allowedVoltages?.length
    ? snapshot.nonPd.allowedVoltages
    : QC_FALLBACK_VOLTAGES;
  const qcProtocolAvailable = Boolean(snapshot?.nonPd?.kind);
  const modeSupported = requestMode === "qc"
    ? qcProtocolAvailable && qcVoltageOptions.includes(requestedVoltage)
    : requestMode === "fixed"
    ? (sourceCapabilities?.profiles ?? []).some((profile) =>
      profile.type === "fixed" && profile.voltageMv === requestedVoltage * 1000
    )
    : requestMode === "pps"
    ? targetVoltageMv !== null && ppsProfiles.some((profile) =>
      targetVoltageMv >= (profile.minVoltageMv ?? 0) &&
      targetVoltageMv <= (profile.maxVoltageMv ?? 0)
    )
    : targetVoltageMv !== null && avsProfiles.some((profile) =>
      targetVoltageMv >= (profile.minVoltageMv ?? 0) &&
      targetVoltageMv <= (profile.maxVoltageMv ?? 0)
    );
  const canRequest = connected && !busy && (requestMode === "qc"
    ? qcProtocolAvailable
    : Boolean(snapshot?.pdActive) && Boolean(sourceCapabilities?.valid));

  return (
    <section className="ch224-page" aria-label="CH224A PD 取电控制">
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
          <div><h3>检测芯片并读取 PD 供电能力</h3><p>常见 7 位 I²C 地址为 0x23，部分模块配置为 0x22。</p></div>
        </div>
        <div className="ch224-action-row">
          <div className="ch224-address-control">
            <label htmlFor="ch224-address">CH224 I²C 地址</label>
            <select id="ch224-address" value={address} onChange={(event) => { setAddress(Number(event.target.value)); setSnapshot(null); }}>
              <option value={0x23}>0x23（默认）</option>
              <option value={0x22}>0x22</option>
            </select>
            {foundAddresses.length > 0 && <small>检测到：{foundAddresses.map(byteHex).join("、")}</small>}
          </div>
          <button className="button secondary" disabled={!connected || busy} onClick={() => void discover()}>
            {busy ? "扫描中…" : "扫描 0x22 / 0x23"}
          </button>
          <button className="button primary" disabled={!connected || busy} onClick={() => void readCapabilities()}>
            {busy ? "读取中…" : "读取状态与 PDO"}
          </button>
        </div>
        {pageNotice && <div className="ch224-notice" role="status">{pageNotice}</div>}
        {snapshot && (
          <div className="ch224-snapshot">
            <div className="ch224-metric-grid">
              <div><span>设备地址</span><b>{byteHex(snapshot.address)}</b></div>
              <div><span>协议状态 0x09</span><b>{byteHex(snapshot.status)}</b></div>
              <div><span>当前激活协议</span><b className={activeProtocols.length > 0 ? "good" : "bad"}>{activeProtocols.length > 0 ? activeProtocols.join("、") : snapshot.noResponse ? "读数异常（0xFF）" : "无（BC/QC2/QC3/PD/EPR 均未激活）"}</b></div>
              <div><span>PD 协议</span><b className={snapshot.pdActive ? "good" : "bad"}>{snapshot.pdActive ? "已激活" : "未激活"}</b></div>
              <div><span>电流能力 0x50</span><b>{snapshot.currentMilliAmps} mA（原始 {byteHex(snapshot.currentCode)}）</b></div>
              <div><span>读取能力对象</span><b>{sourceCapabilities?.valid ? `${sourceCapabilities.count} 个 PDO` : sourceCapabilities?.error ?? "不可用"}</b></div>
              <div><span>电压模式 0x0A</span><b>只写寄存器，不可读回</b></div>
            </div>
            <div className="ch224-protocol-flags">
              <h4>协议/能力标志（寄存器 0x09）</h4>
              <div>{statusFlags.map((flag) => (
                <span key={flag.bit} className={flag.active ? "flag-on" : ""} title={flag.description}>
                  <b>{flag.name}</b>{flag.active ? "有效" : "未置位"}
                </span>
              ))}</div>
            </div>
            {sourceCapabilities?.valid && (
              <>
                {sourceCapabilities.headerDetail && (
                  <div className="ch224-header-card">
                    <h4>PD 消息头（0x60–0x61 组合）</h4>
                    <div className="ch224-header-grid">
                      <div><span>消息类型</span><b>{sourceCapabilities.headerDetail.messageType}</b></div>
                      <div><span>PDO 数量（NumDO）</span><b>{sourceCapabilities.headerDetail.numObjects}</b></div>
                      <div><span>PD 规范版本</span><b>{sourceCapabilities.headerDetail.specRevision}</b></div>
                      <div><span>电源角色</span><b>{sourceCapabilities.headerDetail.powerRole}</b></div>
                      <div><span>数据角色</span><b>{sourceCapabilities.headerDetail.dataRole}</b></div>
                      <div><span>消息 ID</span><b>{sourceCapabilities.headerDetail.messageId}</b></div>
                      <div><span>扩展消息</span><b>{sourceCapabilities.headerDetail.extended ? "是" : "否"}</b></div>
                      <div><span>原始值</span><b>{sourceCapabilities.headerDetail.hex} · {sourceCapabilities.headerDetail.binary}</b></div>
                    </div>
                    <div className="ch224-field-list">{sourceCapabilities.headerDetail.fields.map((field) => (
                      <div key={field.name}><code>bit {field.end === field.start ? field.start : `${field.end}:${field.start}`}</code><span>{field.description}</span><b>{field.name}</b></div>
                    ))}</div>
                  </div>
                )}

                {sourceCapabilities.summary && (
                  <div className="ch224-cap-summary">
                    <h4>可供电参数汇总（全部 PDO 统计）</h4>
                    <div className="ch224-metric-grid">
                      <div><span>可用最高电压</span><b>{sourceCapabilities.summary.maxVoltageMv === null ? "—" : voltageLabel(sourceCapabilities.summary.maxVoltageMv)}</b></div>
                      <div><span>可用最大电流</span><b>{sourceCapabilities.summary.maxCurrentMa === null ? "—" : `${sourceCapabilities.summary.maxCurrentMa} mA`}</b></div>
                      <div><span>可用最大功率</span><b>{sourceCapabilities.summary.maxPowerMw === null ? "—" : `${(sourceCapabilities.summary.maxPowerMw / 1000).toFixed(2)} W`}</b></div>
                      <div><span>固定电压档位</span><b>{sourceCapabilities.summary.fixedVoltagesMv.map(voltageLabel).join("、") || "无"}</b></div>
                      <div><span>CH224A 可自动请求</span><b>{sourceCapabilities.summary.ch224aRequestableVoltagesV.map((voltage) => `${voltage} V`).join("、") || "无"}</b></div>
                      <div><span>PDO 类型统计</span><b>固定 {sourceCapabilities.summary.fixedCount} · PPS {sourceCapabilities.summary.ppsCount} · AVS {sourceCapabilities.summary.avsCount} · 电池 {sourceCapabilities.summary.batteryCount} · 可变 {sourceCapabilities.summary.variableCount} · 保留 {sourceCapabilities.summary.reservedCount}</b></div>
                      <div><span>EPR 能力</span><b>{sourceCapabilities.summary.eprCapable ? "支持" : "不支持"}</b></div>
                      <div><span>不受限电源</span><b>{sourceCapabilities.summary.unconstrainedPower ? "是" : "否"}</b></div>
                      <div><span>双角色供电</span><b>{sourceCapabilities.summary.dualRolePower ? "是" : "否"}</b></div>
                    </div>
                  </div>
                )}

                <div className="ch224-param-table">
                  <div className="ch224-subheading"><h4>各 PDO 全部参数</h4><span>类型 · 电压 · 电流 · 功率 · 各字段原始值</span></div>
                  <div className="ch224-register-table-wrap">
                    <table className="ch224-param-table-inner">
                      <thead>
                        <tr><th>#</th><th>类型</th><th>电压</th><th>电流</th><th>功率</th><th>其余参数（位 · 值）</th><th>能力标志</th><th>原始 PDO</th></tr>
                      </thead>
                      <tbody>
                        {sourceCapabilities.profiles.map((profile) => (
                          <tr key={profile.index}>
                            <td>{profile.index}</td>
                            <td>{profile.name}</td>
                            <td>{profile.type === "fixed" || profile.type === "battery" || profile.type === "variable"
                              ? `${voltageLabel(profile.voltageMv ?? profile.minVoltageMv ?? 0)}${profile.maxVoltageMv ? ` – ${voltageLabel(profile.maxVoltageMv)}` : ""}`
                              : `${voltageLabel(profile.minVoltageMv ?? 0)} – ${voltageLabel(profile.maxVoltageMv ?? 0)}`}</td>
                            <td>{profile.currentMa !== undefined
                              ? `${profile.currentMa} mA`
                              : profile.maxCurrentMa !== undefined
                              ? `最大 ${profile.maxCurrentMa} mA`
                              : "—"}</td>
                            <td>{profile.powerMw !== undefined
                              ? `${(profile.powerMw / 1000).toFixed(2)} W`
                              : profile.maxPowerMw !== undefined
                              ? `最大 ${(profile.maxPowerMw / 1000).toFixed(2)} W`
                              : "—"}</td>
                            <td className="ch224-param-cell">{profile.parameters.map((parameter) => (
                              <div key={parameter.name}><code>{parameter.bitRange}</code><span>{parameter.name}</span><b>{parameter.display}</b></div>
                            ))}{profile.parameters.length === 0 && <span className="ch224-none">无（保留布局）</span>}</td>
                            <td className="ch224-param-cell">{profile.flags.length === 0
                              ? <span className="ch224-none">—</span>
                              : profile.flags.map((flag) => (
                                <div key={flag.name}><code>bit {flag.bit}</code><span>{flag.name}</span><b className={flag.supported ? "on" : ""}>{flag.supported ? "支持" : "不支持"}</b></div>
                              ))}</td>
                            <td><code>{profile.rawHex}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="ch224-pdo-list">
                  <h4>PDO 逐项详情（含位域来源说明）</h4>
                  {sourceCapabilities.profiles.map((profile) => (
                    <article key={profile.index} className="ch224-pdo-card">
                      <div className="ch224-pdo-heading">
                        <b>PDO #{profile.index} · {profile.name}</b>
                        {profile.requestableByCh224A && <span>CH224A 固定档候选</span>}
                      </div>
                      <p>{profile.type === "fixed"
                        ? `${voltageLabel(profile.voltageMv ?? 0)} · ${profile.currentMa ?? 0} mA · ${((profile.powerMw ?? 0) / 1000).toFixed(2)} W`
                        : profile.type === "pps"
                        ? `${voltageLabel(profile.minVoltageMv ?? 0)} – ${voltageLabel(profile.maxVoltageMv ?? 0)} · 最大 ${profile.maxCurrentMa ?? 0} mA（PPS）`
                        : profile.type === "battery"
                        ? `${voltageLabel(profile.minVoltageMv ?? 0)} – ${voltageLabel(profile.maxVoltageMv ?? 0)} · 最大 ${((profile.maxPowerMw ?? 0) / 1000).toFixed(2)} W`
                        : profile.type === "variable"
                        ? `${voltageLabel(profile.minVoltageMv ?? 0)} – ${voltageLabel(profile.maxVoltageMv ?? 0)} · 最大 ${profile.maxCurrentMa ?? 0} mA`
                        : profile.type === "avs"
                        ? `${voltageLabel(profile.minVoltageMv ?? 0)} – ${voltageLabel(profile.maxVoltageMv ?? 0)} · PDP ${profile.pdpWatts ?? 0} W（EPR AVS）`
                        : `原始 PDO：${profile.rawHex}（保留或未公开布局）`}</p>
                      <details>
                        <summary>全部位域：{profile.rawHex}</summary>
                        <div className="ch224-field-list">{profile.fields.map((field) => (
                          <div key={`${field.start}-${field.end}`}><code>{field.bitRange}</code><span>{field.name}｜{field.description}</span><b>{field.display}</b></div>
                        ))}</div>
                      </details>
                    </article>
                  ))}
                </div>
              </>
            )}
            {snapshot.registers.some((item) => item.address === 0x09) && (
              <div className="ch224-register-dump">
                <div className="ch224-subheading"><h4>状态与 Source Capabilities 原始数据</h4><span>地址 · Hex · 二进制位</span></div>
                <div className="ch224-register-table-wrap">
                  <table className="ch224-register-table">
                    <thead><tr><th>寄存器</th><th>含义</th><th>Hex</th><th>Bits 7…0</th><th>位域说明</th></tr></thead>
                    <tbody>{snapshot.registers.map((item) => (
                      <tr key={item.address} className={selectedRegister?.address === item.address ? "selected" : ""} onClick={() => setSelectedRegister(item)}>
                        <td><code>{byteHex(item.address)}</code></td>
                        <td>{item.name}</td>
                        <td><code>{item.hex}</code></td>
                        <td><code className="bit-string">{item.binary}</code></td>
                        <td>{item.description}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>02</span>
          <div><h3>选择模式并自动请求取电</h3><p>PD 模式每次点击都会重新读取状态和 Source Capabilities，只有模式受支持且电压精确匹配已广播的 PDO 时才写入 0x0A；若 PD 不支持但 QC/BC 已激活，可选“QC/其它协议取电”按固定档请求。</p></div>
        </div>
        <div className="ch224-request-row">
          <div className="ch224-request-field">
            <label htmlFor="ch224-request-mode">取电模式</label>
            <select id="ch224-request-mode" value={requestMode} onChange={(event) => { setRequestMode(event.target.value as RequestMode); setRequestResult(null); }}>
              {MODE_OPTIONS.map((mode) => <option key={mode.id} value={mode.id}>{mode.label} · {mode.detail}</option>)}
            </select>
          </div>
          {requestMode === "fixed" ? (
            <div className="ch224-request-field">
              <label htmlFor="ch224-request-voltage">目标电压</label>
              <select id="ch224-request-voltage" value={requestedVoltage} onChange={(event) => { setRequestedVoltage(Number(event.target.value)); setRequestResult(null); }}>
                {FIXED_VOLTAGE_OPTIONS.map((voltage) => <option key={voltage} value={voltage}>{voltage} V</option>)}
              </select>
            </div>
          ) : requestMode === "qc" ? (
            <div className="ch224-request-field">
              <label htmlFor="ch224-request-voltage-qc">目标电压（QC/BC 固定档）</label>
              <select id="ch224-request-voltage-qc" value={requestedVoltage} onChange={(event) => { setRequestedVoltage(Number(event.target.value)); setRequestResult(null); }}>
                {qcVoltageOptions.map((voltage) => <option key={voltage} value={voltage}>{voltage} V</option>)}
              </select>
            </div>
          ) : (
            <div className="ch224-request-field">
              <label htmlFor="ch224-request-voltage-mv">目标电压（mV）</label>
              <div className="input-with-suffix">
                <input id="ch224-request-voltage-mv" type="number" min="3300" max="25500" step="100" value={requestVoltageMv} onChange={(event) => { setRequestVoltageMv(event.target.value); setRequestResult(null); }} />
                <span>mV</span>
              </div>
            </div>
          )}
          <button className="button primary" disabled={!canRequest || busy} onClick={() => void requestPower()}>
            {busy ? "正在读取/请求…" : "校验能力并请求"}
          </button>
        </div>
        {snapshot?.noResponse && (
          <div className="ch224-support-line blocked">
            <b>CH224 读写异常</b>
            <span>0x09 读回 0xFF（所有读数均为 0xFF）：模块疑似未上电或 I²C 无应答，本次数据未更新，已禁止取电请求。请检查模块 VCC/GND、供电与接线后重新读取。</span>
          </div>
        )}
        {snapshot && !snapshot.noResponse && (
          <div className={`ch224-support-line ${modeSupported ? "ok" : "blocked"}`}>
            <b>{modeSupported ? "支持检查通过" : "不支持 · 将停止取电"}</b>
            {requestMode === "qc" ? (
              <span>当前协议：{snapshot.nonPd?.label ?? "无"}；QC/BC 可用档位：{qcVoltageOptions.map((voltage) => `${voltage} V`).join("、") || "无"}（QC 走 D+/D-，不做 PD PDO 校验，仅支持固定档）</span>
            ) : (
              <span>固定档：{advertisedFixedVoltages.join("、") || "无"}；PPS 范围：{ppsRanges.join("、") || "无"}；AVS 范围：{avsRanges.join("、") || "无"}</span>
            )}
          </div>
        )}
        <div className="info-strip ch224-safety-note"><span>i</span><p>点击请求时后端会重新读取状态。PD 模式：只有 PD 激活、能力消息有效，且所选模式对应的电压范围精确包含目标电压时才会写入电压配置（固定档写 0x0A；PPS 先写 0x53 再置模式 6；AVS 先写 0x51/0x52 再置模式 7）。QC/其它协议模式：需 PD/EPR 未激活且 QC2/QC3/BC 已激活，目标电压落在该协议固定档白名单（QC：5/9/12/15/20 V；BC：5 V）内才写 0x0A，不做 PDO 校验。两种模式下，不支持都会停止取电且不写任何寄存器。0x0A 是只写寄存器，握手结果通过 0x09 状态位判断；状态位不等于 VBUS 实测电压，请用万用表确认后再接负载。</p></div>
        {requestResult && (
          <div className="ch224-request-result" role="status">
            <b>请求已发送：{requestResult.mode === "fixed"
              ? `${requestResult.requestedVoltage} V 固定 PDO`
              : requestResult.mode === "qc"
              ? `${requestResult.requestedVoltage} V ${requestResult.activeProtocol ?? "QC/其它协议"}`
              : `${((requestResult.requestedVoltageMv ?? 0) / 1000).toFixed(2)} V ${requestResult.mode.toUpperCase()}`}
            </b>
            <span>{requestResult.message}</span>
          </div>
        )}
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>03</span>
          <div><h3>手动 I²C 寄存器读写</h3><p>单字节寄存器地址与数据均输入十六进制；只写寄存器写入后无法回读，请通过 0x09 状态位判断结果。</p></div>
        </div>
        <div className="ch224-manual-grid">
          <div className="form-field">
            <label htmlFor="ch224-register-address">寄存器地址</label>
            <div className="hex-field"><span>HEX</span><input id="ch224-register-address" value={registerAddress} onChange={(event) => setRegisterAddress(event.target.value)} placeholder="09" /></div>
            <small>可读：09、50、60–8F；只写：0A、51、52、53</small>
          </div>
          <div className="form-field">
            <label htmlFor="ch224-register-value">写入数据</label>
            <div className="hex-field"><span>HEX</span><input id="ch224-register-value" value={registerWriteValue} onChange={(event) => setRegisterWriteValue(event.target.value)} placeholder="00" /></div>
            <small>00–FF；写 0x0A/0x51/0x52/0x53 会立即改变取电请求</small>
          </div>
          <div className="button-pair ch224-manual-actions">
            <button className="button secondary" disabled={!connected || busy} onClick={() => void readManualRegister()}>读取寄存器</button>
            <button className="button primary" disabled={!connected || busy} onClick={() => void writeManualRegister()}>写入并回读</button>
          </div>
        </div>
        <div className="ch224-register-map">
          <div className="ch224-subheading"><h4>寄存器地址与读写属性</h4><span>可读 / 只写</span></div>
          <div className="ch224-register-table-wrap">
            <table className="ch224-register-map-table">
              <thead><tr><th>地址</th><th>属性</th><th>名称</th><th>功能</th></tr></thead>
              <tbody>{registerMap.map((item) => (
                <tr key={item.address} className={item.access === "write" ? "write-only" : ""}
                  onClick={() => setRegisterAddress(item.address.toString(16).toUpperCase().padStart(2, "0"))}>
                  <td><code>{byteHex(item.address)}</code></td>
                  <td><span className={item.access === "read" ? "badge-read" : "badge-write"}>{item.access === "read" ? "只读" : "只写"}</span></td>
                  <td>{item.name}</td>
                  <td>{item.function}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {registerMap.length === 0 && (
            <div className="ch224-none">
              {registerState === "loading"
                ? "正在载入寄存器表…"
                : "无法获取寄存器表：本地硬件服务未启动。请启动桌面应用或 deno task dev:bridge 后重开本页。"}
            </div>
          )}
        </div>
        <div className="warning-strip ch224-write-warning"><span>!</span><p>手动写入绕过 PDO 能力校验，可能改变 USB-C 电源请求。请勿向未知、只读或保留寄存器写入；建议先读取并记录原值。切勿用它来绕过自动取电的支持能力检查。</p></div>
        {selectedRegister && <RegisterDetail register={selectedRegister} />}
      </section>

      <section className="panel ch224-section ch224-flow">
        <div className="ch224-section-title">
          <span>04</span>
          <div><h3>推荐取电流程</h3><p>按顺序确认，不要仅凭软件显示判断电源端已稳定。</p></div>
        </div>
        <ol>
          <li><b>断电接线</b><span>串口设备与 CH224A 共地；正确连接 SDA/SCL，检查模块供电及 I²C 电平。不要将 USB-C VBUS 接到串口信号脚。</span></li>
          <li><b>连接电源与负载隔离</b><span>先连接合规 USB-C PD 电源，暂不接目标负载；确认 CC/Type-C 连接完整。</span></li>
          <li><b>连接串口并扫描</b><span>扫描 0x22 / 0x23，确认目标地址有 ACK；无法识别时检查焊盘配置和接线。</span></li>
          <li><b>读取状态和 Source PDO</b><span>确认 PD_ACT 已置位，检查电源提供的固定电压与最大电流；记录原始寄存器及能力对象。</span></li>
          <li><b>选择负载允许的档位</b><span>目标电压必须同时被电源 PDO 广播、CH224A 支持且不超过负载额定值。程序会在写入前再次检查。</span></li>
          <li><b>请求后测量输出</b><span>确认寄存器回读与协议状态，再用万用表测量输出电压；电流能力还受电源、线缆、连接器和模块热设计约束。</span></li>
          <li><b>接入负载并监测</b><span>确认负载输入范围、极性和功率余量后再接入；观察温升、掉压和异常情况，异常时先断开负载及电源。</span></li>
        </ol>
      </section>
    </section>
  );
}

function RegisterDetail({ register }: { register: Ch224RegisterValue }) {
  return (
    <div className="ch224-bit-detail">
      <div className="ch224-bit-heading">
        <div><span>选中寄存器 {byteHex(register.address)}</span><h4>{register.name} · {register.hex}</h4></div>
        <code>{register.binary}</code>
      </div>
      <p>{register.description}</p>
      <div className="ch224-bit-grid">
        {register.bits.map((item) => (
          <div key={item.bit} className={item.value ? "set" : ""}>
            <b>bit {item.bit}</b><strong>{item.value}</strong><span>{item.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Ch224Panel;
