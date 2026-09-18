interface Props {
  autoscale: boolean
  yMin: number
  yMax: number
  onChange: (next: { autoscale?: boolean; yMin?: number; yMax?: number }) => void
}

export function ScaleControls({ autoscale, yMin, yMax, onChange }: Props) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={autoscale}
          onChange={(e) => onChange({ autoscale: e.target.checked })}
        />
        <span className="opacity-80">Autoscale Y</span>
      </label>
      <div className="flex items-center gap-2">
        <span className="opacity-70">Y min</span>
        <input
          className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm disabled:opacity-50"
          type="number"
          value={yMin}
          onChange={(e) => onChange({ yMin: Number(e.target.value) })}
          disabled={autoscale}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="opacity-70">Y max</span>
        <input
          className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm disabled:opacity-50"
          type="number"
          value={yMax}
          onChange={(e) => onChange({ yMax: Number(e.target.value) })}
          disabled={autoscale}
        />
      </div>
    </div>
  )
}

export default ScaleControls


