import type { GeneratorConfig } from '../../hooks/useSignalGenerator'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConnectModal from '../ConnectModal'

const noop = () => {}
const genConfig: GeneratorConfig = { mode: 'sine3', channels: 3, sampleRateHz: 100, frequencyHz: 1, amplitude: 1, includeHeader: true, channelNames: ['a','b','c'] }

describe('ConnectModal', () => {
  it('renders when open and switches tabs', () => {
    render(
      <ConnectModal
        isOpen
        onClose={noop}
        onConnectSerial={async () => {}}
        onConnectGenerator={async () => {}}
        isConnecting={false}
        isSupported={true}
        generatorConfig={genConfig}
      />
    )
    expect(screen.getByText(/connect data source/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /signal generator/i }))
    expect(screen.getByText(/signal type/i)).toBeInTheDocument()
  })
})


