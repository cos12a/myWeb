/**
 * LIS3DH / LIS3DHTR 三轴加速度计的纯逻辑层（不含任何硬件调用）。
 *
 * 职责与 mlx90614.mjs 一致：集中维护寄存器功能表、位域定义、量程/ODR 选项、
 * 原始值→重力加速度换算、温度换算、姿态角计算与配置字节编解码。
 * 调整寄存器表或换算公式只改这里，无需触碰控制器与 UI。
 *
 * 依据 ST LIS3DH datasheet、Seeed_Arduino_LIS3DHTR（LIS3DHTR.cpp）与
 * Adafruit_LIS3DH 的既有约定：
 *   - 7 位 I²C 地址 0x18（SA0/SDO 接地）或 0x19（SA0 接 VDD）。
 *   - WHO_AM_I(0x0F) 固定返回 0x33。
 *   - 三轴输出 OUT_X_L..OUT_Z_H = 0x28..0x2D，16 位小端，数据左对齐。
 *   - I²C 多字节读必须把子地址最高位置 1 才会地址自增：0x28 | 0x80 = 0xA8。
 *   - 加速度换算 g = int16(raw) / accRange，accRange 随量程变化；
 *     三档输出模式（8/10/12 位）都左对齐到 16 位，故换算系数与模式无关。
 *   - 温度在 OUT_ADC3_H(0x0D)，Acc 库换算 T ≈ int8(高字节) + 25（约 1 °C/LSB）。
 *   - FIFO 32 级、每级 6 字节；读满 OUT_X_L..OUT_Z_H 即弹出一级。
 */

/** LIS3DH 两个可能的 7 位 I²C 地址（由 SA0 / SDO 引脚电平决定）。 */
export const LIS3DH_ADDRESSES = [0x18, 0x19];
/** 出厂默认地址（SA0 = 0）。 */
export const LIS3DH_DEFAULT_ADDRESS = 0x18;
/** WHO_AM_I 固定值。 */
export const LIS3DH_WHO_AM_I_VALUE = 0x33;

/** 器件识别寄存器。 */
export const REG_WHO_AM_I = 0x0f;
/** 三轴输出起始地址与自增读地址。 */
export const REG_OUT_X_L = 0x28;
export const OUT_AUTO_INC = 0x28 | 0x80; // 0xA8
/** 温度（ADC3）输出起始地址与自增读地址。 */
export const REG_OUT_ADC3_L = 0x0c;
export const TEMP_AUTO_INC = 0x0c | 0x80; // 0x8C
/** 状态寄存器 2：DRDY / OVR。 */
export const REG_STATUS2 = 0x27;
/** 控制寄存器地址。 */
export const REG_TEMP_CFG = 0x1f;
export const REG_CTRL_REG1 = 0x20;
export const REG_CTRL_REG2 = 0x21;
export const REG_CTRL_REG3 = 0x22;
export const REG_CTRL_REG4 = 0x23;
export const REG_CTRL_REG5 = 0x24;
export const REG_FIFO_CTRL = 0x2e;
export const REG_FIFO_SRC = 0x2f;

/** FIFO 深度：32 级，每级一组三轴（6 字节）。 */
export const FIFO_DEPTH = 32;
/** 单次 FIFO 批量读的字节上限（32 级 × 6 = 192，仍小于 READ_BLOCK 的 255）。 */
export const FIFO_MAX_BYTES = FIFO_DEPTH * 6;

/**
 * 量程表。accRange 为「1 g 对应的 16 位计数值」，沿用 Seeed/Adafruit 库；
 * mgPerDigit 为数据手册标称灵敏度（12 位模式下每 LSB 的毫重力），仅用于说明。
 */
export const FULL_SCALES = [
  { id: 0, label: "±2 g", fsBits: 0x00, accRange: 16000, mgPerDigit: 1 },
  { id: 1, label: "±4 g", fsBits: 0x10, accRange: 7282, mgPerDigit: 2 },
  { id: 2, label: "±8 g", fsBits: 0x20, accRange: 3968, mgPerDigit: 4 },
  { id: 3, label: "±16 g", fsBits: 0x30, accRange: 1280, mgPerDigit: 12 },
];

/**
 * 输出数据速率（CTRL_REG1 bit7:4）。
 * hz 为正常 / 高分辨率模式下的等效速率；hzLowPower 为低功耗（8 位）模式下的速率。
 * code 8/9 在低功耗模式下才有 1.6 kHz / 5.376 kHz，其余模式固定 1.344 kHz。
 */
export const ODR_OPTIONS = [
  { code: 0x0, hz: 0, hzLowPower: 0, label: "掉电 · Power-down" },
  { code: 0x1, hz: 1, label: "1 Hz" },
  { code: 0x2, hz: 10, label: "10 Hz" },
  { code: 0x3, hz: 25, label: "25 Hz" },
  { code: 0x4, hz: 50, label: "50 Hz" },
  { code: 0x5, hz: 100, label: "100 Hz（推荐）" },
  { code: 0x6, hz: 200, label: "200 Hz" },
  { code: 0x7, hz: 400, label: "400 Hz" },
  { code: 0x8, hz: 1344, hzLowPower: 1600, label: "1.344 kHz（低功耗 1.6 kHz）" },
  { code: 0x9, hz: 1344, hzLowPower: 5376, label: "1.344 kHz（低功耗 5.376 kHz）" },
];

/**
 * 输出模式三档（LPen 与 HR 位的组合），对应手册 Operating mode selection：
 * 低功耗 8 位 / 正常 10 位 / 高分辨率 12 位；LPen=1 且 HR=1 是禁止组合。
 * 由于数据统一左对齐到 16 位，三档的 g 换算系数相同，只影响噪声与量化精度。
 */
export const OUTPUT_MODES = [
  {
    id: "lowPower",
    label: "低功耗 · 8 位",
    lpen: 1,
    hr: 0,
    resolutionBits: 8,
    mgPerDigitAt2g: 16,
    maxOdrHz: 5376,
    note: "噪声最大，但支持 1.6 kHz / 5.376 kHz 高速率",
  },
  {
    id: "normal",
    label: "正常 · 10 位",
    lpen: 0,
    hr: 0,
    resolutionBits: 10,
    mgPerDigitAt2g: 4,
    maxOdrHz: 1344,
    note: "功耗与噪声折中",
  },
  {
    id: "highResolution",
    label: "高分辨率 · 12 位",
    lpen: 0,
    hr: 1,
    resolutionBits: 12,
    mgPerDigitAt2g: 1,
    maxOdrHz: 1344,
    note: "默认档，噪声最低（HR 模式，低 4 位为 0）",
  },
];

/**
 * FIFO 模式（FIFO_CTRL_REG bit7:6）。
 * bits 为写入 FM[7:6] 的两位编码左移结果。
 */
export const FIFO_MODES = [
  { id: "bypass", bits: 0x00, label: "Bypass · 关闭", note: "FIFO 关闭并复位，直接读输出寄存器" },
  { id: "fifo", bits: 0x40, label: "FIFO · 填满即停", note: "32 级填满后停止采集，适合低频批量读不丢样本" },
  { id: "stream", bits: 0x80, label: "Stream · 循环覆盖", note: "新的覆盖旧的，配合周期读取（推荐）" },
  { id: "streamToFifo", bits: 0xc0, label: "Stream-to-FIFO · 触发转存", note: "中断触发后切到 FIFO 模式停止覆盖" },
];

/**
 * INT1 引脚路由（CTRL_REG3），用于「中断读取」模式。
 * bits 为写入 CTRL_REG3 的值：ZYXDA=0x10（数据就绪）、WTM=0x04（FIFO 水印）。
 */
export const INT_ROUTES = [
  { id: "none", bits: 0x00, label: "不输出中断", note: "INT1 引脚保持静默" },
  { id: "dataReady", bits: 0x10, label: "数据就绪 ZYXDA → INT1", note: "每次三轴转换完成输出一个脉冲，适合逐样本推送" },
  { id: "fifoWatermark", bits: 0x04, label: "FIFO 水印 WTM → INT1", note: "FIFO 存量达到 FTH 阈值时输出，适合成批推送" },
];

/**
 * 寄存器功能表：对应前端「全部地址功能一览」。
 * kind: id 识别 / status 状态 / out 输出 / ctrl 控制 / int 中断与 FIFO。
 * access: "read" 只读 / "rw" 可读写。
 */
export const LIS3DH_REGISTERS = [
  { address: 0x07, kind: "status", access: "read", name: "STATUS_REG_AUX", function: "辅助 ADC 状态：321DA/3DA/2DA/1DA 表示 ADC1–3 有新数据；高 4 位为溢出标志" },
  { address: 0x08, kind: "out", access: "read", name: "OUT_ADC1_L", function: "辅助 ADC1 输出低字节（温度/外部信号，取决于 TEMP_CFG）" },
  { address: 0x09, kind: "out", access: "read", name: "OUT_ADC1_H", function: "辅助 ADC1 输出高字节" },
  { address: 0x0a, kind: "out", access: "read", name: "OUT_ADC2_L", function: "辅助 ADC2 输出低字节" },
  { address: 0x0b, kind: "out", access: "read", name: "OUT_ADC2_H", function: "辅助 ADC2 输出高字节" },
  { address: 0x0c, kind: "out", access: "read", name: "OUT_ADC3_L", function: "辅助 ADC3 低字节；TEMP_EN=1 时与 0x0D 组成温度输出" },
  { address: 0x0d, kind: "out", access: "read", name: "OUT_ADC3_H", function: "温度输出（有符号 8 位，约 1 °C/LSB，读数 = raw + 25 °C）" },
  { address: 0x0e, kind: "status", access: "read", name: "INT_COUNTER_REG", function: "INT1 中断事件计数器（可用于计步/唤醒统计）" },
  { address: 0x0f, kind: "id", access: "read", name: "WHO_AM_I", function: "器件识别码，LIS3DH 固定为 0x33" },
  { address: 0x1e, kind: "ctrl", access: "rw", name: "CTRL_REG0", function: "I²C 模式下仅 bit7 SDO_PU_DISC（SDO/SA0 上拉断开）有效" },
  { address: 0x1f, kind: "ctrl", access: "rw", name: "TEMP_CFG_REG", function: "bit7 ADC_PD 使能辅助 ADC；bit6 TEMP_EN 把温度传感器接到 ADC3（占用 ADC3）" },
  { address: 0x20, kind: "ctrl", access: "rw", name: "CTRL_REG1", function: "ODR[7:4] 输出速率、LPen 低功耗、Zen/Yen/Xen 三轴使能；0x00 = 掉电" },
  { address: 0x21, kind: "ctrl", access: "rw", name: "CTRL_REG2", function: "高通滤波：HPM[7:6] 模式、HPCF[5:4] 截止频率、FDS 滤波数据选择、HPCLICK/HP_IA2/HP_IA1" },
  { address: 0x22, kind: "ctrl", access: "rw", name: "CTRL_REG3", function: "INT1 引脚中断路由（高有效）：CLICK/IA1/IA2/ZYXDA/321DA/WTM/OVERRUN" },
  { address: 0x23, kind: "ctrl", access: "rw", name: "CTRL_REG4", function: "BDU 块更新、BLE 字节序、FS[5:4] 量程、HR 高分辨率、ST 自检、SIM SPI 线数" },
  { address: 0x24, kind: "ctrl", access: "rw", name: "CTRL_REG5", function: "BOOT 重载校准、FIFO_EN、LIR_INT1/2 锁存中断、D4D_INT1/2 4D 检测" },
  { address: 0x25, kind: "ctrl", access: "rw", name: "CTRL_REG6", function: "INT2 引脚配置：I2_CLICKEN/I2_IA1/I2_IA2/I2_BOOT/I2_ACT、INT_POLARITY" },
  { address: 0x26, kind: "ctrl", access: "rw", name: "REFERENCE", function: "高通滤波参考值（8 位），写入当前读数可把姿态角清零" },
  { address: 0x27, kind: "status", access: "read", name: "STATUS_REG2", function: "bit7 ZYXOR/bit6:4 各轴溢出；bit3 ZYXDA 三轴新数据；bit2:0 ZDA/YDA/XDA" },
  { address: 0x28, kind: "out", access: "read", name: "OUT_X_L", function: "X 轴加速度低字节（与 0x29 组成 16 位小端有符号值）" },
  { address: 0x29, kind: "out", access: "read", name: "OUT_X_H", function: "X 轴加速度高字节（数据 12 位左对齐，低 4 位为 0）" },
  { address: 0x2a, kind: "out", access: "read", name: "OUT_Y_L", function: "Y 轴加速度低字节" },
  { address: 0x2b, kind: "out", access: "read", name: "OUT_Y_H", function: "Y 轴加速度高字节" },
  { address: 0x2c, kind: "out", access: "read", name: "OUT_Z_L", function: "Z 轴加速度低字节" },
  { address: 0x2d, kind: "out", access: "read", name: "OUT_Z_H", function: "Z 轴加速度高字节" },
  { address: 0x2e, kind: "ctrl", access: "rw", name: "FIFO_CTRL_REG", function: "FM[7:6] FIFO 模式（Bypass/FIFO/Stream/Stream-to-FIFO）、FTH[4:0] 水位阈值" },
  { address: 0x2f, kind: "status", access: "read", name: "FIFO_SRC_REG", function: "WTM 到水位、OVRN_FIFO 溢出、EMPTY 空、FSS[4:0] 已存样本数" },
  { address: 0x30, kind: "int", access: "rw", name: "INT1_CFG", function: "AOI 与/或、6D 位置识别、ZHIE/ZLIE/YHIE/YLIE/XHIE/XLIE 各方向使能" },
  { address: 0x31, kind: "int", access: "read", name: "INT1_SRC", function: "中断源：IA 有中断、ZH/ZL/YH/YL/XH/XL 方向标志" },
  { address: 0x32, kind: "int", access: "rw", name: "INT1_THS", function: "中断阈值（7 位），LSB = 16 mg @ ±2 g" },
  { address: 0x33, kind: "int", access: "rw", name: "INT1_DURATION", function: "中断持续时间（7 位），1 LSB = 1/ODR" },
  { address: 0x38, kind: "int", access: "rw", name: "CLICK_CFG", function: "单击/双击识别使能：ZD/ZC/YS/YD/XS/XD" },
  { address: 0x39, kind: "int", access: "read", name: "CLICK_SRC", function: "单击/双击结果：IA、DClick、SClick、Sign 与 Z/Y/X 轴标志" },
  { address: 0x3a, kind: "int", access: "rw", name: "CLICK_THS", function: "单击/双击加速度阈值（7 位）" },
  { address: 0x3b, kind: "int", access: "rw", name: "TIME_LIMIT", function: "单击最长持续时间（1 LSB = 1/ODR）" },
  { address: 0x3c, kind: "int", access: "rw", name: "TIME_LATENCY", function: "双击开始的等待时间" },
  { address: 0x3d, kind: "int", access: "rw", name: "TIME_WINDOW", function: "双击窗口时间，超出后判为两次单击" },
];

/** 位域定义：low/high 为位号区间，values 为枚举显示。 */
export const REGISTER_FIELDS = {
  0x1f: [
    { low: 7, high: 7, name: "ADC_PD", description: "1 = 使能辅助 ADC（读温度前必须置 1）" },
    { low: 6, high: 6, name: "TEMP_EN", description: "1 = 温度传感器接到 ADC3（此时 OUT_ADC3 为温度）" },
  ],
  0x20: [
    {
      low: 7, high: 4, name: "ODR", description: "输出数据速率",
      values: {
        0: "掉电", 1: "1 Hz", 2: "10 Hz", 3: "25 Hz", 4: "50 Hz",
        5: "100 Hz", 6: "200 Hz", 7: "400 Hz", 8: "1.6 kHz", 9: "1.25/5 kHz",
      },
    },
    { low: 3, high: 3, name: "LPen", description: "1 = 低功耗（8 位）0 = 正常（10 位）；不能用 HR" },
    { low: 2, high: 2, name: "Zen", description: "Z 轴使能" },
    { low: 1, high: 1, name: "Yen", description: "Y 轴使能" },
    { low: 0, high: 0, name: "Xen", description: "X 轴使能" },
  ],
  0x21: [
    { low: 7, high: 6, name: "HPM", description: "高通滤波模式：00 正常复位、01 参考信号、10 正常、11 自动复位" },
    { low: 5, high: 4, name: "HPCF", description: "高通截止频率（高 4 位系数）" },
    { low: 3, high: 3, name: "FDS", description: "1 = 中断与方向判定使用高通滤波后的数据" },
    { low: 2, high: 2, name: "HPCLICK", description: "单击识别使用高通滤波数据" },
    { low: 1, high: 1, name: "HP_IA2", description: "INT2 使用高通滤波数据" },
    { low: 0, high: 0, name: "HP_IA1", description: "INT1 使用高通滤波数据" },
  ],
  0x22: [
    { low: 7, high: 7, name: "I1_CLICK", description: "单击/双击中断路由到 INT1" },
    { low: 6, high: 6, name: "I1_IA1", description: "INT1_CFG 组合中断路由到 INT1" },
    { low: 5, high: 5, name: "I1_IA2", description: "INT2_CFG 组合中断路由到 INT1" },
    { low: 4, high: 4, name: "I1_ZYXDA", description: "1 = 数据就绪（ZYXDA）脉冲输出到 INT1（中断读取模式）" },
    { low: 3, high: 3, name: "I1_321DA", description: "1 = FIFO 达到 32/16/8 级时输出到 INT1" },
    { low: 2, high: 2, name: "I1_WTM", description: "1 = FIFO 水印（WTM）输出到 INT1" },
    { low: 1, high: 1, name: "I1_OVERRUN", description: "1 = FIFO 溢出时输出到 INT1" },
    { low: 0, high: 0, name: "保留", description: "固定 0" },
  ],
  0x23: [
    { low: 7, high: 7, name: "BDU", description: "1 = 读 MSB/LSB 期间输出寄存器不更新" },
    { low: 6, high: 6, name: "BLE", description: "1 = 大端（MSB 在前）；本工具固定小端" },
    { low: 5, high: 4, name: "FS", description: "量程", values: { 0: "±2 g", 1: "±4 g", 2: "±8 g", 3: "±16 g" } },
    { low: 3, high: 3, name: "HR", description: "1 = 高分辨率 12 位输出" },
    { low: 2, high: 1, name: "ST", description: "自检模式（00 = 正常）" },
    { low: 0, high: 0, name: "SIM", description: "SPI 3/4 线选择（I²C 无关）" },
  ],
  0x24: [
    { low: 7, high: 7, name: "BOOT", description: "1 = 重载校准参数（复位后自动清 0）" },
    { low: 6, high: 6, name: "FIFO_EN", description: "1 = 使能 FIFO（必须开，FIFO_CTRL 才生效）" },
    { low: 5, high: 5, name: "保留", description: "固定 0" },
    { low: 4, high: 4, name: "保留", description: "固定 0" },
    { low: 3, high: 3, name: "LIR_INT1", description: "INT1 中断锁存（读到 INT1_SRC 后清除）" },
    { low: 2, high: 2, name: "D4D_INT1", description: "INT1 上的 4D 位置识别使能" },
    { low: 1, high: 0, name: "保留", description: "固定 0" },
  ],
  0x25: [
    { low: 7, high: 7, name: "I2_CLICK", description: "单击/双击中断路由到 INT2" },
    { low: 6, high: 6, name: "I2_IA1", description: "INT1_CFG 组合中断路由到 INT2" },
    { low: 5, high: 5, name: "I2_IA2", description: "INT2_CFG 组合中断路由到 INT2" },
    { low: 4, high: 4, name: "I2_BOOT", description: "启动事件路由到 INT2" },
    { low: 3, high: 3, name: "I2_ACT", description: "活动/睡眠状态路由到 INT2" },
    { low: 1, high: 1, name: "INT_POLARITY", description: "1 = 中断低有效（默认高有效）" },
  ],
  0x27: [
    { low: 7, high: 7, name: "ZYXOR", description: "三轴数据整体溢出（读数被覆盖）" },
    { low: 6, high: 6, name: "ZOR", description: "Z 轴溢出" },
    { low: 5, high: 5, name: "YOR", description: "Y 轴溢出" },
    { low: 4, high: 4, name: "XOR", description: "X 轴溢出" },
    { low: 3, high: 3, name: "ZYXDA", description: "三轴新数据就绪" },
    { low: 2, high: 2, name: "ZDA", description: "Z 轴新数据就绪" },
    { low: 1, high: 1, name: "YDA", description: "Y 轴新数据就绪" },
    { low: 0, high: 0, name: "XDA", description: "X 轴新数据就绪" },
  ],
  0x2e: [
    {
      low: 7, high: 6, name: "FM", description: "FIFO 模式",
      values: { 0: "Bypass", 1: "FIFO", 2: "Stream", 3: "Stream-to-FIFO" },
    },
    { low: 4, high: 0, name: "FTH", description: "FIFO 水印阈值（达到即置 WTM，1–31）" },
  ],
  0x2f: [
    { low: 7, high: 7, name: "WTM", description: "FIFO 达到水位阈值" },
    { low: 6, high: 6, name: "OVRN", description: "FIFO 溢出（最旧样本被丢弃）" },
    { low: 5, high: 5, name: "EMPTY", description: "FIFO 为空" },
    { low: 4, high: 0, name: "FSS", description: "FIFO 中已存样本数" },
  ],
  0x30: [
    { low: 7, high: 7, name: "AOI", description: "1 = 任一方向满足即中断；0 = 全部条件同时满足" },
    { low: 6, high: 6, name: "6D", description: "1 = 6D 位置识别（方向变化即中断）" },
    { low: 5, high: 5, name: "ZHIE", description: "Z 正向（高）使能" },
    { low: 4, high: 4, name: "ZLIE", description: "Z 负向（低）使能" },
    { low: 3, high: 3, name: "YHIE", description: "Y 正向使能" },
    { low: 2, high: 2, name: "YLIE", description: "Y 负向使能" },
    { low: 1, high: 1, name: "XHIE", description: "X 正向使能" },
    { low: 0, high: 0, name: "XLIE", description: "X 负向使能" },
  ],
  0x39: [
    { low: 6, high: 6, name: "IA", description: "发生单击/双击中断" },
    { low: 5, high: 5, name: "DClick", description: "识别到双击" },
    { low: 4, high: 4, name: "SClick", description: "识别到单击" },
    { low: 3, high: 3, name: "Sign", description: "事件方向（1 = 负向）" },
    { low: 2, high: 2, name: "Z", description: "事件发生在 Z 轴" },
    { low: 1, high: 1, name: "Y", description: "事件发生在 Y 轴" },
    { low: 0, high: 0, name: "X", description: "事件发生在 X 轴" },
  ],
};

/** 非法 id 的回落值：独立字面量，避免索引访问带来的 undefined。 */
const FALLBACK_FULL_SCALE = {
  id: 0,
  label: "±2 g",
  fsBits: 0x00,
  accRange: 16000,
  mgPerDigit: 1,
};
const FALLBACK_ODR = { code: 0x0, hz: 0, hzLowPower: 0, label: "掉电 · Power-down" };
/** 三个回退值用独立字面量（索引访问在 TS 侧会被视为可能 undefined）。 */
const FALLBACK_OUTPUT_MODE = {
  id: "highResolution",
  label: "高分辨率 · 12 位",
  lpen: 0,
  hr: 1,
  resolutionBits: 12,
  mgPerDigitAt2g: 1,
  maxOdrHz: 1344,
  note: "默认档，噪声最低（HR 模式，低 4 位为 0）",
};
const FALLBACK_FIFO_MODE = {
  id: "bypass",
  bits: 0x00,
  label: "Bypass · 关闭",
  note: "FIFO 关闭并复位，直接读输出寄存器",
};
const FALLBACK_INT_ROUTE = {
  id: "none",
  bits: 0x00,
  label: "不输出中断",
  note: "INT1 引脚保持静默",
};

/** 按 id 取量程定义；非法 id 回落到 ±2 g。 */
export function fullScaleById(id) {
  for (const item of FULL_SCALES) {
    if (item.id === id) return item;
  }
  return FALLBACK_FULL_SCALE;
}

/** 按 ODR code 取速率定义；非法 code 回落到掉电档。 */
export function odrByCode(code) {
  for (const item of ODR_OPTIONS) {
    if (item.code === code) return item;
  }
  return FALLBACK_ODR;
}

/** 按输出模式 id 取模式定义；非法 id 回落到高分辨率。 */
export function outputModeById(id) {
  for (const item of OUTPUT_MODES) {
    if (item.id === id) return item;
  }
  return FALLBACK_OUTPUT_MODE;
}

/** 按 FIFO 模式 id 取定义；非法 id 回落到 Bypass。 */
export function fifoModeById(id) {
  for (const item of FIFO_MODES) {
    if (item.id === id) return item;
  }
  return FALLBACK_FIFO_MODE;
}

/** 按中断路由 id 取定义；非法 id 回落到无中断。 */
export function intRouteById(id) {
  for (const item of INT_ROUTES) {
    if (item.id === id) return item;
  }
  return FALLBACK_INT_ROUTE;
}

/** 按 CTRL_REG3 位反推中断路由 id。 */
export function intRouteFromBits(bits) {
  if ((bits & 0x10) !== 0) return "dataReady";
  if ((bits & 0x04) !== 0) return "fifoWatermark";
  return "none";
}

/** 给定输出模式时该 ODR 档的实际速率（低功耗模式下 code 8/9 更高）。 */
export function odrHzFor(code, outputMode = "highResolution") {
  const option = odrByCode(code);
  if (outputMode === "lowPower") {
    const lowPowerHz = option.hzLowPower;
    if (typeof lowPowerHz === "number") return lowPowerHz;
  }
  return option.hz;
}

/** FIFO 默认配置：关闭、Stream 模式、水印 16 级。 */
export function defaultFifoConfig() {
  return { enabled: false, mode: "stream", threshold: 16 };
}

/** FIFO 配置 → CTRL_REG5 与 FIFO_CTRL_REG 字节。关闭时写 Bypass 复位 FIFO。 */
export function buildFifoRegisters(fifo) {
  const merged = { ...defaultFifoConfig(), ...(fifo ?? {}) };
  const mode = fifoModeById(merged.mode);
  const rawThreshold = Number(merged.threshold);
  const threshold = Number.isFinite(rawThreshold)
    ? Math.max(0, Math.min(0x1f, Math.round(rawThreshold)))
    : 16;
  return {
    ctrlReg5: merged.enabled ? 0x40 : 0x00,
    fifoCtrl: merged.enabled ? (mode.bits | (threshold & 0x1f)) : 0x00,
  };
}

/** CTRL_REG5 + FIFO_CTRL_REG 字节 → FIFO 配置对象。 */
export function decodeFifoConfig(ctrlReg5, fifoCtrl) {
  const enabled = (ctrlReg5 & 0x40) !== 0;
  const modeBits = fifoCtrl & 0xc0;
  let mode = FALLBACK_FIFO_MODE;
  for (const item of FIFO_MODES) {
    if (item.bits === modeBits) mode = item;
  }
  return {
    enabled,
    mode: mode.id,
    modeLabel: mode.label,
    threshold: fifoCtrl & 0x1f,
    raw: fifoCtrl,
  };
}

/**
 * FIFO_SRC_REG → 可读标志。pending 为可批量读出的样本数：
 * 满级时 FSS 编码为 31，保守取 31（剩余一级下轮再读，不引入重复）。
 */
export function decodeFifoSrc(value) {
  const raw = value & 0xff;
  const empty = (raw & 0x20) !== 0;
  const level = raw & 0x1f;
  return {
    raw,
    watermark: (raw & 0x80) !== 0,
    overrun: (raw & 0x40) !== 0,
    empty,
    level,
    pending: empty ? 0 : Math.min(level, FIFO_DEPTH),
  };
}

/**
 * FIFO 读取周期建议：给定速率与水印阈值，返回不溢出的最大读取间隔（毫秒）。
 * 取可用深度 = threshold（未给则 32），并保留一档余量。
 */
export function fifoIntervalHint(odrHz, threshold) {
  const usable = Number.isFinite(threshold) && threshold > 0
    ? Math.min(FIFO_DEPTH, Math.round(threshold))
    : FIFO_DEPTH;
  if (!Number.isFinite(odrHz) || odrHz <= 0) {
    return { maxIntervalMs: 1000, usableDepth: usable };
  }
  const maxIntervalMs = Math.max(1, Math.floor((usable / odrHz) * 1000));
  return { maxIntervalMs, usableDepth: usable };
}

/** 16 位无符号合成 → 有符号。 */
export function toSigned16(value) {
  return ((value & 0xffff) << 16) >> 16;
}

/** 低/高字节合成 16 位无符号值。 */
export function combineBytes(low, high) {
  return ((low & 0xff) | ((high & 0xff) << 8)) & 0xffff;
}

/** 原始 16 位计数 → 重力加速度（g）。 */
export function rawToG(raw, fullScaleId) {
  const scale = fullScaleById(fullScaleId);
  return toSigned16(raw) / scale.accRange;
}

/**
 * 六字节输出解码为三轴原始值（有符号）、g 值、合加速度与姿态角。
 * bytes 顺序：X_L, X_H, Y_L, Y_H, Z_L, Z_H。
 */
export function decodeAcceleration(bytes, fullScaleId) {
  if (!bytes || bytes.length < 6) {
    throw new RangeError("三轴输出至少需要 6 个字节（0x28–0x2D）。");
  }
  const raw = {
    x: toSigned16(combineBytes(bytes[0], bytes[1])),
    y: toSigned16(combineBytes(bytes[2], bytes[3])),
    z: toSigned16(combineBytes(bytes[4], bytes[5])),
  };
  const scale = fullScaleById(fullScaleId);
  const g = {
    x: raw.x / scale.accRange,
    y: raw.y / scale.accRange,
    z: raw.z / scale.accRange,
  };
  return {
    raw,
    g,
    magnitude: Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z),
    ...computeTilt(g),
  };
}

/**
 * 批量输出解码：bytes 为 6×N 字节（FIFO 一次事务读回的连续样本），
 * 返回 N 个与 decodeAcceleration 同构的样本（时间顺序 = FIFO 弹出顺序）。
 */
export function decodeAccelerationBatch(bytes, fullScaleId) {
  if (!bytes || bytes.length < 6) {
    throw new RangeError("批量解码至少需要 6 个字节（一组三轴输出）。");
  }
  const samples = [];
  for (let offset = 0; offset + 6 <= bytes.length; offset += 6) {
    samples.push(decodeAcceleration(bytes.slice(offset, offset + 6), fullScaleId));
  }
  return samples;
}

/**
 * 姿态角（度）。pitch 绕 Y 轴、roll 绕 X 轴，用水平投影归一化，
 * 在任意姿态下都不会出现除零。
 */
export function computeTilt(g) {
  const toDeg = 180 / Math.PI;
  return {
    pitch: Math.atan2(-g.x, Math.hypot(g.y, g.z)) * toDeg,
    roll: Math.atan2(g.y, Math.hypot(g.x, g.z)) * toDeg,
  };
}

/**
 * 温度换算：OUT_ADC3_H 为有符号 8 位，1 °C/LSB，+25 °C 偏移。
 * 与 Seeed LIS3DHTR::getTemperature()（int16 / 256 + 25）等价。
 */
export function temperatureRawToCelsius(low, high) {
  const raw = ((high & 0xff) << 24) >> 24;
  return raw + 25;
}

/** 温度原始读数 → 结构化结果。全 0 视为温度通道未启用。 */
export function decodeTemperature(low, high) {
  const raw = ((high & 0xff) << 24) >> 24;
  const enabled = !(low === 0 && high === 0);
  return {
    raw,
    celsius: enabled ? raw + 25 : null,
    enabled,
  };
}

/**
 * 由配置推导输出模式：优先 outputMode 字符串，其次兼容旧 lowPower/highResolution 布尔。
 */
export function resolveOutputMode(config) {
  const source = config ?? {};
  if (typeof source.outputMode === "string") {
    return outputModeById(source.outputMode);
  }
  if (source.lowPower === true) return outputModeById("lowPower");
  if (source.highResolution === false) return outputModeById("normal");
  return outputModeById("highResolution");
}

/** 默认配置：100 Hz、±2 g、高分辨率 12 位、BDU 开、温度关、FIFO 关、无中断输出。 */
export function defaultConfig() {
  return {
    odrCode: 0x5,
    fullScale: 0,
    outputMode: "highResolution",
    blockDataUpdate: true,
    axes: { x: true, y: true, z: true },
    tempEnable: false,
    intRoute: "none",
    fifo: defaultFifoConfig(),
  };
}

/**
 * 配置 → 六个寄存器字节。
 * CTRL_REG1 = ODR<<4 | LPen | Zen | Yen | Xen
 * CTRL_REG3 = INT1 路由（ZYXDA / WTM，默认 0）
 * CTRL_REG4 = BDU<<7 | FS<<4 | HR<<3（BLE 固定 0 = 小端）
 * CTRL_REG5 = FIFO_EN<<6
 * TEMP_CFG  = ADC_PD | TEMP_EN<<6
 * FIFO_CTRL = FM<<6 | FTH
 */
export function buildConfigRegisters(config) {
  const source = config ?? {};
  const merged = { ...defaultConfig(), ...source };
  const axes = { ...defaultConfig().axes, ...(merged.axes ?? {}) };
  // 输出模式从原始入参解析：显式 outputMode 优先，兼容旧 lowPower/highResolution 布尔。
  const mode = resolveOutputMode(source);
  const odrCode = odrByCode(merged.odrCode).code;
  const ctrlReg1 = ((odrCode & 0x0f) << 4) |
    (mode.lpen ? 0x08 : 0x00) |
    (axes.z ? 0x04 : 0x00) |
    (axes.y ? 0x02 : 0x00) |
    (axes.x ? 0x01 : 0x00);
  const ctrlReg3 = intRouteById(merged.intRoute).bits;
  const ctrlReg4 = (merged.blockDataUpdate ? 0x80 : 0x00) |
    fullScaleById(merged.fullScale).fsBits |
    (mode.hr ? 0x08 : 0x00);
  const tempCfg = 0x80 | (merged.tempEnable ? 0x40 : 0x00);
  const fifo = { ...defaultFifoConfig(), ...(merged.fifo ?? {}) };
  const fifoRegisters = buildFifoRegisters(fifo);
  return {
    ctrlReg1,
    ctrlReg3,
    ctrlReg4,
    ctrlReg5: fifoRegisters.ctrlReg5,
    tempCfg,
    fifoCtrl: fifoRegisters.fifoCtrl,
  };
}

/** 六个寄存器字节 → 配置对象（「检测器件」后同步 UI 用）。 */
export function decodeConfig(
  ctrlReg1,
  ctrlReg4,
  tempCfg,
  ctrlReg3 = 0x00,
  ctrlReg5 = 0x00,
  fifoCtrl = 0x00,
) {
  const odrCode = (ctrlReg1 >> 4) & 0x0f;
  const lowPower = (ctrlReg1 & 0x08) !== 0;
  const highResolution = (ctrlReg4 & 0x08) !== 0;
  const mode = resolveOutputMode({ lowPower, highResolution });
  return {
    odrCode,
    odrHz: odrHzFor(odrCode, mode.id),
    outputMode: mode.id,
    outputModeLabel: mode.label,
    resolutionBits: mode.resolutionBits,
    lowPower,
    highResolution,
    axes: {
      x: (ctrlReg1 & 0x01) !== 0,
      y: (ctrlReg1 & 0x02) !== 0,
      z: (ctrlReg1 & 0x04) !== 0,
    },
    fullScale: (ctrlReg4 >> 4) & 0x03,
    blockDataUpdate: (ctrlReg4 & 0x80) !== 0,
    bigEndian: (ctrlReg4 & 0x40) !== 0,
    tempEnable: (tempCfg & 0x40) !== 0,
    adcPowered: (tempCfg & 0x80) !== 0,
    intRoute: intRouteFromBits(ctrlReg3),
    intRouteBits: ctrlReg3,
    fifo: decodeFifoConfig(ctrlReg5, fifoCtrl),
  };
}

/** 状态寄存器 2 → 可读标志。 */
export function decodeStatus2(value) {
  return {
    dataReady: (value & 0x08) !== 0,
    overrun: (value & 0xf0) !== 0,
  };
}

function findRegister(address) {
  return LIS3DH_REGISTERS.find((item) => item.address === address) ?? null;
}

function fieldDisplay(field, value) {
  if (field.values && field.values[value] !== undefined) {
    return field.values[value];
  }
  if (field.high === field.low) return String(value);
  return `${value}（0x${value.toString(16).toUpperCase()}）`;
}

/**
 * 生成寄存器的可读解读（供前端展示）。
 * value 为 8 位原始值；命中位域表时附带逐字段解码。
 */
export function describeRegister(address, value) {
  const meta = findRegister(address);
  const raw = value & 0xff;
  const hex = `0x${raw.toString(16).toUpperCase().padStart(2, "0")}`;
  const definitions = REGISTER_FIELDS[address] ?? [];
  return {
    address,
    hex,
    binary: raw.toString(2).padStart(8, "0"),
    raw,
    name: meta?.name ??
      `未定义寄存器 0x${address.toString(16).padStart(2, "0").toUpperCase()}`,
    kind: meta?.kind ?? "out",
    access: meta?.access ?? "read",
    description: meta?.function ??
      "LIS3DH 未在本工具寄存器表中定义此地址，读值仅作原始数据展示，写入前请核对数据手册。",
    fields: definitions.length === 0 ? undefined : definitions.map((field) => {
      // 位域可用高位在前书写（如 ODR 的 7:4），这里归一化后再取 mask。
      const lowBit = Math.min(field.low, field.high);
      const highBit = Math.max(field.low, field.high);
      const mask = ((1 << (highBit - lowBit + 1)) - 1) << lowBit;
      const fieldValue = (raw & mask) >>> lowBit;
      return {
        low: lowBit,
        high: highBit,
        bits: highBit === lowBit ? String(lowBit) : `${highBit}:${lowBit}`,
        name: field.name,
        value: fieldValue,
        display: fieldDisplay(field, fieldValue),
        description: field.description,
      };
    }),
  };
}
