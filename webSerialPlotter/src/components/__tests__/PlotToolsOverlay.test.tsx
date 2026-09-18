import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PlotToolsOverlay from '../PlotToolsOverlay'

describe('PlotToolsOverlay', () => {
  it('invokes callbacks on clicks', async () => {
    const onToggle = vi.fn()
    const onIn = vi.fn()
    const onOut = vi.fn()
    const onSave = vi.fn()
    render(
      <div style={{ position: 'relative' }}>
        <PlotToolsOverlay
          frozen={false}
          onToggleFrozen={onToggle}
          onZoomIn={onIn}
          onZoomOut={onOut}
          onSavePng={onSave}
        />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }))
    fireEvent.click(screen.getByRole('button', { name: /save png/i }))
    expect(onToggle).toHaveBeenCalled()
    expect(onIn).toHaveBeenCalled()
    expect(onOut).toHaveBeenCalled()
    expect(onSave).toHaveBeenCalled()
  })
})


