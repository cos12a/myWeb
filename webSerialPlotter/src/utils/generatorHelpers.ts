export type GeneratorMode = 'sine3' | 'noise' | 'ramp'

export function buildHeader(channelNames: string[], channels: number): string {
  return '# ' + channelNames.slice(0, Math.max(0, channels)).join(' ')
}

export function generateValues(
  mode: GeneratorMode,
  channels: number,
  t: number,
  frequencyHz: number,
  amplitude: number
): number[] {
  const values: number[] = []
  for (let c = 0; c < channels; c++) {
    let v = 0
    if (mode === 'sine3') {
      const phase = (c / Math.max(1, channels)) * Math.PI * 2
      v = Math.sin(2 * Math.PI * frequencyHz * t + phase) * amplitude
    } else if (mode === 'noise') {
      v = (Math.random() * 2 - 1) * amplitude
    } else if (mode === 'ramp') {
      const period = 1 / Math.max(0.0001, frequencyHz)
      const frac = ((t % period) / period)
      v = (2 * frac - 1) * amplitude
    }
    values.push(v)
  }
  return values
}


