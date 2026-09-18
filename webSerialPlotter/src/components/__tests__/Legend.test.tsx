import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Legend from '../Legend'

// Mock the data store hook used by Legend
const renameSeries = vi.fn()
const setSeriesColor = vi.fn()
const mockSeries = [
  { id: 0, name: 'Channel A', color: '#ff0000', visible: true },
  { id: 1, name: 'Channel B', color: '#00ff00', visible: true },
]

vi.mock('../../store/dataStore', () => ({
  useDataStore: () => ({
    getSeries: () => mockSeries,
    renameSeries,
    setSeriesColor,
  }),
}))

describe('Legend', () => {
  beforeEach(() => {
    renameSeries.mockClear()
    setSeriesColor.mockClear()
  })

  it('opens edit modal and saves name change', () => {
    render(<Legend />)
    // Open modal for first series
    fireEvent.click(screen.getAllByText('Channel A')[0])
    // Change name
    const nameInput = screen.getByLabelText(/name/i)
    fireEvent.change(nameInput, { target: { value: 'New Name' } })
    // Save
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(renameSeries).toHaveBeenCalledWith(0, 'New Name')
  })

  it('applies color change immediately and cancel reverts original values', () => {
    render(<Legend />)
    fireEvent.click(screen.getAllByText('Channel A')[0])
    const colorInput = screen.getByLabelText(/color/i)
    fireEvent.change(colorInput, { target: { value: '#123456' } })
    expect(setSeriesColor).toHaveBeenCalledWith(0, '#123456')
    // Cancel should revert original name/color
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(renameSeries).toHaveBeenCalledWith(0, 'Channel A')
    expect(setSeriesColor).toHaveBeenCalledWith(0, '#ff0000')
  })
})


