const MSGTYPE = {
    WORK: 0x0B01,
    ERROR: 0x0B02,
    END: 0x0B04,
    CTRL_WORK: 0x0A01, // web端控制工作状态
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

/**
 * 串口数据解析模块 - 只做协议解析，返回原始数据
 */
class SerialDataParser {
    constructor() {
        this.receivedBuffer = new Uint8Array();
    }

    parseReceivedData(data) {
        if (!data || data.length === 0) return [];

        this.receivedBuffer = this.concatArrays(this.receivedBuffer, data);
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

    concatArrays(arr1, arr2) {
        const result = new Uint8Array(arr1.length + arr2.length);
        result.set(arr1, 0);
        result.set(arr2, arr1.length);
        return result;
    }
}

/**
 * 串口数据组装模块
 */
class SerialDataAssembler {
    assembleMessage(targetAddr, senderAddr, msgId, msgOp, payload = []) {
        const packetLength = 7 + payload.length + 2;
        const packet = new Uint8Array(packetLength);

        packet[0] = 0x00;
        packet[1] = targetAddr;
        packet[2] = senderAddr;
        packet[3] = msgId & 0xFF;
        packet[4] = (msgId >> 8) & 0xFF;
        packet[5] = msgOp;
        packet[6] = payload.length;

        if (payload.length > 0) {
            packet.set(payload, 7);
        }

        // 计算校验和
        let sum = 0;
        for (let i = 0; i < packetLength - 2; i++) {
            sum += packet[i];
        }
        packet[packetLength - 2] = (0x100 - (sum & 0x7F)) & 0xFF;
        packet[packetLength - 1] = 0xFF;

        return packet;
    }
}

// 暴露到全局作用域，供非模块脚本使用
window.MSGTYPE = MSGTYPE;
window.MSGOP = MSGOP;
window.SerialDataParser = SerialDataParser;
window.SerialDataAssembler = SerialDataAssembler;