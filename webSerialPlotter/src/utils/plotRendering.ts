import type { ViewPortData } from '../store/RingStore'

/**
 * Utility functions for plot canvas rendering.
 * Breaks down the complex draw() function into focused, testable pieces.
 */

export interface ChartBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Theme {
  plotBg: string
  plotGrid: string
  textColor: string
}

export interface AxisConfig {
  yMin: number
  yMax: number
  showYAxis: boolean
}

/**
 * Calculates chart layout bounds based on canvas dimensions and axis visibility.
 */
export function calculateChartBounds(
  canvasWidth: number, 
  canvasHeight: number, 
  showYAxis: boolean
): ChartBounds {
  const leftAxis = showYAxis ? 44 : 8
  const rightPadding = 8
  const topPadding = 8
  const bottomPadding = 26
  
  return {
    x: leftAxis,
    y: topPadding,
    width: Math.max(1, canvasWidth - leftAxis - rightPadding),
    height: Math.max(1, canvasHeight - topPadding - bottomPadding),
  }
}

/**
 * Extracts theme colors from CSS custom properties.
 */
export function getThemeColors(): Theme {
  const getVar = (name: string, fallback: string) => 
    getComputedStyle(document.documentElement).getPropertyValue(name) || fallback
  
  return {
    plotBg: getVar('--plot-bg', 'rgba(10,10,10,0.9)'),
    plotGrid: getVar('--plot-grid', 'rgba(255,255,255,0.06)'),
    textColor: getComputedStyle(document.documentElement).getPropertyValue('--text') || '#e5e5e5',
  }
}

/**
 * Calculates nice tick values for Y-axis labeling.
 */
export function calculateYAxisTicks(yMin: number, yMax: number, approxTickCount = 6) {
  const range = yMax - yMin
  
  const niceNumber = (value: number, round: boolean) => {
    const exp = Math.floor(Math.log10(value))
    const fraction = value / Math.pow(10, exp)
    let niceFraction
    
    if (round) {
      if (fraction < 1.5) niceFraction = 1
      else if (fraction < 3) niceFraction = 2
      else if (fraction < 7) niceFraction = 5
      else niceFraction = 10
    } else {
      if (fraction <= 1) niceFraction = 1
      else if (fraction <= 2) niceFraction = 2
      else if (fraction <= 5) niceFraction = 5
      else niceFraction = 10
    }
    
    return niceFraction * Math.pow(10, exp)
  }
  
  const step = niceNumber(range / approxTickCount, true)
  const tickMin = Math.ceil(yMin / step) * step
  const tickMax = Math.floor(yMax / step) * step
  
  const ticks: number[] = []
  for (let value = tickMin; value <= tickMax + 1e-9; value += step) {
    ticks.push(value)
  }
  
  return { ticks, step }
}

/**
 * Draws the background and grid lines.
 */
export function drawBackgroundAndGrid(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  chart: ChartBounds,
  theme: Theme,
  yTicks: number[],
  yMin: number,
  yMax: number
) {
  // Clear and fill background
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
  
  ctx.fillStyle = theme.plotBg
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  
  const yScale = (yMax - yMin) !== 0 ? chart.height / (yMax - yMin) : 1
  
  ctx.strokeStyle = theme.plotGrid
  ctx.lineWidth = 1
  
  // Horizontal grid lines at Y tick positions
  for (const tickValue of yTicks) {
    const y = chart.y + chart.height - (tickValue - yMin) * yScale
    ctx.beginPath()
    ctx.moveTo(chart.x, y + 0.5)
    ctx.lineTo(chart.x + chart.width, y + 0.5)
    ctx.stroke()
  }
}

/**
 * Draws the Y-axis line and labels.
 */
export function drawYAxis(
  ctx: CanvasRenderingContext2D,
  chart: ChartBounds,
  theme: Theme,
  ticks: number[],
  step: number,
  yMin: number,
  yMax: number
) {
  const yScale = (yMax - yMin) !== 0 ? chart.height / (yMax - yMin) : 1
  
  // Y-axis line
  ctx.strokeStyle = theme.plotGrid
  ctx.beginPath()
  ctx.moveTo(chart.x + 0.5, chart.y)
  ctx.lineTo(chart.x + 0.5, chart.y + chart.height)
  ctx.stroke()
  
  // Y-axis labels
  ctx.fillStyle = theme.textColor.trim() || '#e5e5e5'
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  
  for (const tickValue of ticks) {
    const y = chart.y + chart.height - (tickValue - yMin) * yScale
    const label = tickValue.toFixed(Math.max(0, -Math.floor(Math.log10(step))))
    ctx.fillText(label, chart.x - 6, y)
  }
}

/**
 * Formats timestamp for X-axis labels based on time mode and window duration.
 */
export function formatTimeLabel(
  timestamp: number,
  rightTime: number,
  windowMs: number,
  timeMode: 'absolute' | 'relative',
  firstTimestamp?: number | null
): string {
  if (timeMode === 'absolute') {
    const date = new Date(timestamp)
    const hh = date.getHours().toString().padStart(2, '0')
    const mm = date.getMinutes().toString().padStart(2, '0')
    const ss = date.getSeconds().toString().padStart(2, '0')
    const ms = date.getMilliseconds().toString().padStart(3, '0')
    
    if (windowMs >= 60_000) return `${hh}:${mm}:${ss}`
    return `${hh}:${mm}:${ss}.${ms}`
  } else {
    // Use first timestamp for consistent relative time, fallback to old behavior
    const baseTime = (firstTimestamp != null) ? firstTimestamp : rightTime
    const deltaTime = timestamp - baseTime
    const seconds = Math.abs(deltaTime) / 1000
    return seconds >= 1 
      ? `${seconds.toFixed((seconds >= 10 || windowMs >= 60_000) ? 0 : 1)}s`
      : `${Math.round(seconds * 1000)}ms`
  }
}

/**
 * Draws the X-axis using anchor points for time labels.
 */
export function drawXAxis(
  ctx: CanvasRenderingContext2D,
  chart: ChartBounds,
  theme: Theme,
  snapshot: ViewPortData,
  timeMode: 'absolute' | 'relative'
) {
  const times = snapshot.getTimes?.() ?? new Float64Array(0)
  if (times.length < 2) return

  ctx.strokeStyle = theme.plotGrid
  ctx.lineWidth = 1
  ctx.fillStyle = theme.textColor.trim() || '#e5e5e5'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial'

  // Create stable tick marks anchored to sample indices
  const targetTickCount = 5
  const stepSize = Math.max(1, Math.floor(snapshot.viewPortSize / targetTickCount))
  
  // Calculate the absolute sample index range for the current viewport
  const viewportStartSample = snapshot.viewPortCursor - snapshot.viewPortSize + 1
  const viewportEndSample = snapshot.viewPortCursor
  
  // Find first stable tick position - align to stepSize grid
  const firstTickSample = Math.ceil(viewportStartSample / stepSize) * stepSize
  
  const xScale = snapshot.viewPortSize > 1 ? chart.width / (snapshot.viewPortSize - 1) : 1
    
  // Draw ticks at stable sample indices
  for (let sampleIndex = firstTickSample; sampleIndex <= viewportEndSample; sampleIndex += stepSize) {
    // Convert absolute sample index to viewport relative index (0 to viewPortSize-1)
    const viewportIndex = sampleIndex - viewportStartSample
    
    if (viewportIndex < 0 || viewportIndex >= snapshot.viewPortSize) continue
    
    // Check if we have valid time data at this index
    if (viewportIndex >= times.length || !Number.isFinite(times[viewportIndex])) continue
    
    // Calculate screen position for this viewport index
    const screenX = chart.x + viewportIndex * xScale
    
    // Draw label using the timestamp at this viewport index
    const timestamp = times[viewportIndex]
    const windowMs = Math.max(1, times[times.length - 1] - times[0])
    const label = formatTimeLabel(timestamp, times[times.length - 1], windowMs, timeMode, snapshot.firstTimestamp)
    ctx.fillText(label, screenX, chart.y + chart.height + 6)
  }
  ctx.beginPath()
  for (let sampleIndex = firstTickSample; sampleIndex <= viewportEndSample; sampleIndex += stepSize) {
    // Convert absolute sample index to viewport relative index (0 to viewPortSize-1)
    const viewportIndex = sampleIndex - viewportStartSample
    
    if (viewportIndex < 0 || viewportIndex >= snapshot.viewPortSize) continue
    
    // Check if we have valid time data at this index
    if (viewportIndex >= times.length || !Number.isFinite(times[viewportIndex])) continue
    
    // Calculate screen position for this viewport index
    const screenX = chart.x + viewportIndex * xScale
    ctx.moveTo(screenX + 0.5, chart.y)
    ctx.lineTo(screenX + 0.5, chart.y + chart.height)
  }
  ctx.stroke()
}

/**
 * Draws all data series as line plots.
 */
export function drawSeries(
  ctx: CanvasRenderingContext2D,
  chart: ChartBounds,
  snapshot: ViewPortData,
  yMin: number,
  yMax: number
) {
  if (snapshot.viewPortSize === 0) return
  
  const xScale = snapshot.viewPortSize > 1 ? chart.width / (snapshot.viewPortSize - 1) : 1
  const yScale = (yMax - yMin) !== 0 ? chart.height / (yMax - yMin) : 1
  
  // Clip to chart area to prevent drawing outside bounds
  ctx.save()
  ctx.beginPath()
  ctx.rect(chart.x, chart.y, chart.width, chart.height)
  ctx.clip()
  
  // Draw each series
  for (const series of snapshot.series) {
    // Skip hidden series
    if (!series.visible) continue
    
    const data = snapshot.getSeriesData(series.id)
    if (!data || data.length === 0) continue
    
    ctx.beginPath()
    ctx.strokeStyle = series.color
    ctx.lineWidth = 1.5
    
    let hasPath = false
    let lastX = -Infinity
    let lastY = -Infinity
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i]
      if (!Number.isFinite(value)) {
        // Skip NaN/undefined values - break the path
        hasPath = false
        continue
      }
      
      const x = chart.x + i * xScale
      const y = chart.y + chart.height - (value - yMin) * yScale
      
      // Skip subpixel movements for performance
      if (Math.abs(x - lastX) < 0.5 && Math.abs(y - lastY) < 0.5 && hasPath) {
        continue
      }
      
      if (!hasPath) {
        ctx.moveTo(x, y)
        hasPath = true
      } else {
        ctx.lineTo(x, y)
      }
      
      lastX = x
      lastY = y
    }
    
    ctx.stroke()
  }
  
  ctx.restore()
}

/**
 * Draws a vertical crosshair line at the hovered sample position.
 */
export function drawHoverCrosshair(
  ctx: CanvasRenderingContext2D,
  chart: ChartBounds,
  theme: Theme,
  snapshot: ViewPortData,
  hover: { x: number; y: number; sampleIndex: number }
) {
  const { sampleIndex } = hover
  if (sampleIndex < 0 || sampleIndex >= snapshot.viewPortSize) return
  
  // Draw vertical line at sample position
  const xScale = snapshot.viewPortSize > 1 ? chart.width / (snapshot.viewPortSize - 1) : 1
  const lineX = chart.x + sampleIndex * xScale
  
  ctx.save()
  ctx.strokeStyle = theme.textColor
  ctx.globalAlpha = 0.5
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(lineX, chart.y)
  ctx.lineTo(lineX, chart.y + chart.height)
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws a hover tooltip showing sample values at the specified index.
 */
export function drawHoverTooltip(
  ctx: CanvasRenderingContext2D,
  chart: ChartBounds,
  theme: Theme,
  snapshot: ViewPortData,
  timeMode: 'absolute' | 'relative',
  hover: { x: number; y: number; sampleIndex: number }
) {
  const { sampleIndex } = hover
  if (sampleIndex < 0 || sampleIndex >= snapshot.viewPortSize) return
  
  const times = snapshot.getTimes?.() ?? new Float64Array(0)
  if (sampleIndex >= times.length) return
  
  const timestamp = times[sampleIndex]
  if (!Number.isFinite(timestamp)) return // Skip NaN timestamps
  
  // Collect all series values at this index (only for visible series)
  const values: Array<{ name: string; value: number; color: string }> = []
  for (const series of snapshot.series) {
    // Skip hidden series
    if (!series.visible) continue
    
    const data = snapshot.getSeriesData(series.id)
    if (sampleIndex < data.length) {
      const value = data[sampleIndex]
      if (Number.isFinite(value)) {
        values.push({ name: series.name, value, color: series.color })
      }
    }
  }
  
  if (values.length === 0) return
  
  // Format timestamp
  const rightTime = times[times.length - 1]
  const windowMs = Math.max(1, rightTime - times[0])
  const timeLabel = formatTimeLabel(timestamp, rightTime, windowMs, timeMode, snapshot.firstTimestamp)
  
  // Calculate tooltip content and size
  const lines = [`Time: ${timeLabel}`, ...values.map(v => `${v.name}: ${v.value.toFixed(3)}`)]
  const padding = 8
  const lineHeight = 14
  const fontSize = 12
  
  ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  
  // Measure text for tooltip sizing
  const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width))
  const tooltipWidth = maxWidth + padding * 2
  const tooltipHeight = lines.length * lineHeight + padding * 2
  
  // Position tooltip (avoid edges)
  let tooltipX = hover.x + 10
  let tooltipY = hover.y - tooltipHeight - 10
  
  if (tooltipX + tooltipWidth > chart.x + chart.width) {
    tooltipX = hover.x - tooltipWidth - 10
  }
  if (tooltipY < chart.y) {
    tooltipY = hover.y + 10
  }
  
  // Draw tooltip background
  ctx.fillStyle = theme.plotBg
  ctx.strokeStyle = theme.plotGrid
  ctx.lineWidth = 1
  ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight)
  ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight)
  
  // Draw tooltip text
  ctx.fillStyle = theme.textColor
  lines.forEach((line, i) => {
    ctx.fillText(line, tooltipX + padding, tooltipY + padding + i * lineHeight)
  })
}