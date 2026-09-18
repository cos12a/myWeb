import { useEffect, useRef } from 'react'
import { calculateDistance, computeSamplesPerPixel, updateVelocityEstimate } from './canvasUtils'
import type { PlotSnapshot } from '../types/plot'

interface UseCanvasInteractionsParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  snapshot: PlotSnapshot
  onPanStart?: () => void
  onPanDelta?: (deltaSamples: number) => void
  onPanEnd?: (endVelocitySamplesPerMs: number) => void
  onZoomFactor?: (factor: number) => void
  enabled?: boolean
}

/**
 * Hook for handling complex canvas interactions including:
 * - Mouse and pointer drag/pan
 * - Touch pinch-to-zoom
 * - Wheel zoom with Ctrl key
 * - Proper cleanup and state management
 */
export function useCanvasInteractions({
  canvasRef,
  snapshot,
  onPanStart,
  onPanDelta,
  onPanEnd,
  onZoomFactor,
  enabled = true,
}: UseCanvasInteractionsParams) {
  
  // Store callbacks in refs to avoid effect recreation
  const panStartRef = useRef(onPanStart)
  const panDeltaRef = useRef(onPanDelta)
  const panEndRef = useRef(onPanEnd)
  const zoomFactorRef = useRef(onZoomFactor)
  const snapshotRef = useRef(snapshot)

  panStartRef.current = onPanStart
  panDeltaRef.current = onPanDelta
  panEndRef.current = onPanEnd
  zoomFactorRef.current = onZoomFactor
  snapshotRef.current = snapshot

  useEffect(() => {
    if (!enabled) {
      const canvas = canvasRef.current
      if (canvas) {
        canvas.style.cursor = ''
        canvas.style.touchAction = ''
      }
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return

    // Interaction state
    let isDragging = false
    let lastX = 0
    let accumSamples = 0
    let activePointerId: number | null = null
    let velocityEstimate = 0
    let lastTimestamp = 0

    // Pinch state
    const pointers = new Map<number, { x: number; y: number }>()
    let isPinching = false
    let pinchStartDistance = 0

    canvas.style.touchAction = 'none'

    const updateCursor = () => {
      canvas.style.cursor = isDragging ? 'grabbing' : 'grab'
    }

    const getSamplesPerPixel = () => computeSamplesPerPixel(canvas.clientWidth, snapshotRef.current.viewPortSize)

    // geometry utils imported from canvasUtils

    const updateVelocity = (deltaX: number, timestamp: number) => {
      const samplesPerPixel = getSamplesPerPixel()
      const r = updateVelocityEstimate(velocityEstimate, deltaX, timestamp, lastTimestamp, samplesPerPixel)
      velocityEstimate = r.velocity
      lastTimestamp = r.lastTimestamp
    }

    const handlePanDelta = (deltaX: number, timestamp: number) => {
      updateVelocity(deltaX, timestamp)
      const samplesPerPixel = getSamplesPerPixel()
      if (samplesPerPixel > 0 && panDeltaRef.current) {
        accumSamples += deltaX * samplesPerPixel
        const step = accumSamples >= 0 ? Math.floor(accumSamples) : Math.ceil(accumSamples)
        if (step !== 0) {
          accumSamples -= step
          panDeltaRef.current(step)
        }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const pointer = pointers.get(e.pointerId)
      if (pointer) {
        pointer.x = e.clientX
        pointer.y = e.clientY
      }

      // Handle pinch zoom
      if (isPinching && pointers.size >= 2 && zoomFactorRef.current) {
        const [p1, p2] = Array.from(pointers.values())
        const distance = calculateDistance(p1, p2)
        if (pinchStartDistance > 0 && distance > 0) {
          const factor = distance / pinchStartDistance
          pinchStartDistance = distance
          zoomFactorRef.current(factor)
        }
        e.preventDefault()
        return
      }

      // Handle drag pan
      if (!isDragging) return
      const deltaX = e.clientX - lastX
      lastX = e.clientX
      handlePanDelta(deltaX, e.timeStamp || performance.now())
      e.preventDefault()
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const deltaX = e.clientX - lastX
      lastX = e.clientX
      handlePanDelta(deltaX, e.timeStamp || performance.now())
      e.preventDefault()
    }

    const cleanupInteractions = () => {
      // Remove all event listeners
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endInteraction)
      window.removeEventListener('pointercancel', endInteraction)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', endInteraction)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endInteraction)
      canvas.removeEventListener('lostpointercapture', onLostCapture)
      canvas.removeEventListener('pointerleave', onCanvasLeave)
      canvas.removeEventListener('wheel', onWheel)
      
      // Release pointer capture
      if (activePointerId != null) {
        try { 
          canvas.releasePointerCapture(activePointerId) 
        } catch { /* ignore */ }
        activePointerId = null
      }
      
      // Reset state
      pointers.clear()
      isPinching = false
      pinchStartDistance = 0
    }

    const endInteraction = (e?: Event) => {
      if (isPinching) {
        isPinching = false
        pinchStartDistance = 0
      }
      
      if (!isDragging) {
        cleanupInteractions()
        return
      }
      
      isDragging = false
      updateCursor()
      cleanupInteractions()
      
      if (panEndRef.current) {
        panEndRef.current(velocityEstimate)
      }
      
      velocityEstimate = 0
      lastTimestamp = 0
      e?.preventDefault?.()
    }

    const onWindowBlur = () => endInteraction()
    const onLostCapture = () => endInteraction()
    const onCanvasLeave = () => { /* capture keeps us dragging; no-op */ }

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      
      if (pointers.size === 2) {
        // Start pinch zoom
        const [p1, p2] = Array.from(pointers.values())
        pinchStartDistance = calculateDistance(p1, p2)
        isPinching = true
        if (panStartRef.current) panStartRef.current()
      } else if (pointers.size === 1) {
        // Start drag pan
        if (e.button !== 0) return
        isDragging = true
        lastX = e.clientX
        accumSamples = 0
        activePointerId = e.pointerId
        velocityEstimate = 0
        lastTimestamp = e.timeStamp || performance.now()
        updateCursor()
        
        try { 
          canvas.setPointerCapture(e.pointerId) 
        } catch { /* ignore */ }
        
        // Add global listeners for smooth interaction
        window.addEventListener('pointermove', onPointerMove, { passive: false })
        window.addEventListener('pointerup', endInteraction, { passive: false })
        window.addEventListener('pointercancel', endInteraction, { passive: false })
        window.addEventListener('blur', onWindowBlur)
        canvas.addEventListener('pointermove', onPointerMove, { passive: false })
        canvas.addEventListener('pointerup', endInteraction, { passive: false })
        canvas.addEventListener('lostpointercapture', onLostCapture)
        canvas.addEventListener('pointerleave', onCanvasLeave)
        window.addEventListener('mousemove', onMouseMove, { passive: false })
        window.addEventListener('mouseup', endInteraction, { passive: false })
        
        if (panStartRef.current) panStartRef.current()
      }
      
      e.preventDefault()
    }

    const onWheel = (e: WheelEvent) => {
      if (!zoomFactorRef.current) return
      if (e.ctrlKey) {
        const factor = Math.pow(1.0015, -e.deltaY)
        zoomFactorRef.current(factor)
        e.preventDefault()
      }
    }

    const onWheelGlobal = (e: WheelEvent) => {
      if (!zoomFactorRef.current) return
      if (!e.ctrlKey) return
      if (!canvas.contains(e.target as Node)) return
      const factor = Math.pow(1.0015, -e.deltaY)
      zoomFactorRef.current(factor)
      e.preventDefault()
    }

    // Set up initial event listeners
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false })
    canvas.addEventListener('pointermove', onPointerMove, { passive: false })
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('wheel', onWheelGlobal, { passive: false, capture: true })
    updateCursor()

    // Cleanup function
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      cleanupInteractions()
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('wheel', onWheelGlobal, true)
      canvas.style.cursor = ''
      canvas.style.touchAction = ''
    }
  }, [canvasRef, enabled]) // canvasRef needed for event listeners

  return {
    // No return values needed - this hook manages interactions internally
  }
}