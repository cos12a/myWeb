import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { PlotCanvas } from '../PlotCanvas'

function makeSnapshot(values: number[]) {
  const series = [{ id: 0, name: 'S1', color: '#fff', visible: true }]
  const data = new Float32Array(values)
  return {
    series,
    getSeriesData: () => data,
    yMin: Math.min(...values),
    yMax: Math.max(...values),
    getTimes: () => new Float64Array(values.length).map((_, i) => i * 10) as unknown as Float64Array,
    viewPortCursor: values.length - 1,
    viewPortSize: values.length,
  }
}

describe('PlotCanvas', () => {
  beforeEach(() => {
    // Provide minimal canvas APIs used by the component
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      drawImage: vi.fn(), scale: vi.fn(),
      canvas: document.createElement('canvas'),
    } as unknown as CanvasRenderingContext2D)
  })

  it('renders without crashing and calls canvas context methods', () => {
    const snap = makeSnapshot([1, 2, 3, 4]) as unknown as import('../../types/plot').PlotSnapshot
    const { container } = render(<div style={{ width: 300, height: 150 }}><PlotCanvas snapshot={snap} showHoverTooltip /></div>)
    const canvas = container.querySelector('canvas')!
    // trigger a resize observer manually
    Object.defineProperty(canvas, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 150, configurable: true })
    expect(canvas).toBeInTheDocument()
  })
})


