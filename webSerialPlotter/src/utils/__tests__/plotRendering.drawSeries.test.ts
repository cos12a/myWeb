import { describe, it, expect, vi } from 'vitest'
import { drawSeries } from '../plotRendering'

function makeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    rect: vi.fn(), clip: vi.fn(),
    canvas: document.createElement('canvas'),
  } as unknown as CanvasRenderingContext2D
}

describe('drawSeries', () => {
  it('skips NaN values and clips to chart', () => {
    const ctx = makeCtx()
    const chart = { x: 0, y: 0, width: 100, height: 50 }
    const snapshot = {
      series: [{ id: 0, name: 'S1', color: '#fff', visible: true }],
      getSeriesData: () => new Float32Array([0, NaN, 1, 2]),
      viewPortSize: 4,
    } as unknown as import('../../store/RingStore').ViewPortData
    drawSeries(ctx, chart, snapshot, -1, 3)
    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 100, 50)
    expect(ctx.clip).toHaveBeenCalled()
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('skips hidden series', () => {
    const ctx = makeCtx()
    const chart = { x: 0, y: 0, width: 100, height: 50 }
    const snapshot = {
      series: [
        { id: 0, name: 'S1', color: '#fff', visible: false },
        { id: 1, name: 'S2', color: '#aaa', visible: true }
      ],
      getSeriesData: (id: number) => id === 0 ? new Float32Array([1, 2, 3]) : new Float32Array([4, 5, 6]),
      viewPortSize: 3,
    } as unknown as import('../../store/RingStore').ViewPortData
    
    drawSeries(ctx, chart, snapshot, -1, 10)
    
    // Should only draw once (for visible series S2), not twice
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })
})


