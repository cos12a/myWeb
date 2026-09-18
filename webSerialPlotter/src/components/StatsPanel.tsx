import type { PlotSnapshot } from '../types/plot'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './ui/Button'
import Checkbox from './ui/Checkbox'
import { CameraIcon } from '@heroicons/react/24/outline'
import * as htmlToImage from 'html-to-image'
import { useDataStore } from '../store/dataStore'

interface Props {
  snapshot: PlotSnapshot
}

type SeriesStats = {
  min: number
  max: number
  mean: number
  median: number
  stddev: number
  bins: number[]
  count: number
  mode: number
}

function computeStats(values: Float32Array, numBins = 24): SeriesStats {
  const total = values.length
  // filter out non-finite values (NaN, +/-Infinity)
  const filtered: number[] = []
  for (let i = 0; i < total; i++) {
    const v = values[i]
    if (Number.isFinite(v)) filtered.push(v)
  }
  const n = filtered.length
  if (n === 0) return { min: NaN, max: NaN, mean: NaN, median: NaN, stddev: NaN, bins: new Array(numBins).fill(0), count: 0, mode: NaN }
  let min = Infinity, max = -Infinity, sum = 0
  for (let i = 0; i < n; i++) {
    const v = filtered[i]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  const mean = sum / n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = filtered[i] - mean
    variance += d * d
  }
  variance /= n
  const stddev = Math.sqrt(variance)

  // median (copy + select)
  const copy = filtered.slice()
  copy.sort((a, b) => a - b)
  const median = n % 2 === 1 ? copy[(n - 1) / 2] : (copy[n / 2 - 1] + copy[n / 2]) / 2

  // histogram
  const bins = new Array(numBins).fill(0)
  const range = Math.max(1e-9, max - min)
  for (let i = 0; i < n; i++) {
    const idx = Math.min(numBins - 1, Math.max(0, Math.floor(((filtered[i] - min) / range) * numBins)))
    bins[idx]++
  }
  // estimate mode as the midpoint of the most populated bin
  let peakIndex = 0
  let peakCount = -1
  for (let i = 0; i < numBins; i++) {
    if (bins[i] > peakCount) {
      peakCount = bins[i]
      peakIndex = i
    }
  }
  const binWidth = range / numBins
  const mode = min + (peakIndex + 0.5) * binWidth

  return { min, max, mean, median, stddev, bins, count: n, mode }
}

function StatsCard({ name, color, data, id, visible }: { name: string, color: string, data: Float32Array, id: number, visible: boolean }) {
  const { t } = useTranslation()
  const histRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<{ visible: boolean, x: number, y: number, text: string }>({ visible: false, x: 0, y: 0, text: '' })
  const store = useDataStore()
  // Only compute stats if the series is visible
  const st = visible ? computeStats(data) : { min: NaN, max: NaN, mean: NaN, median: NaN, stddev: NaN, bins: new Array(24).fill(0), count: 0, mode: NaN }
  const maxBin = Math.max(1, ...st.bins)
  const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—')
  return (
    <div className="rounded-md p-2 transition-opacity" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', opacity: visible ? 1 : 0.4 }} id={`stat-card-${id}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Checkbox 
            checked={visible} 
            onChange={() => store.toggleSeriesVisibility(id)}
            title={t('stats.showHideTrace')}
            aria-label={t('stats.toggleVisibility')}
          />
          <div className="text-sm font-medium" style={{ color }}>{name}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] opacity-60">n={st.count}</div>
          <Button size="sm" aria-label={t('stats.savePng')} title={t('stats.savePng')} onClick={async () => {
            const node = document.getElementById(`stat-card-${id}`)
            if (!node) return
            const dataUrl = await htmlToImage.toPng(node as HTMLElement, { pixelRatio: 2, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fff' })
            const a = document.createElement('a')
            a.href = dataUrl
            a.download = `stats-${name}-${Date.now()}.png`
            document.body.appendChild(a)
            a.click()
            a.remove()
          }}>
            <CameraIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1">
        <div>{t('stats.min')}: {fmt(st.min)}</div>
        <div>{t('stats.max')}: {fmt(st.max)}</div>
        <div>{t('stats.mean')}: {fmt(st.mean)}</div>
        <div>{t('stats.median')}: {fmt(st.median)}</div>
        <div>{t('stats.stddev')}: {fmt(st.stddev)}</div>
        <div>{t('stats.mode')}: {fmt(st.mode)}</div>
      </div>
      <div className="mt-2 h-10 flex items-end gap-[2px] relative" ref={histRef}>
        {(() => {
          const numBins = st.bins.length
          const safeRange = (Number.isFinite(st.min) && Number.isFinite(st.max)) ? Math.max(1e-9, st.max - st.min) : NaN
          const binWidth = Number.isFinite(safeRange) ? safeRange / numBins : NaN
          return st.bins.map((b, i) => {
            const start = Number.isFinite(binWidth) ? st.min + i * binWidth : NaN
            const end = Number.isFinite(binWidth) ? st.min + (i + 1) * binWidth : NaN
            const pct = st.count ? (b / st.count) * 100 : 0
            const title = (st.count === 0 || !Number.isFinite(start) || !Number.isFinite(end))
              ? `count: ${b}`
              : `range: ${start.toFixed(3)} – ${end.toFixed(3)} | count: ${b} (${pct.toFixed(1)}%)`
            const barHeightPct = (b / maxBin) * 100
            return (
              <div
                key={i}
                className="group flex-1 h-full relative cursor-pointer"
                onMouseEnter={() => {
                  const rect = histRef.current?.getBoundingClientRect()
                  const x = rect ? ((i + 0.5) / numBins) * rect.width : 0
                  setTooltip({ visible: true, x, y: -28, text: title })
                }}
                onMouseLeave={() => setTooltip((t) => ({ ...t, visible: false }))}
              >
                <div className="pointer-events-none absolute inset-0 rounded-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <div className="absolute left-0 right-0 bottom-0" style={{ height: `${barHeightPct}%`, background: 'var(--hist-bar)' }} />
              </div>
            )
          })
        })()}
        {tooltip.visible && (
          <div
            className="pointer-events-none absolute z-10 text-[10px] px-2 py-1 rounded border shadow"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              transform: 'translate(-50%, -6px)',
              background: 'var(--card-bg)',
              borderColor: 'var(--card-border)'
            }}
            role="tooltip"
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  )
}

export function StatsPanel({ snapshot }: Props) {
  return (
    <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {snapshot.series.map((s) => (
        <StatsCard key={s.id} id={s.id} name={s.name} color={s.color} visible={s.visible} data={snapshot.getSeriesData(s.id)} />
      ))}
    </div>
  )
}

export default StatsPanel


