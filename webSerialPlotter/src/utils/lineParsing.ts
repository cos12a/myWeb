/**
 * Parses a header line that optionally starts with '#' and returns channel names.
 * Returns null if the line is not a header.
 */
export function parseHeaderLine(line: string): string[] | null {
  if (!line) return null
  const trimmed = line.trim()
  if (!trimmed.startsWith('#')) return null
  const raw = trimmed.replace(/^#+\s*/, '')
  const tokens = raw.split(/[\s,\t]+/).filter(Boolean)
  return tokens.length > 0 ? tokens : []
}

/**
 * Parses a data line into an array of finite numbers.
 * Accepts comma/space/tab separators. Returns null if no numbers were found.
 */
export function parseDataLine(line: string): number[] | null {
  if (!line) return null
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  let tokens: string[] = []
  if (trimmed.includes(',')) {
    const segments = trimmed.split(',')
    for (const seg of segments) {
      const t = seg.trim()
      if (t === '') {
        tokens.push('')
      } else {
        tokens.push(...t.split(/\s+/))
      }
    }
  } else {
    tokens = trimmed.split(/\s+/)
  }
  if (tokens.length === 0) return null
  // Preserve positions; map empty/invalid tokens to NaN
  const nums = tokens.map((p) => (p === '' ? NaN : Number(p)))
  return nums
}


