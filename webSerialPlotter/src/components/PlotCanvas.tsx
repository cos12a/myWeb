import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { ViewPortData } from '../store/RingStore'
import { 
  calculateChartBounds, 
  getThemeColors, 
  calculateYAxisTicks,
  drawBackgroundAndGrid,
  drawYAxis,
  drawXAxis,
  drawSeries,
  drawHoverTooltip,
  drawHoverCrosshair
} from '../utils/plotRendering'
import { useCanvasInteractions } from '../hooks/useCanvasInteractions'

/**
 * DPR-aware canvas renderer for the plot area.
 * - Expects a windowed PlotSnapshot (data + times) from the store
 * - Draws background, grid, Y-axis (nice ticks), sample series, and X-axis using stored anchors
 * - Supports mouse/touch grab-to-pan via onPan* callbacks and pinch-to-zoom via onZoomFactor
 */
interface Props {
  snapshot: ViewPortData
  yOverride?: { min: number; max: number } | null
  showYAxis?: boolean
  timeMode?: 'absolute' | 'relative'
  onPanStart?: () => void
  onPanDelta?: (deltaSamples: number) => void
  onPanEnd?: (endVelocitySamplesPerMs: number) => void
  onZoomFactor?: (factor: number) => void
  showHoverTooltip?: boolean
  interactionsEnabled?: boolean
}

export type PlotCanvasHandle = {
  exportPNG: (opts?: { scale?: number; background?: string }) => string
}

export const PlotCanvas = forwardRef<PlotCanvasHandle, Props>(function PlotCanvas({ snapshot, yOverride, showYAxis = true, timeMode = 'absolute', onPanStart, onPanDelta, onPanEnd, onZoomFactor, showHoverTooltip = false, interactionsEnabled = true }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const snapshotRef = useRef<ViewPortData>(snapshot)
  const yOverrideRef = useRef<Props['yOverride']>(yOverride)
  const panStartRef = useRef<Props['onPanStart'] | undefined>(undefined)
  const panDeltaRef = useRef<Props['onPanDelta'] | undefined>(undefined)
  const panEndRef = useRef<Props['onPanEnd'] | undefined>(undefined)
  const zoomFactorRef = useRef<Props['onZoomFactor'] | undefined>(undefined)
  
  // Hover state for tooltip and crosshair (use ref to avoid re-renders)
  const hoverState = useRef<{ x: number; y: number; sampleIndex: number } | null>(null)
  const isDraggingRef = useRef(false)
  
  // Memoize ref assignments to avoid unnecessary updates
  const updateRefs = useCallback(() => {
    panStartRef.current = onPanStart
    panDeltaRef.current = onPanDelta
    panEndRef.current = onPanEnd
    zoomFactorRef.current = onZoomFactor
  }, [onPanStart, onPanDelta, onPanEnd, onZoomFactor])
  
  updateRefs()

  // Utility to convert mouse X coordinate to sample index
  const getSampleIndexFromMouseX = useCallback((mouseX: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    
    const snap = snapshotRef.current
    if (snap.viewPortSize === 0) return null
    
    const leftAxis = showYAxis ? 44 : 0
    const rightPadding = 8
    const chartX = leftAxis
    const chartWidth = Math.max(1, canvas.clientWidth - leftAxis - rightPadding)
    
    // Check if mouse is within chart area
    if (mouseX < chartX || mouseX > chartX + chartWidth) return null
    
    const relativeX = mouseX - chartX
    const xScale = snap.viewPortSize > 1 ? chartWidth / (snap.viewPortSize - 1) : 1
    const sampleIndex = Math.round(relativeX / xScale)
    
    return sampleIndex >= 0 && sampleIndex < snap.viewPortSize ? sampleIndex : null
  }, [showYAxis])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const snap = snapshotRef.current
    const yOv = yOverrideRef.current

    const { viewPortSize } = snap
    const yMin = yOv ? yOv.min : snap.yMin
    const yMax = yOv ? yOv.max : snap.yMax
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    // Calculate layout and theme
    const chart = calculateChartBounds(width, height, showYAxis)
    const theme = getThemeColors()

    if (viewPortSize === 0) {
      // Just draw background and grid for empty state
      drawBackgroundAndGrid(ctx, width, height, chart, theme, [], yMin, yMax)
      return
    }

    // Calculate Y-axis ticks
    const { ticks: yTicks, step } = calculateYAxisTicks(yMin, yMax)

    // Render all chart elements using focused utility functions
    drawBackgroundAndGrid(ctx, width, height, chart, theme, yTicks, yMin, yMax)
    
    if (showYAxis) {
      drawYAxis(ctx, chart, theme, yTicks, step, yMin, yMax)
    }
    
    drawXAxis(ctx, chart, theme, snap, timeMode)
    drawSeries(ctx, chart, snap, yMin, yMax)
    
    // Draw hover crosshair and tooltip if mouse is over a sample and not dragging
    if (hoverState.current && !isDraggingRef.current) {
      // Always draw vertical line on hover
      drawHoverCrosshair(ctx, chart, theme, snap, hoverState.current)
      
      // Draw tooltip if enabled
      if (showHoverTooltip) {
        drawHoverTooltip(ctx, chart, theme, snap, timeMode, hoverState.current)
      }
    }
  }, [showYAxis, timeMode, showHoverTooltip])

  // Resize to DPR changes and container size
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      const newW = Math.floor(rect.width * dpr)
      const newH = Math.floor(rect.height * dpr)
      if (canvas.width !== newW || canvas.height !== newH) {
        canvas.width = newW
        canvas.height = newH
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      draw()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    return () => ro.disconnect()
  }, [draw])

  // Hover tooltip handler (separate from pan/zoom to avoid interference)
  useEffect(() => {
    if (!showHoverTooltip) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const onMouseMove = (e: MouseEvent) => {
      // Don't update hover state while dragging
      if (isDraggingRef.current) return
      
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const sampleIndex = getSampleIndexFromMouseX(mouseX)
      
      if (sampleIndex !== null) {
        hoverState.current = { x: mouseX, y: mouseY, sampleIndex }
        draw() // Redraw with crosshair/tooltip
      } else if (hoverState.current) {
        hoverState.current = null
        draw() // Redraw without crosshair/tooltip
      }
    }
    
    const onMouseLeave = () => {
      if (hoverState.current) {
        hoverState.current = null
        draw() // Redraw without tooltip
      }
    }
    
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseleave', onMouseLeave)
    
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [showHoverTooltip, getSampleIndexFromMouseX, draw])

  // Use shared interactions hook for pan/zoom
  useCanvasInteractions({ canvasRef, snapshot, onPanStart, onPanDelta, onPanEnd, onZoomFactor, enabled: interactionsEnabled })

  // Redraw on snapshot or scale changes (with shallow comparison)
  const prevSnapshotRef = useRef<ViewPortData | null>(null)
  const prevYOverrideRef = useRef<Props['yOverride']>(null)
  
  useEffect(() => {
    const prev = prevSnapshotRef.current
    const shouldRedraw = !prev || 
      prev.viewPortCursor !== snapshot.viewPortCursor ||
      prev.viewPortSize !== snapshot.viewPortSize ||
      prev.yMin !== snapshot.yMin ||
      prev.yMax !== snapshot.yMax ||
      prevYOverrideRef.current !== yOverride
    
    if (shouldRedraw) {
      snapshotRef.current = snapshot
      yOverrideRef.current = yOverride
      prevSnapshotRef.current = snapshot
      prevYOverrideRef.current = yOverride
      draw()
    }
  }, [snapshot, yOverride, draw])

  // Redraw when theme class toggles
  useEffect(() => {
    const observer = new MutationObserver(() => draw())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [draw])

  useImperativeHandle(ref, () => ({
    exportPNG: (opts) => {
      const canvas = canvasRef.current
      if (!canvas) return ''
      const scale = Math.max(1, Math.floor(opts?.scale ?? 1))
      if (scale === 1 && !opts?.background) {
        return canvas.toDataURL('image/png')
      }
      const off = document.createElement('canvas')
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const w = Math.floor(canvas.clientWidth * scale)
      const h = Math.floor(canvas.clientHeight * scale)
      off.width = w
      off.height = h
      const octx = off.getContext('2d')!
      if (opts?.background) {
        octx.fillStyle = opts.background
        octx.fillRect(0, 0, off.width, off.height)
      }
      octx.scale(scale, scale)
      const bitmap = document.createElement('canvas')
      bitmap.width = Math.floor(canvas.clientWidth * dpr)
      bitmap.height = Math.floor(canvas.clientHeight * dpr)
      const bctx = bitmap.getContext('2d')!
      bctx.drawImage(canvas, 0, 0)
      octx.drawImage(bitmap, 0, 0, bitmap.width / dpr, bitmap.height / dpr)
      return off.toDataURL('image/png')
    },
  }))

  return (
    <canvas ref={canvasRef} id="tour-plot-area" className="w-full h-full rounded-lg block" />
  )
})

export default PlotCanvas


