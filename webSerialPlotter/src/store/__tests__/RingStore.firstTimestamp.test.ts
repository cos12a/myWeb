import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RingStore } from '../RingStore'

describe('RingStore firstTimestamp', () => {
  let store: RingStore
  const mockNow = 1609459200000 // 2021-01-01 00:00:00 UTC

  beforeEach(() => {
    // Mock Date.now() to return consistent value
    vi.spyOn(Date, 'now').mockReturnValue(mockNow)

    store = new RingStore(10, 5)
    store.setSeries(['temp', 'humidity'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should capture firstTimestamp on first append', () => {
    expect(store.firstTimestamp).toBeNull()
    
    store.append([23.5, 45.2])
    
    expect(store.firstTimestamp).toBe(mockNow)
  })

  it('should not change firstTimestamp on subsequent appends', () => {
    store.append([23.5, 45.2])
    const firstTs = store.firstTimestamp
    
    store.append([24.0, 46.1]) 
    store.append([24.5, 47.0])
    
    expect(store.firstTimestamp).toBe(firstTs)
    expect(store.firstTimestamp).toBe(mockNow)
  })

  it('should reset firstTimestamp on reset', () => {
    store.append([23.5, 45.2])
    expect(store.firstTimestamp).toBe(mockNow)
    
    store.reset(10, 5, ['temp'])
    
    expect(store.firstTimestamp).toBeNull()
  })

  it('should include firstTimestamp in ViewPortData', () => {
    store.append([23.5, 45.2])
    store.append([24.0, 46.1])
    
    const viewData = store.getViewPortData()
    
    expect(viewData.firstTimestamp).toBe(mockNow)
  })

  it('should handle setSeries without affecting firstTimestamp', () => {
    store.append([23.5, 45.2])
    const firstTs = store.firstTimestamp
    
    store.setSeries(['temperature', 'humidity', 'pressure'])
    
    // setSeries calls reset, which should reset firstTimestamp
    expect(store.firstTimestamp).toBeNull()
    expect(store.firstTimestamp).not.toBe(firstTs)
  })

  it('should maintain firstTimestamp through capacity changes', () => {
    store.append([23.5, 45.2])
    store.append([24.0, 46.1])
    const firstTs = store.firstTimestamp
    
    store.setCapacity(20) // Increase capacity
    
    expect(store.firstTimestamp).toBe(firstTs) // Should be preserved
    
    const viewData = store.getViewPortData()
    expect(viewData.firstTimestamp).toBe(firstTs)
  })
})