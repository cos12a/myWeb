import { describe, it, expect } from 'vitest'
import { calculateChartBounds, calculateYAxisTicks, formatTimeLabel } from '../plotRendering'

describe('plotRendering utils', () => {
  it('calculateChartBounds respects y-axis toggle and padding', () => {
    const withAxis = calculateChartBounds(800, 600, true)
    const withoutAxis = calculateChartBounds(800, 600, false)

    expect(withAxis.x).toBe(44)
    expect(withoutAxis.x).toBe(8)
    expect(withAxis.y).toBe(8)
    expect(withAxis.height).toBe(600 - 8 - 26)
    expect(withAxis.width).toBe(800 - 44 - 8)
  })

  it('calculateYAxisTicks returns nice ticks and step', () => {
    const { ticks, step } = calculateYAxisTicks(0, 100, 5)
    expect(step).toBeTypeOf('number')
    expect(step).toBeGreaterThan(0)
    // ticks should be multiples of step within the range
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) {
      expect(Math.abs(t / step - Math.round(t / step))).toBeLessThan(1e-9)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(100)
    }
  })

  it('formatTimeLabel absolute mode adapts precision to window', () => {
    const ts = new Date('2020-01-01T00:00:00.123Z').getTime()
    const right = new Date('2020-01-01T00:00:10.456Z').getTime()
    // large window -> no ms
    const label1 = formatTimeLabel(ts, right, 120_000, 'absolute')
    expect(label1).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    // small window -> includes ms
    const label2 = formatTimeLabel(ts, right, 5_000, 'absolute')
    expect(label2).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
  })

  it('formatTimeLabel relative mode switches units at 1s', () => {
    const right = 10_000
    const tsMs = 9_900 // 100ms before right
    const tsS = 8_500 // 1.5s before right
    const labelMs = formatTimeLabel(tsMs, right, 5_000, 'relative')
    expect(labelMs).toBe('100ms')
    const labelS = formatTimeLabel(tsS, right, 5_000, 'relative')
    expect(labelS.endsWith('s')).toBe(true)
  })
})


