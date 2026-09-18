import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConsoleStore } from '../hooks/useConsoleStore'
import ConsoleLog from './ConsoleLog'
import ConsoleInput from './ConsoleInput'
import { exportMessages, type ExportFormat } from '../utils/consoleExport'
import type { ConnectionType } from '../hooks/useDataConnection'

interface SerialConsoleProps {
  isConnected: boolean
  connectionType: ConnectionType | null
  onSendMessage: (message: string) => Promise<void>
}

export default function SerialConsole({ isConnected, connectionType, onSendMessage }: SerialConsoleProps) {
  const { t } = useTranslation()
  const { messages, addOutgoing, clear, getCapacity, setCapacity } = useConsoleStore()
  const [showSettings, setShowSettings] = useState(false)
  const [capacityInput, setCapacityInput] = useState(getCapacity().toString())
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt')

  const handleSendMessage = useCallback(async (message: string) => {
    try {
      // Check if message is a control character (ASCII 0-31)
      const isControlChar = message.length === 1 && message.charCodeAt(0) < 32
      
      // Add newline to message if not present (unless it's a control character)
      const messageToSend = isControlChar ? message : (message.endsWith('\n') ? message : message + '\n')
      
      // Log outgoing message with readable name for control chars
      if (isControlChar) {
        const code = message.charCodeAt(0)
        const ctrlName = code === 3 ? '^C (ETX)' : code === 4 ? '^D (EOT)' : `^${String.fromCharCode(64 + code)}`
        addOutgoing(ctrlName)
      } else {
        addOutgoing(message)
      }
      
      // Send via serial
      await onSendMessage(messageToSend)
    } catch (error) {
      // Log error
      addOutgoing(`Error: ${error instanceof Error ? error.message : 'Failed to send'}`, 'error')
    }
  }, [onSendMessage, addOutgoing])

  const handleCapacityChange = useCallback(() => {
    const newCapacity = parseInt(capacityInput, 10)
    if (Number.isInteger(newCapacity) && newCapacity >= 10 && newCapacity <= 10000) {
      setCapacity(newCapacity)
      setShowSettings(false)
    }
  }, [capacityInput, setCapacity])

  const handleCapacityKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCapacityChange()
    } else if (e.key === 'Escape') {
      setCapacityInput(getCapacity().toString())
      setShowSettings(false)
    }
  }, [handleCapacityChange, getCapacity])

  const handleDownload = useCallback(() => {
    if (messages.length === 0) return
    exportMessages(messages, exportFormat)
  }, [messages, exportFormat])

  return (
    <div className="flex flex-col h-full">
      {/* Header with connection status and controls */}
      <div className="border-b border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {isConnected
                ? connectionType === 'bluetooth'
                  ? t('serialConsole.bluetoothConnected')
                  : connectionType === 'serial'
                    ? t('serialConsole.serialConnected')
                    : t('serialConsole.connected')
                : t('serialConsole.disconnected')}
            </span>
            <span className="text-xs text-gray-500 dark:text-neutral-400">
              ({messages.length}/{getCapacity()} {t('serialConsole.messages')})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={messages.length === 0}
              className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200 border border-gray-300 dark:border-neutral-700 rounded hover:border-gray-400 dark:hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={`${t('serialConsole.download')} (${exportFormat.toUpperCase()})`}
            >
              ⬇️ {t('serialConsole.download')}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200 border border-gray-300 dark:border-neutral-700 rounded hover:border-gray-400 dark:hover:border-neutral-600 transition-colors"
              title={t('serialConsole.settings')}
            >
              ⚙️
            </button>
            <button
              onClick={clear}
              disabled={messages.length === 0}
              className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200 border border-gray-300 dark:border-neutral-700 rounded hover:border-gray-400 dark:hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('serialConsole.clear')}
            </button>
          </div>
        </div>
        
        {/* Settings panel */}
        {showSettings && (
          <div className="px-3 pb-3 border-t border-gray-200 dark:border-neutral-800 space-y-3">
            {/* Message history setting */}
            <div className="flex items-center gap-2 pt-2">
              <label className="text-xs font-medium text-gray-700 dark:text-neutral-300">
                {t('serialConsole.maxMessages')}:
              </label>
              <input
                type="number"
                value={capacityInput}
                onChange={(e) => setCapacityInput(e.target.value)}
                onKeyDown={handleCapacityKeyDown}
                min="10"
                max="10000"
                className="w-20 px-2 py-1 text-xs border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100"
              />
              <button
                onClick={handleCapacityChange}
                className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded transition-colors"
              >
                {t('serialConsole.apply')}
              </button>
              <button
                onClick={() => {
                  setCapacityInput(getCapacity().toString())
                  setShowSettings(false)
                }}
                className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200 border border-gray-300 dark:border-neutral-700 rounded hover:border-gray-400 dark:hover:border-neutral-600 transition-colors"
              >
                {t('serialConsole.cancel')}
              </button>
              <span className="text-xs text-gray-500 dark:text-neutral-400">
                {t('serialConsole.rangeHint')}
              </span>
            </div>
            
            {/* Export format setting */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-700 dark:text-neutral-300">
                {t('serialConsole.exportFormat')}:
              </label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="px-2 py-1 text-xs border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100"
              >
                <option value="txt">{t('serialConsole.textTxt')}</option>
                <option value="csv">{t('serialConsole.csvCsv')}</option>
                <option value="json">{t('serialConsole.jsonJson')}</option>
              </select>
              <span className="text-xs text-gray-500 dark:text-neutral-400">
                {t('serialConsole.chooseFormat')}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Console log */}
      <div className="flex-1 min-h-0 flex flex-col p-3">
        <ConsoleLog messages={messages} />
      </div>

      {/* Input area */}
      <ConsoleInput 
        onSend={handleSendMessage}
        disabled={!isConnected}
      />
    </div>
  )
}