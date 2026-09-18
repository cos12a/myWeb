import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSignalGenerator } from '../useSignalGenerator'

describe('useSignalGenerator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits header once then values on interval', () => {
    const lines: string[] = []
    const { result } = renderHook(() => useSignalGenerator((l) => lines.push(l)))
    act(() => {
      result.current.setConfig({ sampleRateHz: 10, channels: 2, includeHeader: true, mode: 'sine3' })
      result.current.start()
    })
    // Advance a few ticks
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // First line is header, subsequent are CSV values
    expect(lines[0].startsWith('# ')).toBe(true)
    expect(lines.slice(1).length).toBeGreaterThan(0)
    // Stop
    act(() => { result.current.stop() })
  })
})


