/**
 * Node-RED 函数节点：解析 MQTT 加热垫数据 → InfluxDB 格式
 *
 * 输入：MQTT 订阅节点（topic: /unito/heating-bed/hub-ctrl-data 或 /unito/heating-bed/hub-report-data）
 * 输出：msg.payload 为 InfluxDB 写入格式数组
 *
 * 使用方法：
 *   1. 将本文件全部内容复制到 Node-RED 的 function 节点中
 *   2. 函数节点上游连接 MQTT-in 节点
 *   3. 函数节点下游连接 InfluxDB-out 节点
 */

// ============================================================
// 协议常量（与 serial-protocol.js 保持一致）
// ============================================================
const MSGTYPE = {
    WORK: 0x0B01,
    ERROR: 0x0B02,
    END: 0x0B04,
    CTRL_WORK: 0x0A01,
    TH: 0x0A05,
    PERIODIC_TEMP: 0x0A06,
    UNITO_MSGTYPE_SYSID: 0x0A07,
    UNITO_SET_TEMP01C: 0x0A08,
    UNITO_SET_TIME: 0x0A09,
    UNITO_SET_REBOOT: 0x0A0B,
    UNITO_SET_CLEAR_FAULT: 0x0A0C,
    UNITO_MSGTYPE_SIM_TEMP: 0x0A0D
};

const MSGOP = {
    GET: 0x01,
    SET: 0x02,
    CLEAR: 0x03,
    RESPONSE: 0x04,
    REPORT: 0x05
};

// ============================================================
// 串口协议解析器（内联版，不依赖外部文件）
// ============================================================
class SerialDataParser {
    constructor() {
        this.receivedBuffer = Buffer.alloc(0);
    }

    parseReceivedData(data) {
        if (!data || data.length === 0) return [];

        const inputBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this.receivedBuffer = Buffer.concat([this.receivedBuffer, inputBuf]);
        const packets = [];
        let index = 0;

        while (index < this.receivedBuffer.length) {
            const frameStartIndex = this.findFrameHeader(this.receivedBuffer, index);

            if (frameStartIndex === -1) {
                this.receivedBuffer = this.receivedBuffer.slice(index);
                break;
            }

            if (this.receivedBuffer.length - frameStartIndex >= 9) {
                const dataLen = this.receivedBuffer[frameStartIndex + 6];
                const requiredLength = 7 + dataLen + 2;

                if (this.receivedBuffer.length - frameStartIndex >= requiredLength) {
                    const packet = this.receivedBuffer.slice(frameStartIndex, frameStartIndex + requiredLength);

                    if (this.verifyChecksum(packet)) {
                        packets.push(packet);
                        index = frameStartIndex + requiredLength;
                    } else {
                        index = frameStartIndex + 1;
                    }
                } else {
                    this.receivedBuffer = this.receivedBuffer.slice(index);
                    break;
                }
            } else {
                this.receivedBuffer = this.receivedBuffer.slice(index);
                break;
            }
        }

        this.receivedBuffer = this.receivedBuffer.slice(index);
        return packets;
    }

    parseMessage(packet) {
        if (packet.length < 9) return null;

        const endByte = packet[packet.length - 1];
        if (endByte !== 0xFF) return null;

        const payloadLength = packet[6];
        if (packet.length !== 7 + payloadLength + 2) return null;

        return {
            targetAddr: packet[1],
            senderAddr: packet[2],
            msgId: (packet[4] << 8) | packet[3],
            msgOp: packet[5],
            payload: Array.from(packet.slice(7, 7 + payloadLength)),
            checksum: packet[7 + payloadLength],
            endByte: packet[7 + payloadLength + 1],
            timestamp: Date.now()
        };
    }

    findFrameHeader(buffer, startIndex) {
        for (let i = startIndex; i <= buffer.length - 3; i++) {
            if (buffer[i] === 0x00) return i;
        }
        return -1;
    }

    verifyChecksum(packet) {
        if (packet.length < 9) return false;
        const endByte = packet[packet.length - 1];
        if (endByte !== 0xFF) return false;
        const checksumIndex = packet.length - 2;
        const receivedChecksum = packet[checksumIndex];
        let sum = 0;
        for (let i = 0; i < checksumIndex; i++) {
            sum += packet[i];
        }
        const expectedChecksum = (0x100 - (sum & 0x7F)) & 0xFF;
        return receivedChecksum === expectedChecksum;
    }
}

// ============================================================
// 辅助函数：ADC 值转电流（mA）
// ============================================================
function adcToCurrent(adcValue) {
    if (adcValue === undefined || adcValue === null) return 0;
    return adcValue * 0.72;
}

// ============================================================
// 辅助函数：解析温度（小数 + 整数 → 浮点数）
// ============================================================
function parseTemperature(decimalByte, integerByte) {
    return parseFloat((integerByte + decimalByte / 10).toFixed(1));
}

// ============================================================
// 辅助函数：读取 uint16 little-endian
// ============================================================
function readUint16LE(payload, index) {
    if (payload.length >= index + 2) {
        return (payload[index + 1] << 8) | payload[index];
    }
    return 0;
}

// ============================================================
// 核心：解析 PERIODIC_TEMP / WORK_RESPONSE → InfluxDB 字段
//   短包(2字节) → 仅返回 bodyTemp / footTemp
//   长包(>=12字节) → 按实际数据长度增量添加已解析字段
// ============================================================
function parseTempPayload(payload) {
    const fields = {};

    // --- 短包（2 字节）：仅温度 ---
    if (payload.length === 2) {
        fields.bodyTemp = parseFloat(payload[0]);
        fields.footTemp = parseFloat(payload[1]);
        return fields;
    }

    // --- 长包（>=12 字节）：按实际有效长度增量添加字段 ---
    // 实时温度
    if (payload.length >= 2) {
        fields.bodyTemp = parseTemperature(payload[0], payload[1]);
    }
    if (payload.length >= 4) {
        fields.footTemp = parseTemperature(payload[2], payload[3]);
    }
    // 原始设置温度
    if (payload.length >= 6) {
        fields.bodyRawTemp = parseTemperature(payload[4], payload[5]);
    }
    if (payload.length >= 8) {
        fields.footRawTemp = parseTemperature(payload[6], payload[7]);
    }
    // 目标温度
    if (payload.length >= 10) {
        fields.bodyTargetTemp = parseTemperature(payload[8], payload[9]);
    }
    if (payload.length >= 12) {
        fields.footTargetTemp = parseTemperature(payload[10], payload[11]);
    }
    // 加热运行时间 & 总运行时间
    if (payload.length >= 14) {
        fields.heatingRunTime = readUint16LE(payload, 12);
    }
    if (payload.length >= 16) {
        fields.totalRunTime = readUint16LE(payload, 14);
    }
    // 硬件运行时间
    if (payload.length >= 18) {
        fields.hardwareRunTime = readUint16LE(payload, 16);
    }
    // 状态
    if (payload.length >= 19) { fields.sysState = payload[18]; }
    if (payload.length >= 20) { fields.bodyRunState = payload[19]; }
    if (payload.length >= 21) { fields.footRunState = payload[20]; }
    // 电流（ADC 原始值 → 电流 A）
    if (payload.length >= 23) {
        const bodyAdc = readUint16LE(payload, 21);
        fields.bodyVoltage = bodyAdc;
        let bodyCur = adcToCurrent(bodyAdc) / 1000;
        if (bodyCur < 0.10) bodyCur = 0;
        fields.bodyCurrent = bodyCur;
    }
    if (payload.length >= 25) {
        const footAdc = readUint16LE(payload, 23);
        fields.footVoltage = footAdc;
        let footCur = adcToCurrent(footAdc) / 1000;
        if (footCur < 0.10) footCur = 0;
        fields.footCurrent = footCur;
    }
    // 升/降温时间计数
    if (payload.length >= 27) { fields.bodyOpenTimerCnt = readUint16LE(payload, 25); }
    if (payload.length >= 29) { fields.bodyCloseTimerCnt = readUint16LE(payload, 27); }
    if (payload.length >= 31) { fields.footOpenTimerCnt = readUint16LE(payload, 29); }
    if (payload.length >= 33) { fields.footCloseTimerCnt = readUint16LE(payload, 31); }
    // 升温剩余时间
    if (payload.length >= 35) { fields.bodyHeatUpTimerCnt = readUint16LE(payload, 33); }
    if (payload.length >= 37) { fields.footHeatUpTimerCnt = readUint16LE(payload, 35); }
    // 阈值温度 (原始值 * 10)
    if (payload.length >= 38) { fields.bodyThresholdTemp = payload[37] / 10; }
    if (payload.length >= 39) { fields.footThresholdTemp = payload[38] / 10; }
    // 故障代码
    if (payload.length >= 40) { fields.faultCode = payload[39]; }
    // 加热输出功率
    if (payload.length >= 42) { fields.bodyHeatingPwS = readUint16LE(payload, 40); }
    if (payload.length >= 44) { fields.footHeatingPwS = readUint16LE(payload, 42); }
    // 最大加热时间
    if (payload.length >= 46) { fields.bodyMaxHeatTimeS = readUint16LE(payload, 44); }
    if (payload.length >= 48) { fields.footMaxHeatTimeS = readUint16LE(payload, 46); }
    // 加热模式
    if (payload.length >= 49) { fields.bodyHeatModel = payload[48]; }
    if (payload.length >= 50) { fields.footHeatModel = payload[49]; }

    return fields;
}

// ============================================================
// Node-RED 函数主入口
// ============================================================

// 使用 context 持久化解析器实例（避免每次消息都重新创建）
let parser = context.get('parser');
if (!parser) {
    parser = new SerialDataParser();
    context.set('parser', parser);
}

// 获取或初始化 devId / devVer（从系统信息消息中更新）
let devId = context.get('devId') || 'unknown';
let devVer = context.get('devVer') || 'unknown';

// ============================================================
// 1. 将输入数据转为 Uint8Array
// ============================================================
let rawData = null;

if (Buffer.isBuffer(msg.payload)) {
    rawData = new Uint8Array(msg.payload);
} else if (msg.payload instanceof Uint8Array) {
    rawData = msg.payload;
} else if (msg.payload instanceof ArrayBuffer) {
    rawData = new Uint8Array(msg.payload);
} else if (typeof msg.payload === 'string') {
    // 尝试 JSON
    try {
        const json = JSON.parse(msg.payload);
        // hub-report-data 可能包含结构化 JSON
        if (json.type === 'PERIODIC_TEMP' && json.op === 'REPORT' &&
            json.detail && json.detail.payloadDec) {
            const payload = json.detail.payloadDec;
            const fields = parseTempPayload(payload);
            msg.payload = [{
                measurement: 'bed_temperature',
                tags: { devId: devId, devVer: devVer },
                fields: fields
            }];
            return msg;
        }
        // 如果是其他 JSON（如设备信息），尝试提取 devId/devVer
        if (json.deviceId) {
            devId = json.deviceId;
            context.set('devId', devId);
        }
        if (json.deviceVer || json.version) {
            devVer = json.deviceVer || json.version;
            context.set('devVer', devVer);
        }
        // 非温度 JSON，不产生 InfluxDB 输出
        return null;
    } catch (e) {
        // 不是 JSON，尝试 HEX 字符串
        const hex = msg.payload.replace(/\s/g, '');
        if (/^[0-9A-Fa-f]+$/.test(hex) && hex.length % 2 === 0) {
            const arr = [];
            for (let i = 0; i < hex.length; i += 2) {
                arr.push(parseInt(hex.substring(i, i + 2), 16));
            }
            rawData = new Uint8Array(arr);
        }
    }
} else if (msg.payload && typeof msg.payload === 'object' && msg.payload.type === 'Buffer') {
    // Node-RED 序列化后的 Buffer
    rawData = new Uint8Array(msg.payload.data || []);
}

if (!rawData || rawData.length === 0) {
    return null; // 无法解析，不输出
}

// ============================================================
// 2. 使用协议解析器拆包
// ============================================================
const packets = parser.parseReceivedData(rawData);
const influxPoints = [];

for (const packet of packets) {
    const parsed = parser.parseMessage(packet);
    if (!parsed) continue;

    const { msgId, msgOp, payload } = parsed;

    // --- 处理设备系统信息：更新 devId / devVer ---
    if (msgId === MSGTYPE.UNITO_MSGTYPE_SYSID && payload.length >= 15) {
        let idHex = '';
        for (let i = 0; i < 12; i++) {
            idHex += ('0' + payload[i].toString(16)).slice(-2).toUpperCase();
        }
        devId = 'HT-' + idHex.substring(0, 8);
        devVer = 'v' + payload[12] + '.' + payload[13];
        context.set('devId', devId);
        context.set('devVer', devVer);
        node.warn('[SYSID] 设备信息已更新: ' + devId + ' ' + devVer);
    }

    // --- PERIODIC_TEMP 上报：温度数据 ---
    if (msgId === MSGTYPE.PERIODIC_TEMP &&
        (msgOp === MSGOP.REPORT || msgOp === MSGOP.RESPONSE)) {

        // RESPONSE 单字节 ACK（0x06）跳过
        if (msgOp === MSGOP.RESPONSE && payload.length === 1) continue;

        const fields = parseTempPayload(payload);
        influxPoints.push({
            measurement: 'bed_temperature',
            tags: { devId: devId, devVer: devVer },
            fields: fields
        });
    }

    // --- WORK RESPONSE：可能携带温度（短包 2 字节） ---
    if (msgId === MSGTYPE.WORK && msgOp === MSGOP.RESPONSE && payload.length === 2) {
        const fields = parseTempPayload(payload);
        influxPoints.push({
            measurement: 'bed_temperature',
            tags: { devId: devId, devVer: devVer },
            fields: fields
        });
    }

    // --- CTRL_WORK RESPONSE：远程控制温度响应 ---
    if (msgId === MSGTYPE.CTRL_WORK && msgOp === MSGOP.RESPONSE && payload.length === 2) {
        const fields = parseTempPayload(payload);
        influxPoints.push({
            measurement: 'bed_temperature',
            tags: { devId: devId, devVer: devVer },
            fields: fields
        });
    }
}

// ============================================================
// 3. 输出结果
// ============================================================
if (influxPoints.length > 0) {
    msg.payload = influxPoints;
    return msg;
}

// 无温度数据时返回 null（不触发下游节点）
return null;
