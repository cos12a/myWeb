import { describe, it, expect } from 'vitest'
import { parseHeaderLine, parseDataLine } from '../lineParsing'

describe('lineParsing', () => {
  it('parses header lines with # and various separators', () => {
    expect(parseHeaderLine('# a b c')).toEqual(['a', 'b', 'c'])
    expect(parseHeaderLine('## a, b,  c')).toEqual(['a', 'b', 'c'])
    expect(parseHeaderLine('not header')).toBeNull()
  })

  it('parses numeric data lines and preserves NaN for invalid fields', () => {
    expect(parseDataLine('1, 2  3\t4')).toEqual([1, 2, 3, 4])
    const a = parseDataLine('NaN, 5, inf')!
    expect(Number.isNaN(a[0])).toBe(true)
    expect(a[1]).toBe(5)
    expect(Number.isNaN(a[2])).toBe(true)
    const b = parseDataLine(', 123, , 456,')!
    expect(Number.isNaN(b[0])).toBe(true)
    expect(b[1]).toBe(123)
    expect(Number.isNaN(b[2])).toBe(true)
    expect(b[3]).toBe(456)
    expect(Number.isNaN(b[4])).toBe(true)
    expect(parseDataLine('')).toBeNull()
  })
})


