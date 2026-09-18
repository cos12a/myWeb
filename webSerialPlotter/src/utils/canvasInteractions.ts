/**
 * Utility functions for canvas interaction handling.
 * Breaks down complex event handling into focused, testable pieces.
 */

export interface InteractionState {
  isDragging: boolean
  lastX: number
  accumSamples: number
  activePointerId: number | null
  velocityEstimate: number
  lastTimestamp: number
  pointers: Map<number, { x: number; y: number }>
  isPinching: boolean
  pinchStartDistance: number
}

export function createInteractionState(): InteractionState {
  return {
    isDragging: false,
    lastX: 0,
    accumSamples: 0,
    activePointerId: null,
    velocityEstimate: 0,
    lastTimestamp: 0,
    pointers: new Map(),
    isPinching: false,
    pinchStartDistance: 0,
  }
}

export function calculateSamplesPerPixel(
  canvas: HTMLCanvasElement,
  snapshotLength: number
): number {
  if (snapshotLength <= 1) return 0
  const width = canvas.clientWidth
  const leftAxis = 44
  const rightPadding = 8
  const chartWidth = Math.max(1, width - leftAxis - rightPadding)
  return (snapshotLength - 1) / chartWidth
}

export function calculateDistance(
  a: { x: number; y: number }, 
  b: { x: number; y: number }
): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

export function updateVelocityEstimate(
  state: InteractionState,
  deltaX: number,
  timestamp: number
): number {
  const deltaTime = Math.max(1, timestamp - (state.lastTimestamp || timestamp))
  state.lastTimestamp = timestamp
  const instantVelocity = deltaX / deltaTime
  // Smooth velocity with exponential moving average
  state.velocityEstimate = 0.8 * state.velocityEstimate + 0.2 * instantVelocity
  return state.velocityEstimate
}

export function handlePanDelta(
  state: InteractionState,
  deltaX: number,
  samplesPerPixel: number,
  onPanDelta?: (deltaSamples: number) => void
): void {
  if (samplesPerPixel > 0 && onPanDelta) {
    state.accumSamples += deltaX * samplesPerPixel
    const step = state.accumSamples >= 0 
      ? Math.floor(state.accumSamples) 
      : Math.ceil(state.accumSamples)
    
    if (step !== 0) {
      state.accumSamples -= step
      onPanDelta(step)
    }
  }
}

export function createEventCleanup() {
  const listeners: Array<() => void> = []
  
  const addListener = (
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ) => {
    target.addEventListener(event, handler, options)
    listeners.push(() => target.removeEventListener(event, handler, options))
  }
  
  const cleanup = () => {
    listeners.forEach(remove => remove())
    listeners.length = 0
  }
  
  return { addListener, cleanup }
}