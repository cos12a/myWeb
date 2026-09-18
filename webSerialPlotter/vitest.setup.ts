import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
// Polyfill ResizeObserver for jsdom
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom env
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock i18next for tests - returns English values by default
vi.mock("react-i18next", () => {
  // English translations
  const en: Record<string, string> = {
    "app.title": "Web Serial Plotter",
    "app.noData": "Connect a device or start test to begin plotting…",
    "app.lastLine": "Last line",
    "app.help": "Help",
    "app.showHelpTour": "Show help tour",
    "tabs.chart": "Chart",
    "tabs.console": "Console",
    "header.connect": "Connect",
    "header.connecting": "Connecting...",
    "header.serialConnected": "Serial Connected",
    "header.generatorRunning": "Generator Running",
    "header.connected": "Connected",
    "header.serialUnsupported": "Serial Unsupported",
    "header.connectionError": "Connection Error",
    "header.workInProgress":
      "This project is a work in progress. Found a bug or have an idea?",
    "header.openIssue": "Open an issue on GitHub",
    "connectModal.title": "Connect Data Source",
    "connectModal.serialPort": "Serial Port",
    "connectModal.signalGenerator": "Signal Generator",
    "connectModal.baudRate": "Baud Rate",
    "connectModal.dataBits": "Data Bits",
    "connectModal.stopBits": "Stop Bits",
    "connectModal.parity": "Parity",
    "connectModal.flowControl": "Flow Control",
    "connectModal.none": "None",
    "connectModal.even": "Even",
    "connectModal.odd": "Odd",
    "connectModal.hardware": "Hardware (RTS/CTS)",
    "connectModal.connectSerial": "Connect Serial Port",
    "connectModal.startGenerator": "Start Signal Generator",
    "connectModal.signalType": "Signal Type",
    "connectModal.sineWave": "Sine Wave (3-phase)",
    "connectModal.randomNoise": "Random Noise",
    "connectModal.rampSawtooth": "Ramp/Sawtooth",
    "connectModal.channels": "Channels",
    "connectModal.sampleRate": "Sample Rate (Hz)",
    "connectModal.frequency": "Frequency (Hz)",
    "connectModal.amplitude": "Amplitude",
    "connectModal.includeHeaders": "Include series headers",
    "connectModal.browserNotSupported":
      "Web Serial API is not supported in this browser.",
    "tools.freeze": "Freeze (pause)",
    "tools.resume": "Resume (play)",
    "tools.zoomIn": "Zoom in",
    "tools.zoomOut": "Zoom out",
    "tools.exportCsv": "Export CSV",
    "tools.savePng": "Save PNG",
    "tools.clearChart": "Clear Chart",
    "tools.settings": "Settings",
    "tools.exportVisibleData": "Export Visible Data",
    "tools.exportAllData": "Export All Data",
    "tools.visibleRelativeTime": "Visible (Relative Time)",
    "tools.allDataRelativeTime": "All Data (Relative Time)",
    "settings.title": "Settings",
    "settings.close": "Close",
    "settings.yAxis": "Y-Axis",
    "settings.autoscaleY": "Autoscale Y",
    "settings.yMin": "Y min",
    "settings.yMax": "Y max",
    "settings.time": "Time",
    "settings.absolute": "Absolute",
    "settings.relative": "Relative",
    "settings.history": "History",
    "settings.pts": "pts",
    "settings.maxViewport": "Max Viewport",
    "stats.min": "min",
    "stats.max": "max",
    "stats.mean": "mean",
    "stats.median": "median",
    "stats.stddev": "stddev",
    "stats.mode": "mode",
    "stats.showHideTrace": "Show/hide trace",
    "stats.toggleVisibility": "Toggle trace visibility",
    "stats.savePng": "Save PNG",
    "serialConsole.connected": "Connected",
    "serialConsole.disconnected": "Disconnected",
    "serialConsole.messages": "messages",
    "serialConsole.download": "Download",
    "serialConsole.settings": "Settings",
    "serialConsole.clear": "Clear",
    "serialConsole.maxMessages": "Max Messages",
    "serialConsole.apply": "Apply",
    "serialConsole.cancel": "Cancel",
    "serialConsole.exportFormat": "Export Format",
    "serialConsole.textTxt": "Text (.txt)",
    "serialConsole.csvCsv": "CSV (.csv)",
    "serialConsole.jsonJson": "JSON (.json)",
    "serialConsole.chooseFormat": "Choose download format",
    "serialConsole.rangeHint": "(10-10000)",
    "consoleInput.notConnected": "Not connected",
    "consoleInput.placeholder":
      "Type command and press Enter (Ctrl-C, Ctrl-D supported)...",
    "consoleInput.send": "Send",
    "consoleInput.sendCtrlC": "Send Ctrl-C (interrupt)",
    "consoleInput.sendCtrlD": "Send Ctrl-D (EOF)",
    "consoleLog.noMessages":
      "No messages yet. Connect a device to see serial data.",
    "consoleLog.scrollToBottom": "Scroll to bottom",
    "legend.title": "Legend",
    "legend.editTrace": "Edit trace",
    "legend.name": "Name",
    "legend.color": "Color",
    "legend.cancel": "Cancel",
    "legend.save": "Save",
    "theme.toggle": "Toggle theme",
    "theme.toggleLightDark": "Toggle light/dark theme",
    "footer.esp32Tool": "ESP32-Tool",
    "footer.blog": "Blog",
    "footer.tutorial": "Tutorial",
    "footer.shop": "Buy Module",
    "language.switch": "Switch Language",
    "language.en": "English",
    "language.zh": "中文",
  };

  return {
    useTranslation: () => ({
      t: (key: string) => en[key] || key,
      i18n: {
        language: "en",
        changeLanguage: () => Promise.resolve(),
      },
    }),
    initReactI18next: {},
  };
});
