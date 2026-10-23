// Web 版串口常量与校验：Web Serial 由浏览器直接 open({baudRate,...})，
// 因此不需要桌面版的 DCB / COMMTIMEOUTS / 端口路径规范化，只保留波特率表与校验。

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
export const DEFAULT_BAUD = 115200;

export function validateBaud(baud) {
  if (!Number.isInteger(baud) || !BAUD_RATES.includes(baud)) {
    throw new RangeError(`不支持的波特率，可选：${BAUD_RATES.join(", ")}。`);
  }
  return baud;
}
