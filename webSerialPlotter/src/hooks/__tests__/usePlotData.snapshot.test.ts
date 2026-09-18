/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { usePlotData } from '../usePlotData'
import { renderHook, act } from '@testing-library/react'

describe('usePlotData snapshot', () => {
  it('joins ring buffer when full and computes y-range with padding when flat', () => {
    const { result } = renderHook(() => usePlotData(4))
    act(() => {
      result.current.reset()
      result.current.pushLine('1 1')
      result.current.pushLine('2 2')
      result.current.pushLine('3 3')
      result.current.pushLine('4 4')
      result.current.pushLine('5 5')
    })
    const snap = result.current.snapshot()
    const d0 = snap.getSeriesData(0)
    const d1 = snap.getSeriesData(1)
    expect(Array.from(d0)).toEqual([2,3,4,5])
    expect(Array.from(d1)).toEqual([2,3,4,5])
    expect(snap.yMin).toBeLessThanOrEqual(2)
    expect(snap.yMax).toBeGreaterThanOrEqual(5)
  })
})


