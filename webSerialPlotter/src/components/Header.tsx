import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './ui/Button'
import Modal from './ui/Modal'
import { PlayIcon, StopIcon } from '@heroicons/react/24/outline'
import ConnectModal from './ConnectModal'
import type { ConnectionState, ConnectionType, SerialConfig } from '../hooks/useDataConnection'
import type { BluetoothConfig } from '../hooks/useBluetooth'
import type { GeneratorConfig } from '../hooks/useSignalGenerator'

interface Props {
  connectionState: ConnectionState
  onConnectSerial: (config: SerialConfig) => Promise<void>
  onConnectBluetooth: (config: BluetoothConfig) => Promise<void>
  onConnectGenerator: (config: GeneratorConfig) => Promise<void>
  onDisconnect: () => Promise<void>
  generatorConfig: GeneratorConfig
  serialSupported: boolean
  bluetoothSupported: boolean
}

function getConnectionIcon(type: ConnectionType | null, isConnected: boolean) {
  if (!isConnected) return <PlayIcon className="w-4 h-4" />
  if (type === 'serial') return <StopIcon className="w-4 h-4" />
  if (type === 'bluetooth') return <StopIcon className="w-4 h-4" />
  if (type === 'generator') return <StopIcon className="w-4 h-4" />
  return <StopIcon className="w-4 h-4" />
}

function getConnectionText(state: ConnectionState, t: (key: string) => string) {
  if (state.isConnecting) return t('header.connecting')
  if (state.isConnected) {
    if (state.type === 'serial') return t('header.serialConnected')
    if (state.type === 'bluetooth') return t('header.bluetoothConnected')
    if (state.type === 'generator') return t('header.generatorRunning')
    return t('header.connected')
  }
  if (!state.isSupported) return t('header.serialUnsupported')
  return t('header.connect')
}

function getButtonVariant(state: ConnectionState) {
  if (state.isConnected) return 'danger'
  return 'primary'
}

export function Header({ 
  connectionState, 
  onConnectSerial, 
  onConnectGenerator,
  onConnectBluetooth,
  onDisconnect, 
  generatorConfig,
  serialSupported,
  bluetoothSupported
}: Props) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  

  const handleButtonClick = () => {
    if (connectionState.isConnected) {
      setShowDisconnectConfirm(true)
    } else {
      setShowModal(true)
    }
  }

  const handleDisconnect = async () => {
    setShowDisconnectConfirm(false)
    await onDisconnect()
  }

  const disconnectTarget = connectionState.type === 'bluetooth'
    ? t('header.bluetoothDevice')
    : connectionState.type === 'serial'
      ? t('header.serialDevice')
      : t('header.dataSource')

  return (
    <>
      <header className="flex items-center justify-between gap-4 py-3 px-4 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="text-lg font-semibold tracking-tight">{t('app.title')}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block text-xs text-neutral-500 dark:text-neutral-400">
            {t('header.workInProgress')} <a className="underline hover:no-underline text-blue-600 dark:text-blue-400" href="https://gitee.com/eegithub/web-serial-plotter-cn/issues" target="_blank" rel="noopener noreferrer">{t('header.openIssue')}</a>.
          </div>
          <Button 
            id="tour-connect-button"
            variant={getButtonVariant(connectionState)}
            disabled={connectionState.isConnecting}
            onClick={handleButtonClick}
            startIcon={getConnectionIcon(connectionState.type, connectionState.isConnected)}
          >
            {getConnectionText(connectionState, t)}
          </Button>
        </div>
      </header>

      <ConnectModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConnectSerial={onConnectSerial}
        onConnectBluetooth={onConnectBluetooth}
        onConnectGenerator={onConnectGenerator}
        isConnecting={connectionState.isConnecting}
        isSupported={serialSupported}
        generatorConfig={generatorConfig}
        bluetoothSupported={bluetoothSupported}
      />

      <Modal
        open={showDisconnectConfirm}
        onClose={() => setShowDisconnectConfirm(false)}
        title={t('header.disconnectTitle')}
      >
        <p className="text-sm text-gray-600 dark:text-neutral-300">
          {t('header.disconnectMessage', { target: disconnectTarget })}
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="neutral" onClick={() => setShowDisconnectConfirm(false)}>
            {t('header.cancelDisconnect')}
          </Button>
          <Button variant="danger" onClick={handleDisconnect}>
            {t('header.confirmDisconnect')}
          </Button>
        </div>
      </Modal>
    </>
  )
}

export default Header


