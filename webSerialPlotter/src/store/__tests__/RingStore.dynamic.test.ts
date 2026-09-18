import { describe, it, expect, beforeEach } from 'vitest'
import { RingStore } from '../RingStore'

describe('RingStore Dynamic Series Handling', () => {
  let store: RingStore

  beforeEach(() => {
    store = new RingStore(100, 10) // Small capacity for easier testing
  })

  describe('Series Count Expansion', () => {
    it('should create 5 series when first receiving 5 values', () => {
      // Initial state: 0 series
      expect(store.getSeries()).toHaveLength(0)
      
      // Append 5 values
      store.append([10, 20, 30, 40, 50])
      
      // Should create 5 series
      expect(store.getSeries()).toHaveLength(5)
      expect(store.getSeries().map(s => s.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5'])
      
      // Verify colors are assigned
      expect(store.getSeries()[3].color).toBeTruthy()
      expect(store.getSeries()[4].color).toBeTruthy()
      
      // Verify data is stored correctly
      const data = store.getViewPortData()
      expect(data.getSeriesData(0)[data.getSeriesData(0).length - 1]).toBe(10)
      expect(data.getSeriesData(4)[data.getSeriesData(4).length - 1]).toBe(50)
    })

    it('should handle expanding multiple times', () => {
      // Start with 0, create 4, then expand to 6
      store.append([1, 2, 3, 4])
      expect(store.getSeries()).toHaveLength(4)
      
      store.append([10, 20, 30, 40, 50, 60])
      expect(store.getSeries()).toHaveLength(6)
      expect(store.getSeries().map(s => s.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
    })
  })

  describe('Series Count Reduction', () => {
    it('should reduce from 3 to 1 series when receiving 1 value', () => {
      // Start with 0 series, create 3, add some data
      store.append([10, 20, 30])
      expect(store.getSeries()).toHaveLength(3)
      
      // Append only 1 value - should reduce to 1 series
      store.append([100])
      expect(store.getSeries()).toHaveLength(1)
      expect(store.getSeries()[0].name).toBe('S1')
      
      // Verify old data is preserved in remaining series
      const data = store.getViewPortData()
      const series0 = data.getSeriesData(0)
      expect(series0[series0.length - 2]).toBe(10) // Previous value
      expect(series0[series0.length - 1]).toBe(100) // New value
    })

    it('should handle reducing from expanded series', () => {
      // Expand to 5 series
      store.append([1, 2, 3, 4, 5])
      expect(store.getSeries()).toHaveLength(5)
      
      // Reduce back to 2 series
      store.append([10, 20])
      expect(store.getSeries()).toHaveLength(2)
      expect(store.getSeries().map(s => s.name)).toEqual(['S1', 'S2'])
    })
  })

  describe('Mixed Value Count Handling', () => {
    it('should handle fewer values than series (fill with NaN)', () => {
      // Expand to 5 series
      store.append([1, 2, 3, 4, 5])
      expect(store.getSeries()).toHaveLength(5)
      
      // Then append only 2 values - should keep 5 series but fill others with NaN
      store.append([10, 20])
      expect(store.getSeries()).toHaveLength(2) // Should actually reduce to 2 series
      
      const data = store.getViewPortData()
      expect(data.getSeriesData(0)[data.getSeriesData(0).length - 1]).toBe(10)
      expect(data.getSeriesData(1)[data.getSeriesData(1).length - 1]).toBe(20)
    })

    it('should handle empty value arrays', () => {
      const originalLength = store.getSeries().length
      store.append([])
      expect(store.getSeries()).toHaveLength(originalLength)
      expect(store.writeIndex).toBe(0) // Should not increment
    })

    it('should handle single value after multi-value', () => {
      store.append([1, 2, 3, 4])
      expect(store.getSeries()).toHaveLength(4)
      
      store.append([100])
      expect(store.getSeries()).toHaveLength(1)
      
      const data = store.getViewPortData()
      const series0 = data.getSeriesData(0)
      expect(series0[series0.length - 1]).toBe(100)
    })
  })

  describe('Series Names and Colors', () => {
    it('should assign default names to new series', () => {
      store.append([1, 2, 3, 4, 5, 6, 7])
      
      const series = store.getSeries()
      expect(series.map(s => s.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
    })

    it('should assign colors cyclically', () => {
      store.append([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      
      const series = store.getSeries()
      // Should cycle through DEFAULT_COLORS
      expect(series[0].color).toBe('#60a5fa') // First color
      expect(series[8].color).toBe('#60a5fa') // Should cycle back (8 colors in DEFAULT_COLORS)
    })

    it('should preserve existing series names when expanding', () => {
      // Create initial series
      store.append([1, 2, 3])
      // Rename first series
      store.renameSeries(0, 'Temperature')
      
      // Expand series
      store.append([10, 20, 30, 40, 50])
      
      const series = store.getSeries()
      expect(series[0].name).toBe('Temperature') // Should preserve custom name
      expect(series[3].name).toBe('S4') // New series get default names
      expect(series[4].name).toBe('S5')
    })
  })

  describe('Data Integrity', () => {
    it('should maintain data integrity during series count changes', () => {
      // Add initial data
      store.append([1, 2, 3])
      store.append([4, 5, 6])
      
      // Expand series
      store.append([7, 8, 9, 10, 11])
      
      // Verify old data is preserved
      const data = store.getViewPortData()
      const series0 = data.getSeriesData(0)
      const series1 = data.getSeriesData(1)
      
      expect(Array.from(series0).filter(x => !isNaN(x))).toEqual([1, 4, 7])
      expect(Array.from(series1).filter(x => !isNaN(x))).toEqual([2, 5, 8])
    })

    it('should handle viewport operations correctly after series changes', () => {
      // Add data with different series counts
      store.append([1, 2, 3])
      store.append([4, 5]) // Reduces to 2 series
      store.append([7, 8, 9, 10]) // Expands to 4 series
      
      // Viewport operations should work
      store.setViewPortCursor(2)
      store.setViewPortSize(15)
      
      const data = store.getViewPortData()
      expect(data.series).toHaveLength(4)
      expect(data.getSeriesData(0).length).toBe(15)
    })
  })
})