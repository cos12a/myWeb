import type { PlotSnapshot } from '../../types/plot'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatsPanel } from '../StatsPanel'
import { DataStoreProvider } from '../../store/dataStore'

function makeSnapshot(values: number[]) {
  const series = [{ id: 0, name: 'S1', color: '#fff', visible: true }]
  const data = new Float32Array(values)
  return {
    series,
    getSeriesData: () => data,
    yMin: Math.min(...values),
    yMax: Math.max(...values),
    getTimes: () => new Float64Array(),
    viewPortCursor: 0,
    viewPortSize: values.length,
  }
}

describe('StatsPanel', () => {
  it('renders stats values for a single series', () => {
    const snap = makeSnapshot([1, 2, 3, 4]) as unknown as PlotSnapshot
    render(
      <DataStoreProvider>
        <StatsPanel snapshot={snap} />
      </DataStoreProvider>
    )
    expect(screen.getByText('S1')).toBeInTheDocument()
    expect(screen.getByText(/min:/i)).toBeInTheDocument()
    expect(screen.getByText(/max:/i)).toBeInTheDocument()
    expect(screen.getByText(/mean:/i)).toBeInTheDocument()
  })
})


