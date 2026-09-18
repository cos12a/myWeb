import { describe, it, expect, vi } from 'vitest'
import { buildHeader, generateValues } from '../generatorHelpers'

describe('generatorHelpers', () => {
  it('buildHeader respects channels and names', () => {
    expect(buildHeader(['a','b','c'], 2)).toBe('# a b')
    expect(buildHeader(['x','y'], 5)).toBe('# x y')
  })

  it('generateValues produces sine3 phases, noise, and ramp', () => {
    // Deterministic noise
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(1).mockReturnValueOnce(0)
    const sine = generateValues('sine3', 3, /*t*/0, 1, 1)
    expect(sine.length).toBe(3)
    expect(sine[0]).toBeCloseTo(0)
    expect(sine[1]).toBeCloseTo(Math.sin(2 * Math.PI * (1/3)))
    expect(sine[2]).toBeCloseTo(Math.sin(2 * Math.PI * (2/3)))

    const noise = generateValues('noise', 2, 0, 1, 2)
    expect(noise[0]).toBeCloseTo(2)
    expect(noise[1]).toBeCloseTo(-2)
    spy.mockRestore()

    const ramp = generateValues('ramp', 1, 0.25, 1, 2)
    // frequency 1Hz => period 1s, t=0.25 => frac=0.25 => value = (2*0.25-1)*2 = -1
    expect(ramp[0]).toBeCloseTo(-1)
  })
})


