import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataStore } from '../store/dataStore'
import Button from './ui/Button'
import Modal from './ui/Modal'
import Input from './ui/Input'
import ColorInput from './ui/ColorInput'

export function Legend() {
  const { t } = useTranslation()
  const store = useDataStore()
  const series = store.getSeries()
  const [editingId, setEditingId] = useState<number | null>(null)
  const editing = series.find((s) => s.id === editingId) || null
  const [nameValue, setNameValue] = useState('')
  const [colorValue, setColorValue] = useState('#60a5fa')
  const [origName, setOrigName] = useState('')
  const [origColor, setOrigColor] = useState('#60a5fa')

  useEffect(() => {
    if (editing) {
      setNameValue(editing.name)
      setColorValue(editing.color)
      setOrigName(editing.name)
      setOrigColor(editing.color)
    }
  }, [editing])

  return (
    <div className="pointer-events-auto bg-white/80 dark:bg-neutral-900/80 backdrop-blur rounded-md border border-gray-300 dark:border-neutral-700 p-2 max-w-xs">
      <div className="text-xs font-semibold mb-1">{t('legend.title')}</div>
      <div className="flex flex-col gap-1">
        {series.filter(s => s.visible).map((s) => (
          <button key={s.id} className="flex items-center gap-2 text-left text-xs hover:opacity-90 cursor-pointer" onClick={() => setEditingId(s.id)}>
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditingId(null)} title={t('legend.editTrace')}>
        {editing && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); store.renameSeries(editing.id, nameValue); setEditingId(null) }}>
            <label className="text-xs">
              {t('legend.name')}
              <Input
                className="w-full mt-1"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
              />
            </label>
            <label className="text-xs">
              {t('legend.color')}
              <div className="mt-1">
                <ColorInput value={colorValue} onChange={(e) => { setColorValue(e.target.value); store.setSeriesColor(editing.id, e.target.value) }} />
              </div>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" onClick={() => { store.renameSeries(editing.id, origName); store.setSeriesColor(editing.id, origColor); setEditingId(null) }}>{t('legend.cancel')}</Button>
              <Button type="submit" size="sm" variant="primary">{t('legend.save')}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

export default Legend


