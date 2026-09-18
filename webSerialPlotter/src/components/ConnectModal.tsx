import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CpuChipIcon, XMarkIcon, WifiIcon, SignalIcon } from '@heroicons/react/24/outline'
import Button from './ui/Button'
import Input from './ui/Input'
import Select from './ui/Select'
import Checkbox from './ui/Checkbox'
import type { SerialConfig, ConnectionType } from '../hooks/useDataConnection'
import type { BluetoothConfig } from '../hooks/useBluetooth'
import type { GeneratorConfig } from '../hooks/useSignalGenerator'
import { DEFAULT_SERIAL_CONFIG } from '../hooks/useDataConnection'

interface Props {
  isOpen: boolean
  onClose: () => void
  onConnectSerial: (config: SerialConfig) => Promise<void>
  onConnectBluetooth?: (config: BluetoothConfig) => Promise<void>
  onConnectGenerator: (config: GeneratorConfig) => Promise<void>
  isConnecting: boolean
  isSupported: boolean
  bluetoothSupported?: boolean
  generatorConfig: GeneratorConfig
}

const BAUD_RATES = [300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

export function ConnectModal({
  isOpen,
  onClose,
  onConnectSerial,
  onConnectGenerator,
  isConnecting,
  isSupported,
  generatorConfig,
  onConnectBluetooth = async () => {},
  bluetoothSupported = false
}: Props) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ConnectionType>('serial')
  const [serialConfig, setSerialConfig] = useState<SerialConfig>(DEFAULT_SERIAL_CONFIG)
  const [bluetoothConfig, setBluetoothConfig] = useState<BluetoothConfig>({ deviceNamePrefix: '', profile: 'nus' })
  const [localGeneratorConfig, setLocalGeneratorConfig] = useState<GeneratorConfig>(generatorConfig)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) setConnectionError(null)
  }, [isOpen])

  if (!isOpen) return null

  const handleSerialConnect = async () => {
    setConnectionError(null)
    try {
      await onConnectSerial(serialConfig)
      onClose()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error))
      // Keep modal open on error so user can try again
    }
  }

  const handleGeneratorConnect = async () => {
    setConnectionError(null)
    try {
      await onConnectGenerator(localGeneratorConfig)
      onClose()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error))
      // Keep modal open on error so user can try again
    }
  }

  const handleBluetoothConnect = async () => {
    setConnectionError(null)
    try {
      await onConnectBluetooth(bluetoothConfig)
      onClose()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error))
      // Keep modal open on error so user can try again
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-neutral-700">
          <h2 className="text-xl font-semibold">{t('connectModal.title')}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-neutral-700">
          <button
            onClick={() => {
              setConnectionError(null)
              setActiveTab('serial')
            }}
            className={`flex items-center gap-2 px-6 py-3 font-medium transition-colors ${
              activeTab === 'serial'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <CpuChipIcon className="w-4 h-4" />
            {t('connectModal.serialPort')}
          </button>
          <button
            onClick={() => {
              setConnectionError(null)
              setActiveTab('bluetooth')
            }}
            className={`flex items-center gap-2 px-6 py-3 font-medium transition-colors ${
              activeTab === 'bluetooth'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <WifiIcon className="w-4 h-4" />
            {t('connectModal.bluetooth')}
          </button>
          <button
            onClick={() => {
              setConnectionError(null)
              setActiveTab('generator')
            }}
            className={`flex items-center gap-2 px-6 py-3 font-medium transition-colors ${
              activeTab === 'generator'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <SignalIcon className="w-4 h-4" />
            {t('connectModal.signalGenerator')}
          </button>
        </div>

        {/* Content */}
        <div className="p-6" onClick={() => setConnectionError(null)}>
          {connectionError && (
            <div className="mb-2 p-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded w-fit max-w-full">
              <p className="text-red-800 dark:text-red-200 text-xs">{connectionError}</p>
            </div>
          )}
          {activeTab === 'bluetooth' && (
            <div className="space-y-4">
              {!bluetoothSupported && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-800 dark:text-red-200 text-xs">{t('connectModal.bluetoothNotSupported')}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-2">{t('connectModal.deviceNamePrefix')}</label>
                <Input
                  value={bluetoothConfig.deviceNamePrefix}
                  onChange={(e) => setBluetoothConfig(prev => ({ ...prev, deviceNamePrefix: e.target.value }))}
                  placeholder={t('connectModal.deviceNamePrefixPlaceholder')}
                />
                <p className="text-xs text-gray-500 mt-2">Prefix match only; example: WS matches WS8623</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t('connectModal.bluetoothService')}</label>
                <Select
                  value={bluetoothConfig.profile}
                  onChange={(e) => setBluetoothConfig(prev => ({ ...prev, profile: e.target.value as BluetoothConfig['profile'] }))}
                >
                  <option value="nus">Nordic UART Service (NUS)</option>
                  <option value="fff0">{t('connectModal.fff0Service')}</option>
                </Select>
                <p className="text-xs text-gray-500 mt-2">{t('connectModal.bluetoothServiceHint')}</p>
              </div>
              <div className="pt-4 border-t border-gray-200 dark:border-neutral-700">
                <Button
                  variant="primary"
                  onClick={handleBluetoothConnect}
                  disabled={!bluetoothSupported || isConnecting}
                  className="w-full"
                >
                  {isConnecting ? t('header.connecting') : t('connectModal.connectBluetooth')}
                </Button>
              </div>
            </div>
          )}
          {activeTab === 'serial' && (
            <div className="space-y-4">
              {!isSupported && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-800 dark:text-red-200 text-xs">
                    {t('connectModal.browserNotSupported')}
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.baudRate')}</label>
                  <Select
                    value={serialConfig.baudRate.toString()}
                    onChange={(e) => setSerialConfig(prev => ({ ...prev, baudRate: parseInt(e.target.value) }))}
                  >
                    {BAUD_RATES.map(rate => (
                      <option key={rate} value={rate.toString()}>{rate}</option>
                    ))}
                  </Select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.dataBits')}</label>
                  <Select
                    value={serialConfig.dataBits.toString()}
                    onChange={(e) => setSerialConfig(prev => ({ ...prev, dataBits: parseInt(e.target.value) as 5 | 6 | 7 | 8 }))}
                  >
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                  </Select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.stopBits')}</label>
                  <Select
                    value={serialConfig.stopBits.toString()}
                    onChange={(e) => setSerialConfig(prev => ({ ...prev, stopBits: parseInt(e.target.value) as 1 | 2 }))}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </Select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.parity')}</label>
                  <Select
                    value={serialConfig.parity}
                    onChange={(e) => setSerialConfig(prev => ({ ...prev, parity: e.target.value as 'none' | 'even' | 'odd' }))}
                  >
                    <option value="none">{t('connectModal.none')}</option>
                    <option value="even">{t('connectModal.even')}</option>
                    <option value="odd">{t('connectModal.odd')}</option>
                  </Select>
                </div>
                
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-2">{t('connectModal.flowControl')}</label>
                  <Select
                    value={serialConfig.flowControl}
                    onChange={(e) => setSerialConfig(prev => ({ ...prev, flowControl: e.target.value as 'none' | 'hardware' }))}
                  >
                    <option value="none">{t('connectModal.none')}</option>
                    <option value="hardware">{t('connectModal.hardware')}</option>
                  </Select>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-neutral-700">
                <Button
                  variant="primary"
                  onClick={handleSerialConnect}
                  disabled={!isSupported || isConnecting}
                  className="w-full"
                >
                  {isConnecting ? t('header.connecting') : t('connectModal.connectSerial')}
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'generator' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.signalType')}</label>
                  <Select
                    value={localGeneratorConfig.mode}
                    onChange={(e) => setLocalGeneratorConfig(prev => ({ 
                      ...prev, 
                      mode: e.target.value as 'sine3' | 'noise' | 'ramp' 
                    }))}
                  >
                    <option value="sine3">{t('connectModal.sineWave')}</option>
                    <option value="noise">{t('connectModal.randomNoise')}</option>
                    <option value="ramp">{t('connectModal.rampSawtooth')}</option>
                  </Select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.channels')}</label>
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    value={localGeneratorConfig.channels}
                    onChange={(e) => setLocalGeneratorConfig(prev => ({ 
                      ...prev, 
                      channels: Math.max(1, Math.min(8, parseInt(e.target.value) || 1))
                    }))}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.sampleRate')}</label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={localGeneratorConfig.sampleRateHz}
                    onChange={(e) => setLocalGeneratorConfig(prev => ({ 
                      ...prev, 
                      sampleRateHz: Math.max(1, parseInt(e.target.value) || 100)
                    }))}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.frequency')}</label>
                  <Input
                    type="number"
                    min={0.1}
                    max={100}
                    step={0.1}
                    value={localGeneratorConfig.frequencyHz}
                    onChange={(e) => setLocalGeneratorConfig(prev => ({ 
                      ...prev, 
                      frequencyHz: Math.max(0.1, parseFloat(e.target.value) || 1)
                    }))}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">{t('connectModal.amplitude')}</label>
                  <Input
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={localGeneratorConfig.amplitude}
                    onChange={(e) => setLocalGeneratorConfig(prev => ({ 
                      ...prev, 
                      amplitude: Math.max(0.1, parseFloat(e.target.value) || 1)
                    }))}
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={localGeneratorConfig.includeHeader}
                    onChange={(e) => setLocalGeneratorConfig(prev => ({ 
                      ...prev, 
                      includeHeader: e.target.checked 
                    }))}
                  />
                  <span className="text-sm font-medium">{t('connectModal.includeHeaders')}</span>
                </label>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-neutral-700">
                <Button
                  variant="primary"
                  onClick={handleGeneratorConnect}
                  disabled={isConnecting}
                  className="w-full"
                >
                  {t('connectModal.startGenerator')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ConnectModal