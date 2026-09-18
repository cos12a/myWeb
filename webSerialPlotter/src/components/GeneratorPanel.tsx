import { useSignalGenerator } from '../hooks/useSignalGenerator'
import Button from './ui/Button'
import { PlayIcon, StopIcon } from '@heroicons/react/24/outline'
import Input from './ui/Input'
import Select from './ui/Select'

interface Props {
  onEmitLine: (line: string) => void
  disabled?: boolean
}

export function GeneratorPanel({ onEmitLine, disabled }: Props) {
  const gen = useSignalGenerator(onEmitLine)

  return (
    <div className="flex items-center gap-2">
      <Select
        value={gen.config.mode}
        onChange={(e) => gen.setConfig({ mode: e.target.value as 'sine3' | 'noise' | 'ramp' })}
        disabled={disabled || gen.isRunning}
      >
        <option value="sine3">Sine (phased)</option>
        <option value="noise">Noise</option>
        <option value="ramp">Ramp</option>
      </Select>
      <Input
        className="w-24"
        type="number"
        step="1"
        min={1}
        value={gen.config.sampleRateHz}
        onChange={(e) => gen.setConfig({ sampleRateHz: Number(e.target.value) || 1 })}
        disabled={disabled || gen.isRunning}
      />
      <span className="text-xs opacity-70">Hz</span>
      {gen.isRunning ? (
        <Button variant="danger" onClick={() => gen.stop()} startIcon={<StopIcon className="w-4 h-4" />}>Stop</Button>
      ) : (
        <Button variant="primary" onClick={() => gen.start()} disabled={disabled} startIcon={<PlayIcon className="w-4 h-4" />}>Start</Button>
      )}
    </div>
  )
}

export default GeneratorPanel


