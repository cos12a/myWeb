import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ThemeToggle from '../ThemeToggle'

describe('ThemeToggle', () => {
  it('toggles theme class on documentElement', () => {
    document.documentElement.classList.remove('dark', 'light')
    render(<ThemeToggle />)
    const btn = screen.getByRole('button', { name: /toggle theme/i })
    fireEvent.click(btn)
    expect(document.documentElement.classList.contains('light') || document.documentElement.classList.contains('dark')).toBe(true)
  })
})


