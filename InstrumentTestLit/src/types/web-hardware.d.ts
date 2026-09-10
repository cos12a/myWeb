/** Web Bluetooth / Web Serial 最小类型声明（TS lib.dom 未收录）。 */

interface RequestDeviceOptions {
  acceptAllDevices?: boolean;
  filters?: { namePrefix?: string }[];
  optionalServices?: string[];
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
}

interface BluetoothDevice extends EventTarget {
  gatt: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  value: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
  writeValue(data: Uint8Array): Promise<void>;
}

interface Serial {
  requestPort(): Promise<SerialPort>;
}

interface SerialPort {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface Navigator {
  bluetooth?: Bluetooth;
  serial?: Serial;
}