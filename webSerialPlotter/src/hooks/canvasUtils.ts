export type Point = { x: number; y: number }

export function calculateDistance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

/**
 * Computes samples-per-pixel for a given viewport size and canvas width.
 * Returns 0 when viewport size <= 1 to avoid division by zero.
 */
export function computeSamplesPerPixel(
  canvasClientWidth: number,
  viewPortSize: number,
  leftAxis = 44,
  rightPadding = 8
): number {
  if (viewPortSize <= 1) return 0
  const chartWidth = Math.max(1, canvasClientWidth - leftAxis - rightPadding)
  return (viewPortSize - 1) / chartWidth
}

/**
 * Exponential velocity smoothing for momentum; returns new velocity and timestamp.
 */
export function updateVelocityEstimate(
  previousVelocity: number,
  deltaX: number,
  timestampMs: number,
  previousTimestampMs: number,
  samplesPerPixel: number
): { velocity: number; lastTimestamp: number } {
  const dt = Math.max(1, timestampMs - (previousTimestampMs || timestampMs))
  const rawSamples = deltaX * samplesPerPixel
  const instantVelocity = rawSamples / dt
  const velocity = 0.8 * previousVelocity + 0.2 * instantVelocity
  return { velocity, lastTimestamp: timestampMs }
}


