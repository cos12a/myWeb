import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SeriesPanel from '../SeriesPanel'

const renameSeries = vi.fn()
const setSeriesColor = vi.fn()
const mockSeries = [
  { id: 0, name: 'S1', color: '#111111', visible: true },
  { id: 1, name: 'S2', color: '#222222', visible: true },
]

vi.mock('../../store/dataStore', () => ({
  useDataStore: () => ({
    getSeries: () => mockSeries,
    renameSeries,
    setSeriesColor,
  }),
}))

describe('SeriesPanel', () => {
  beforeEach(() => {
    renameSeries.mockClear()
    setSeriesColor.mockClear()
  })

  it('renames and recolors series inline', () => {
    render(<SeriesPanel />)
    const nameInputs = screen.getAllByDisplayValue(/S[12]/)
    fireEvent.change(nameInputs[0], { target: { value: 'A' } })
    expect(renameSeries).toHaveBeenCalledWith(0, 'A')
    // find color input by type attribute since it's role=none
    const color = screen.getAllByDisplayValue('#111111')[0] as HTMLInputElement
    fireEvent.change(color, { target: { value: '#abcdef' } })
    expect(setSeriesColor).toHaveBeenCalledWith(0, '#abcdef')
  })
})


