import { describe, it, expect } from 'vitest'
import { RingStore } from '../RingStore'

describe('RingStore Performance', () => {
  it('should cache viewport data and avoid recomputation', () => {
    const store = new RingStore(1000, 100)
    
    // Fill with data
    for (let i = 0; i < 500; i++) {
      store.append([i, i * 2, i * 3])
    }
    
    // Measure first call (cache miss)
    const start1 = performance.now()
    const data1 = store.getViewPortData()
    const time1 = performance.now() - start1
    
    // Measure second call (cache hit)
    const start2 = performance.now()
    const data2 = store.getViewPortData()
    const time2 = performance.now() - start2
    
    // Cache hit should be much faster (at least 10x)
    expect(time2).toBeLessThan(time1 / 10)
    
    // Data should be identical
    expect(data1).toBe(data2) // Same object reference
    expect(data1.yMin).toBe(data2.yMin)
    expect(data1.yMax).toBe(data2.yMax)
    expect(data1.viewPortCursor).toBe(data2.viewPortCursor)
  })
  
  it('should invalidate cache when store changes', () => {
    const store = new RingStore(100, 20)
    
    // Fill with data
    for (let i = 0; i < 50; i++) {
      store.append([i, i * 2, i * 3])
    }
    
    const data1 = store.getViewPortData()
    
    // Append new data - should invalidate cache
    store.append([100, 200, 300])
    const data2 = store.getViewPortData()
    
    // Should be different objects (cache invalidated)
    expect(data1).not.toBe(data2)
    expect(data1.viewPortCursor).not.toBe(data2.viewPortCursor)
  })
  
  it('should invalidate cache when viewport changes', () => {
    const store = new RingStore(100, 20)
    
    for (let i = 0; i < 50; i++) {
      store.append([i, i * 2, i * 3])
    }
    
    const data1 = store.getViewPortData()
    
    // Change viewport cursor - should invalidate cache
    store.setViewPortCursor(20)
    const data2 = store.getViewPortData()
    
    // Should be different objects (cache invalidated)
    expect(data1).not.toBe(data2)
    expect(data1.viewPortCursor).not.toBe(data2.viewPortCursor)
  })
  
  it('should NOT invalidate cache for operations that don\'t affect viewport data', () => {
    const store = new RingStore(100, 20)
    
    for (let i = 0; i < 50; i++) {
      store.append([i, i * 2, i * 3])
    }
    
    const data1 = store.getViewPortData()
    
    // These operations should NOT invalidate cache
    store.renameSeries(0, 'NewName')
    const data2 = store.getViewPortData()
    
    store.setSeriesColor(1, '#ff0000')
    const data3 = store.getViewPortData()
    
    // Should be same object references (cache preserved)
    expect(data1).toBe(data2)
    expect(data2).toBe(data3)
    
    // But the series data should reflect the changes
    expect(data3.series[0].name).toBe('NewName')
    expect(data3.series[1].color).toBe('#ff0000')
  })
})