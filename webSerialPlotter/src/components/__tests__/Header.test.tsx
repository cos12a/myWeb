import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Header from '../Header'

import type { ConnectionState } from '../../hooks/useDataConnection'

const baseState: ConnectionState = {
  type: null,
  isConnecting: false,
  isConnected: false,
  isSupported: true,
  error: null as string | null,
}

const genCfg = { mode: 'sine3', channels: 3, sampleRateHz: 100, frequencyHz: 1, amplitude: 1, includeHeader: true, channelNames: ['a','b','c'] }

describe('Header', () => {
  it('shows Connect when disconnected and opens modal on click', () => {
    const onDisconnect = vi.fn()
    const onConnectSerial = vi.fn(async () => {})
    const onConnectGenerator = vi.fn(async () => {})
    render(
      <Header
        connectionState={baseState}
        onConnectSerial={onConnectSerial}
        onConnectGenerator={onConnectGenerator}
        onDisconnect={onDisconnect}
        generatorConfig={genCfg}
      />
    )
    const btn = screen.getByRole('button', { name: /connect/i })
    fireEvent.click(btn)
    expect(screen.getByText(/connect data source/i)).toBeInTheDocument()
  })

  it('shows Serial Connected when connected and calls onDisconnect', () => {
    const onDisconnect = vi.fn(async () => {})
    render(
      <Header
        connectionState={{ ...baseState, isConnected: true, type: 'serial' }}
        onConnectSerial={async () => {}}
        onConnectGenerator={async () => {}}
        onDisconnect={onDisconnect}
        generatorConfig={genCfg}
      />
    )
    const btn = screen.getByRole('button', { name: /serial connected/i })
    fireEvent.click(btn)
    expect(onDisconnect).toHaveBeenCalled()
  })
})


