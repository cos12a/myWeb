import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface ConsoleInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function ConsoleInput({ onSend, disabled = false }: ConsoleInputProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    if (!input.trim() || disabled) return

    onSend(input)
    
    // Add to history if it's different from the last command
    if (history[history.length - 1] !== input) {
      setHistory(prev => [...prev.slice(-19), input]) // Keep last 20 commands
    }
    
    setInput('')
    setHistoryIndex(-1)
  }, [input, disabled, onSend, history])

  const sendControlChar = useCallback((char: 'C' | 'D') => {
    if (disabled) return
    
    // Send control character (Ctrl-C = 0x03, Ctrl-D = 0x04)
    const code = char === 'C' ? 3 : 4
    const controlChar = String.fromCharCode(code)
    onSend(controlChar)
  }, [disabled, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    // Handle Ctrl-C and Ctrl-D
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        sendControlChar('C')
        return
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        sendControlChar('D')
        return
      }
    }
    
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex = historyIndex === -1 
          ? history.length - 1 
          : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInput(history[newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex >= 0) {
        if (historyIndex === history.length - 1) {
          setHistoryIndex(-1)
          setInput('')
        } else {
          const newIndex = historyIndex + 1
          setHistoryIndex(newIndex)
          setInput(history[newIndex])
        }
      }
    }
  }, [handleSend, history, historyIndex, sendControlChar])

  return (
    <div className="flex gap-2 p-3 border-t border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? t('consoleInput.notConnected') : t('consoleInput.placeholder')}
        disabled={disabled}
        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        onClick={() => sendControlChar('C')}
        disabled={disabled}
        title={t('consoleInput.sendCtrlC')}
        className="px-3 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-orange-600 dark:disabled:hover:bg-orange-500"
      >
        ^C
      </button>
      <button
        onClick={() => sendControlChar('D')}
        disabled={disabled}
        title={t('consoleInput.sendCtrlD')}
        className="px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-purple-600 dark:disabled:hover:bg-purple-500"
      >
        ^D
      </button>
      <button
        onClick={handleSend}
        disabled={!input.trim() || disabled}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 dark:disabled:hover:bg-blue-500"
      >
        {t('consoleInput.send')}
      </button>
    </div>
  )
}