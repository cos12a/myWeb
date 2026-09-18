import { useCallback, useRef, useState } from "react";

export interface BluetoothConfig {
  deviceNamePrefix: string;
  profile: "nus" | "fff0";
}

export interface BluetoothState {
  isSupported: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  device: unknown | null;
  error: string | null;
}

export interface UseBluetooth {
  state: BluetoothState;
  connect: (config: BluetoothConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  onLine: (handler: (line: string) => void) => void;
  write: (data: string) => Promise<void>;
}

const PROFILES = {
  nus: {
    service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    tx: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
    rx: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  },
  fff0: {
    service: "0000fff0-0000-1000-8000-00805f9b34fb",
    tx: "0000fff2-0000-1000-8000-00805f9b34fb",
    rx: "0000fff1-0000-1000-8000-00805f9b34fb",
  },
} as const;

const DEFAULT_CHUNK_SIZE = 20;
const MAX_LINES_PER_FLUSH = 16;

// Web Bluetooth is not present in every TypeScript DOM library version.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BluetoothCharacteristic = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BluetoothDevice = any;

export function matchesBluetoothDeviceNameFilter(
  deviceName: string | undefined,
  filterText: string,
): boolean {
  const normalizedName = (deviceName ?? "").trim();
  const normalizedFilter = filterText.trim();

  if (!normalizedFilter) return true;
  return normalizedName
    .toLowerCase()
    .startsWith(normalizedFilter.toLowerCase());
}

export function consumeCompletedLines(buffer: string): {
  lines: string[];
  remainder: string;
} {
  const lines: string[] = [];
  let remainder = buffer;

  while (true) {
    const newlineIndex = remainder.indexOf("\n");
    if (newlineIndex < 0) break;

    const rawLine = remainder.slice(0, newlineIndex);
    lines.push(rawLine.replace(/\r$/, ""));
    remainder = remainder.slice(newlineIndex + 1);
  }

  return { lines, remainder };
}

export function useBluetooth(): UseBluetooth {
  const [state, setState] = useState<BluetoothState>({
    isSupported: typeof navigator !== "undefined" && "bluetooth" in navigator,
    isConnecting: false,
    isConnected: false,
    device: null,
    error: null,
  });
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const txRef = useRef<BluetoothCharacteristic | null>(null);
  const rxRef = useRef<BluetoothCharacteristic | null>(null);
  const lineHandlerRef = useRef<((line: string) => void) | null>(null);
  const decoderRef = useRef(new TextDecoder());
  const bufferRef = useRef("");
  const pendingLinesRef = useRef<string[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionAttemptRef = useRef(0);
  const connectedRef = useRef(false);

  const onLine = useCallback((handler: (line: string) => void) => {
    lineHandlerRef.current = handler;
  }, []);

  const flushPendingLines = useCallback(() => {
    drainTimerRef.current = null;
    const handler = lineHandlerRef.current;
    if (!handler) {
      pendingLinesRef.current = [];
      return;
    }

    let processed = 0;
    while (
      pendingLinesRef.current.length > 0 &&
      processed < MAX_LINES_PER_FLUSH
    ) {
      const line = pendingLinesRef.current.shift();
      if (line === undefined) break;
      handler(line);
      processed += 1;
    }

    if (pendingLinesRef.current.length > 0) {
      drainTimerRef.current = globalThis.setTimeout(flushPendingLines, 0);
    }
  }, []);

  const scheduleLineFlush = useCallback(
    (line: string) => {
      pendingLinesRef.current.push(line);
      if (drainTimerRef.current !== null) return;
      drainTimerRef.current = globalThis.setTimeout(flushPendingLines, 0);
    },
    [flushPendingLines],
  );

  const handleNotification = useCallback(
    (event: Event) => {
      if (!connectedRef.current || event.target !== rxRef.current) return;
      const value = (event.target as BluetoothCharacteristic)?.value as
        | DataView
        | undefined;
      if (!value) return;

      const chunk = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      bufferRef.current += decoderRef.current.decode(chunk, { stream: true });

      const { lines, remainder } = consumeCompletedLines(bufferRef.current);
      bufferRef.current = remainder;

      for (const line of lines) {
        scheduleLineFlush(line);
      }
    },
    [scheduleLineFlush],
  );

  const disconnect = useCallback(async () => {
    connectionAttemptRef.current += 1;
    connectedRef.current = false;
    const rx = rxRef.current;
    const device = deviceRef.current;

    try {
      rx?.removeEventListener("characteristicvaluechanged", handleNotification);

      const canStopNotifications =
        !!rx &&
        typeof rx.stopNotifications === "function" &&
        !!device?.gatt &&
        device.gatt.connected;

      if (canStopNotifications) {
        try {
          await rx.stopNotifications();
        } catch (error) {
          const message =
            error instanceof DOMException ? error.name : String(error);
          if (message !== "NetworkError") {
            throw error;
          }
        }
      }

      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
    } finally {
      deviceRef.current = null;
      txRef.current = null;
      rxRef.current = null;
      lineHandlerRef.current = null;
      bufferRef.current = "";
      pendingLinesRef.current = [];
      if (drainTimerRef.current !== null) {
        globalThis.clearTimeout(drainTimerRef.current);
        drainTimerRef.current = null;
      }
      decoderRef.current = new TextDecoder();
      setState((current) => ({
        ...current,
        isConnecting: false,
        isConnected: false,
        device: null,
        error: null,
      }));
    }
  }, [handleNotification]);

  const connect = useCallback(
    async (config: BluetoothConfig) => {
      if (!state.isSupported)
        throw new Error("Web Bluetooth is not supported in this browser.");
      await disconnect();
      const connectionAttempt = ++connectionAttemptRef.current;
      setState((current) => ({ ...current, isConnecting: true, error: null }));
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bluetooth = (navigator as any).bluetooth;
        const profile = PROFILES[config.profile];
        const filterText = config.deviceNamePrefix.trim();
        const options = filterText
          ? {
              filters: [{ namePrefix: filterText }],
              optionalServices: [profile.service],
            }
          : { acceptAllDevices: true, optionalServices: [profile.service] };

        const device = (await bluetooth.requestDevice(
          options,
        )) as BluetoothDevice;

        if (
          filterText &&
          !matchesBluetoothDeviceNameFilter(device.name, filterText)
        ) {
          throw new Error(
            `No Bluetooth device matched the prefix "${filterText}". Please try a different device name prefix.`,
          );
        }

        deviceRef.current = device;
        if (connectionAttempt !== connectionAttemptRef.current)
          throw new DOMException(
            "Bluetooth connection was cancelled",
            "AbortError",
          );
        const server = await device.gatt.connect();
        if (connectionAttempt !== connectionAttemptRef.current)
          throw new DOMException(
            "Bluetooth connection was cancelled",
            "AbortError",
          );
        const service = await server.getPrimaryService(profile.service);
        const tx = await service.getCharacteristic(profile.tx);
        const rx = await service.getCharacteristic(profile.rx);
        await rx.startNotifications();
        if (connectionAttempt !== connectionAttemptRef.current)
          throw new DOMException(
            "Bluetooth connection was cancelled",
            "AbortError",
          );
        rx.addEventListener("characteristicvaluechanged", handleNotification);
        device.addEventListener("gattserverdisconnected", disconnect);
        deviceRef.current = device;
        txRef.current = tx;
        rxRef.current = rx;
        connectedRef.current = true;
        setState((current) => ({
          ...current,
          isConnecting: false,
          isConnected: true,
          device,
          error: null,
        }));
      } catch (error) {
        await disconnect();
        const message =
          error instanceof Error
            ? error.message
            : "Failed to connect to Bluetooth device.";
        setState((current) => ({
          ...current,
          isConnecting: false,
          error: message,
        }));
        throw error;
      }
    },
    [disconnect, handleNotification, state.isSupported],
  );

  const write = useCallback(async (data: string) => {
    const characteristic = txRef.current;
    if (!characteristic) throw new Error("Bluetooth device not connected");
    const bytes = new TextEncoder().encode(data);
    const chunkSize =
      Number(characteristic.maxWriteValueLength) > 0
        ? Number(characteristic.maxWriteValueLength)
        : DEFAULT_CHUNK_SIZE;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.slice(offset, offset + chunkSize);
      if (
        characteristic.properties?.writeWithoutResponse &&
        characteristic.writeValueWithoutResponse
      ) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else {
        await characteristic.writeValueWithResponse(chunk);
      }
    }
  }, []);

  return { state, connect, disconnect, onLine, write };
}
