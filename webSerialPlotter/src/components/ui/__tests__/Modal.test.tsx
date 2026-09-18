import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Modal from '../Modal'

describe('Modal', () => {
  it('shows content when open', () => {
    render(
      // Modal uses prop `open`, not `isOpen`
      <Modal open onClose={() => {}}>
        <div>Content</div>
      </Modal>
    )
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    const { queryByText } = render(
      <Modal open={false} onClose={() => {}}>
        <div>Hidden</div>
      </Modal>
    )
    expect(queryByText('Hidden')).toBeNull()
  })
})


