import { useCallback, useState, useEffect, useRef } from "react";
import { useSerial } from "./useSerial";
import { useSignalGenerator, type GeneratorConfig } from "./useSignalGenerator";
import { useBluetooth, type BluetoothConfig } from "./useBluetooth";

export interface SerialConfig {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  flowControl: "none" | "hardware";
}

export type ConnectionType = "serial" | "bluetooth" | "generator";

export interface ConnectionState {
  type: ConnectionType | null;
  isConnecting: boolean;
  isConnected: boolean;
  isSupported: boolean;
  error: string | null;
}

export interface UseDataConnection {
  state: ConnectionState;
  connectSerial: (config: SerialConfig) => Promise<void>;
  connectBluetooth: (config: BluetoothConfig) => Promise<void>;
  connectGenerator: (config: GeneratorConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  write: (data: string) => Promise<void>;
  generatorConfig: GeneratorConfig;
  setGeneratorConfig: (config: Partial<GeneratorConfig>) => void;
  serialSupported: boolean;
  bluetoothSupported: boolean;
}

const DEFAULT_SERIAL_CONFIG: SerialConfig = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

export function useDataConnection(
  onLine: (line: string) => void,
): UseDataConnection {
  const [connectionType, setConnectionType] = useState<ConnectionType | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeConnectionRef = useRef<ConnectionType | null>(null);

  const serial = useSerial();
  const bluetooth = useBluetooth();
  const generator = useSignalGenerator(onLine);

  const state: ConnectionState = {
    type: connectionType,
    isConnecting:
      isConnecting || serial.state.isConnecting || bluetooth.state.isConnecting,
    isConnected:
      serial.state.isConnected ||
      bluetooth.state.isConnected ||
      generator.isRunning,
    isSupported: serial.state.isSupported || bluetooth.state.isSupported,
    error: error || serial.state.error || bluetooth.state.error,
  };

  const connectSerial = useCallback(
    async (config: SerialConfig) => {
      activeConnectionRef.current = null;
      if (generator.isRunning) {
        generator.stop();
      }
      await bluetooth.disconnect();

      setIsConnecting(true);
      setError(null);

      try {
        // Convert our config to the format useSerial expects
        // Note: Web Serial API has limited configuration options
        await serial.connect(config.baudRate);
        activeConnectionRef.current = "serial";
        setConnectionType("serial");
        // The actual port configuration would need to be done at the port.open() level
        // For now, we'll just use baudRate as useSerial currently does
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to connect to serial port";
        setError(message);
        setConnectionType(null);
        throw err; // Re-throw so ConnectModal knows the connection failed
      } finally {
        setIsConnecting(false);
      }
    },
    [serial, bluetooth, generator],
  );

  const connectBluetooth = useCallback(
    async (config: BluetoothConfig) => {
      activeConnectionRef.current = null;
      if (generator.isRunning) generator.stop();
      await serial.disconnect();
      setIsConnecting(true);
      setError(null);
      try {
        await bluetooth.connect(config);
        activeConnectionRef.current = "bluetooth";
        setConnectionType("bluetooth");
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to connect to Bluetooth device";
        setError(message);
        setConnectionType(null);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [serial, bluetooth, generator],
  );

  const connectGenerator = useCallback(
    async (config: GeneratorConfig) => {
      activeConnectionRef.current = null;
      await serial.disconnect();
      await bluetooth.disconnect();

      setError(null);
      setConnectionType("generator");

      try {
        generator.setConfig(config);
        activeConnectionRef.current = "generator";
        generator.start();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to start signal generator";
        setError(message);
        setConnectionType(null);
      }
    },
    [serial, bluetooth, generator],
  );

  const disconnect = useCallback(async () => {
    activeConnectionRef.current = null;
    setError(null);

    await serial.disconnect();
    await bluetooth.disconnect();

    if (generator.isRunning) {
      generator.stop();
    }

    setConnectionType(null);
  }, [serial, bluetooth, generator]);

  const handleSerialLine = useCallback(
    (line: string) => {
      if (activeConnectionRef.current === "serial") onLine(line);
    },
    [onLine],
  );

  const handleBluetoothLine = useCallback(
    (line: string) => {
      if (activeConnectionRef.current === "bluetooth") onLine(line);
    },
    [onLine],
  );

  // Register transport-specific gates so stale notifications cannot cross a connection switch.
  useEffect(() => {
    serial.onLine(handleSerialLine);
    bluetooth.onLine(handleBluetoothLine);
  }, [serial, bluetooth, handleSerialLine, handleBluetoothLine]);

  const write = useCallback(
    async (data: string) => {
      if (connectionType === "serial" && serial.state.isConnected) {
        await serial.write(data);
        return;
      }
      if (connectionType === "bluetooth" && bluetooth.state.isConnected) {
        await bluetooth.write(data);
        return;
      }
      throw new Error("No data device connected");
    },
    [connectionType, serial, bluetooth],
  );

  return {
    state,
    connectSerial,
    connectBluetooth,
    connectGenerator,
    disconnect,
    write,
    generatorConfig: generator.config,
    setGeneratorConfig: generator.setConfig,
    serialSupported: serial.state.isSupported,
    bluetoothSupported: bluetooth.state.isSupported,
  };
}

export { DEFAULT_SERIAL_CONFIG };
