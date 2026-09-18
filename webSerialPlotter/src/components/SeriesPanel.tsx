import { useDataStore } from '../store/dataStore'
import Input from './ui/Input'
import ColorInput from './ui/ColorInput'

export function SeriesPanel() {
  const store = useDataStore()
  const series = store.getSeries()

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {series.map((s) => (
        <div key={s.id} className="flex items-center gap-2 text-sm">
          <Input
            className="w-28"
            value={s.name}
            onChange={(e) => store.renameSeries(s.id, e.target.value)}
          />
          <ColorInput
            value={s.color}
            onChange={(e) => store.setSeriesColor(s.id, e.target.value)}
            title="Trace color"
          />
        </div>
      ))}
    </div>
  )
}

export default SeriesPanel


