import { describe, it, expect } from 'vitest'
import { calculateSamplesPerPixel, calculateDistance, createInteractionState, updateVelocityEstimate, handlePanDelta } from '../canvasInteractions'

describe('canvasInteractions utils', () => {
  it('calculateSamplesPerPixel computes based on canvas width and paddings', () => {
    const canvas = ({ clientWidth: 800 } as unknown) as HTMLCanvasElement
    const spp = calculateSamplesPerPixel(canvas, 401)
    // width=800, left=44, right=8 => chartWidth=748 => (401-1)/748 ≈ 0.5348
    expect(spp).toBeGreaterThan(0.5)
    expect(spp).toBeLessThan(0.6)
  })

  it('calculateDistance uses hypot of deltas', () => {
    expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('updateVelocityEstimate smooths velocities', () => {
    const s = createInteractionState()
    const v1 = updateVelocityEstimate(s, 10, 1000)
    const v2 = updateVelocityEstimate(s, 10, 1010)
    expect(v1).toBeGreaterThan(0)
    expect(v2).toBeGreaterThan(0)
    // EMA should move gradually
    expect(Math.abs(v2 - v1)).toBeLessThan(Math.abs((10/10) - v1) + 1e-6)
  })

  it('handlePanDelta accumulates and emits integer sample steps', () => {
    const s = createInteractionState()
    const calls: number[] = []
    const onPan = (d: number) => calls.push(d)
    handlePanDelta(s, 1, 2, onPan) // +2 samples
    expect(calls).toEqual([2])
    handlePanDelta(s, 0.2, 2, onPan) // +0.4 -> not enough
    expect(calls).toEqual([2])
    handlePanDelta(s, 0.4, 2, onPan) // +0.8 -> total 1.2 -> emits 1, keep 0.2
    expect(calls).toEqual([2, 1])
  })
})


