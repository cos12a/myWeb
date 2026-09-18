import { useTranslation } from 'react-i18next'
import Button from './ui/Button'
import Checkbox from './ui/Checkbox'
import Input from './ui/Input'
import Select from './ui/Select'

interface Settings {
  autoscale: boolean
  manualMinInput: string
  manualMaxInput: string
  capacity: number
  maxViewPortSize: number
  timeMode: 'absolute' | 'relative'
}

interface Props {
  open: boolean
  settings: Settings
  onChange: {
    setAutoscale: (v: boolean) => void
    setManualMinInput: (v: string) => void
    setManualMaxInput: (v: string) => void
    setCapacity: (v: number) => void
    setMaxViewPortSize: (v: number) => void
    setTimeMode: (v: 'absolute' | 'relative') => void
  }
  onClose: () => void
}

export default function SettingsPanel({ open, settings, onChange, onClose }: Props) {
  const { t } = useTranslation()
  return (
    <aside aria-hidden={!open} className={`shrink-0 border-l ${open ? 'border-gray-200 dark:border-neutral-800' : 'border-transparent'} ${open ? 'w-48' : 'w-0'} overflow-hidden transition-all duration-200 ease-out bg-white dark:bg-neutral-900 text-sm`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-neutral-800">
        <div className="font-medium">{t('settings.title')}</div>
        <Button size="sm" variant="neutral" onClick={onClose}>{t('settings.close')}</Button>
      </div>
      <div className="p-3 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70 mb-2">{t('settings.yAxis')}</div>
          <label className="flex items-center gap-2 mb-3">
            <Checkbox checked={settings.autoscale} onChange={(e) => onChange.setAutoscale(e.target.checked)} />
            <span>{t('settings.autoscaleY')}</span>
          </label>
          {!settings.autoscale && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs opacity-70 mb-1">{t('settings.yMin')}</div>
                <Input type="number" step="any" className="w-full" value={settings.manualMinInput} onChange={(e) => onChange.setManualMinInput(e.target.value)} />
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">{t('settings.yMax')}</div>
                <Input type="number" step="any" className="w-full" value={settings.manualMaxInput} onChange={(e) => onChange.setManualMaxInput(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide opacity-70 mb-2">{t('settings.time')}</div>
          <Select className="w-full" value={settings.timeMode} onChange={(e) => onChange.setTimeMode(e.target.value as 'absolute' | 'relative')}>
            <option value="absolute">{t('settings.absolute')}</option>
            <option value="relative">{t('settings.relative')}</option>
          </Select>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide opacity-70 mb-2">{t('settings.history')}</div>
          <div className="flex items-center gap-2">
            <Input type="number" className="w-28" min={100} step={100} value={settings.capacity} onChange={(e) => onChange.setCapacity(Math.max(100, Math.floor(Number(e.target.value) || 100)))} />
            <span className="opacity-70">{t('settings.pts')}</span>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide opacity-70 mb-2">{t('settings.maxViewport')}</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-28"
              min={10}
              step={50}
              value={settings.maxViewPortSize}
              onChange={(e) => onChange.setMaxViewPortSize(Math.max(10, Math.floor(Number(e.target.value) || 10)))}
            />
            <span className="opacity-70">{t('settings.pts')}</span>
          </div>
        </div>

      </div>
    </aside>
  )
}


