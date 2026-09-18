import { useCallback, useRef, useState } from 'react'
import { parseDataLine, parseHeaderLine } from '../utils/lineParsing'
import { computeJoinedView, computeYRangeFromSeries } from '../utils/plotDataHelpers'

export interface PlotSeries {
  id: number
  name: string
  color: string
}

export interface PlotSnapshot {
  series: PlotSeries[]
  // For each series, returns a contiguous Float32Array view of the most recent values
  // up to capacity. The array is reused per frame, so treat as read-only.
  getSeriesData: (seriesId: number) => Float32Array
  length: number
  capacity: number
  yMin: number
  yMax: number
}

export interface UsePlotData {
  pushLine: (line: string) => void
  reset: () => void
  snapshot: () => PlotSnapshot
}

const DEFAULT_COLORS = [
  '#60a5fa', // blue-400
  '#f472b6', // pink-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#f87171', // red-400
  '#22d3ee', // cyan-400
  '#84cc16', // lime-500
]

export function usePlotData(capacity = 4000): UsePlotData {
  const capacityRef = useRef(capacity)
  const writeIndexRef = useRef(0)
  const lengthRef = useRef(0)
  const [seriesMeta, setSeriesMeta] = useState<PlotSeries[]>([])
  const buffersRef = useRef<Float32Array[]>([])
  const tempSeriesViewRef = useRef<Float32Array[]>([])

  const ensureSeries = useCallback((count: number) => {
    const need = Math.max(0, count - buffersRef.current.length)
    if (need > 0) {
      const startIdx = buffersRef.current.length
      for (let i = 0; i < need; i++) {
        buffersRef.current.push(new Float32Array(capacityRef.current))
        tempSeriesViewRef.current.push(new Float32Array(0))
      }
      setSeriesMeta((prev) => {
        const next = [...prev]
        for (let i = 0; i < need; i++) {
          const id = startIdx + i
          next.push({ id, name: `S${id + 1}`, color: DEFAULT_COLORS[id % DEFAULT_COLORS.length] })
        }
        return next
      })
    }
  }, [])

  const parseLine = useCallback((line: string): number[] | null => {
    const header = parseHeaderLine(line)
    if (header) {
      setSeriesMeta(() => header.map((t, idx) => ({
        id: idx,
        name: t,
        color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      })))
      ensureSeries(header.length)
      return null
    }
    return parseDataLine(line)
  }, [ensureSeries])

  const pushLine = useCallback((line: string) => {
    const nums = parseLine(line)
    if (!nums) return
    ensureSeries(nums.length)
    const cap = capacityRef.current
    const idx = writeIndexRef.current
    for (let s = 0; s < nums.length; s++) {
      buffersRef.current[s][idx] = nums[s]
    }
    writeIndexRef.current = (idx + 1) % cap
    lengthRef.current = Math.min(lengthRef.current + 1, cap)
  }, [ensureSeries, parseLine])

  const reset = useCallback(() => {
    writeIndexRef.current = 0
    lengthRef.current = 0
    buffersRef.current = buffersRef.current.map(() => new Float32Array(capacityRef.current))
  }, [])

  const snapshot = useCallback((): PlotSnapshot => {
    const len = lengthRef.current
    const cap = capacityRef.current
    const start = (len === cap) ? writeIndexRef.current : 0
    const series = seriesMeta

    let yMin = Number.POSITIVE_INFINITY
    let yMax = Number.NEGATIVE_INFINITY

    for (let s = 0; s < buffersRef.current.length; s++) {
      const src = buffersRef.current[s]
      const view = computeJoinedView(src, len, cap, start)
      tempSeriesViewRef.current[s] = view
      for (let i = 0; i < view.length; i++) {
        const v = view[i]
        if (v < yMin) yMin = v
        if (v > yMax) yMax = v
      }
    }

    // Finalize y-range
    const range = computeYRangeFromSeries([new Float32Array([yMin, yMax])])
    yMin = range.yMin
    yMax = range.yMax

    return {
      series,
      getSeriesData: (seriesId: number) => tempSeriesViewRef.current[seriesId] ?? new Float32Array(0),
      length: len,
      capacity: cap,
      yMin,
      yMax,
    }
  }, [seriesMeta])

  return { pushLine, reset, snapshot }
}


