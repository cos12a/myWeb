import { describe, it, expect } from 'vitest'
import { computeJoinedView, computeYRangeFromSeries } from '../plotDataHelpers'

describe('plotDataHelpers', () => {
  it('computeJoinedView returns subarray when not full', () => {
    const buf = new Float32Array([1,2,3,4])
    const view = computeJoinedView(buf, 3, 4, 0)
    expect(Array.from(view)).toEqual([1,2,3])
  })

  it('computeJoinedView joins head/tail when full', () => {
    const buf = new Float32Array([10,20,30,40])
    const view = computeJoinedView(buf, 4, 4, 2)
    expect(Array.from(view)).toEqual([30,40,10,20])
  })

  it('computeYRangeFromSeries handles empty and equal ranges', () => {
    // non-finite -> default
    const r1 = computeYRangeFromSeries([new Float32Array(0)])
    expect(r1.yMin).toBeLessThan(r1.yMax)
    // equal -> padded
    const r2 = computeYRangeFromSeries([new Float32Array([5,5,5])])
    expect(r2.yMin).toBeLessThan(5)
    expect(r2.yMax).toBeGreaterThan(5)
  })
})


