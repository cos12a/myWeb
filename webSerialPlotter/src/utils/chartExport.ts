import type { ViewPortData, RingStore } from '../store/RingStore'
import { downloadFile } from './consoleExport'

export type ChartExportScope = 'visible' | 'all'

export interface ChartExportOptions {
  scope: ChartExportScope
  includeTimestamps?: boolean
  timeFormat?: 'iso' | 'relative' | 'timestamp'
}

export function formatChartTimestamp(timestamp: number, format: 'iso' | 'relative' | 'timestamp', baseTime?: number): string {
  switch (format) {
    case 'iso':
      return new Date(timestamp).toISOString()
    case 'relative': {
      const relativeMs = baseTime ? timestamp - baseTime : timestamp
      return (relativeMs / 1000).toFixed(3) // Convert to seconds with 3 decimal places
    }
    case 'timestamp':
      return timestamp.toString()
    default:
      return timestamp.toString()
  }
}

export function exportVisibleChartDataAsCsv(
  snapshot: ViewPortData, 
  options: ChartExportOptions = { scope: 'visible', includeTimestamps: true, timeFormat: 'iso' }
): string {
  const { series, getTimes, getSeriesData, firstTimestamp } = snapshot
  const times = getTimes()
  
  if (series.length === 0 || times.length === 0) {
    return 'No data available'
  }

  // Build header
  const headers = []
  if (options.includeTimestamps) {
    headers.push('Timestamp')
  }
  headers.push(...series.map(s => s.name))
  
  const csvLines = [headers.join(',')]
  
  // Base time for relative timestamps (first timestamp ever received)
  const baseTime = options.timeFormat === 'relative' ? (firstTimestamp ?? undefined) : undefined
  
  // Export each data point
  for (let i = 0; i < times.length; i++) {
    const row = []
    
    // Add timestamp if requested
    if (options.includeTimestamps && Number.isFinite(times[i])) {
      row.push(formatChartTimestamp(times[i], options.timeFormat || 'iso', baseTime))
    } else if (options.includeTimestamps) {
      row.push('') // Empty timestamp for NaN values
    }
    
    // Add data for each series
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const seriesData = getSeriesData(seriesIndex)
      const value = i < seriesData.length ? seriesData[i] : NaN
      row.push(Number.isFinite(value) ? value.toString() : '')
    }
    
    csvLines.push(row.join(','))
  }
  
  return csvLines.join('\n')
}

export function exportAllChartDataAsCsv(
  store: RingStore,
  options: ChartExportOptions = { scope: 'all', includeTimestamps: true, timeFormat: 'iso' }
): string {
  const series = store.getSeries()
  
  if (series.length === 0) {
    return 'No data available'
  }
  
  // Build header
  const headers = []
  if (options.includeTimestamps) {
    headers.push('Timestamp')
  }
  headers.push(...series.map((s) => s.name))
  
  const csvLines = [headers.join(',')]
  
  // Get all data from the store
  const capacity = store.getCapacity()
  const writeIndex = store.writeIndex
  const totalSamples = Math.min(writeIndex, capacity)
  
  if (totalSamples === 0) {
    return csvLines.join('\n') // Just header
  }
  
  // Determine the range of valid data
  const startIndex = writeIndex > capacity ? writeIndex - capacity : 0
  const endIndex = writeIndex - 1
  
  // Base time for relative timestamps (use first timestamp ever received)
  const baseTime = options.timeFormat === 'relative' ? (store.firstTimestamp ?? undefined) : undefined
  
  // Export each data point in chronological order
  for (let i = startIndex; i <= endIndex; i++) {
    const ringIndex = i % capacity
    const row = []
    
    // Add timestamp if requested
    if (options.includeTimestamps) {
      const timestamp = store.times[ringIndex]
      if (Number.isFinite(timestamp)) {
        row.push(formatChartTimestamp(timestamp, options.timeFormat || 'iso', baseTime))
      } else {
        row.push('') // Empty timestamp for NaN values
      }
    }
    
    // Add data for each series
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const value = store.buffers[seriesIndex][ringIndex]
      row.push(Number.isFinite(value) ? value.toString() : '')
    }
    
    csvLines.push(row.join(','))
  }
  
  return csvLines.join('\n')
}

export function exportChartData(
  snapshot: ViewPortData,
  store: RingStore,
  options: ChartExportOptions
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const scopeLabel = options.scope === 'visible' ? 'visible' : 'all'
  const filename = `chart-data-${scopeLabel}-${timestamp}.csv`
  
  let csvContent: string
  
  if (options.scope === 'visible') {
    csvContent = exportVisibleChartDataAsCsv(snapshot, options)
  } else {
    csvContent = exportAllChartDataAsCsv(store, options)
  }
  
  downloadFile(csvContent, filename, 'text/csv')
}