import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScaleControls from '../ScaleControls'

describe('ScaleControls', () => {
  it('calls onChange for autoscale and inputs', () => {
    const onChange = vi.fn()
    render(<ScaleControls autoscale={false} yMin={-1} yMax={1} onChange={onChange} />)
    const [minInput, maxInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(minInput, { target: { value: '-2' } })
    expect(onChange).toHaveBeenCalledWith({ yMin: -2 })
    fireEvent.change(maxInput, { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ yMax: 3 })
    fireEvent.click(screen.getByLabelText(/autoscale y/i))
    expect(onChange).toHaveBeenCalledWith({ autoscale: true })
  })
})


