import { describe, it, expect } from 'vitest'
import { calculateDistance, computeSamplesPerPixel, updateVelocityEstimate } from '../canvasUtils'

describe('canvasUtils', () => {
  it('calculateDistance computes hypot correctly', () => {
    expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('computeSamplesPerPixel returns 0 for size <= 1 and positive otherwise', () => {
    expect(computeSamplesPerPixel(800, 1)).toBe(0)
    const spp = computeSamplesPerPixel(800, 401)
    expect(spp).toBeGreaterThan(0.5)
    expect(spp).toBeLessThan(0.6)
  })

  it('updateVelocityEstimate computes EMA of velocity', () => {
    const spp = 0.5
    const a = updateVelocityEstimate(0, 10, 1000, 0, spp)
    const b = updateVelocityEstimate(a.velocity, 10, 1010, a.lastTimestamp, spp)
    expect(a.velocity).toBeGreaterThan(0)
    // EMA should move toward instantaneous velocity but not exceed it dramatically
    expect(b.velocity).toBeGreaterThan(0)
  })
})


