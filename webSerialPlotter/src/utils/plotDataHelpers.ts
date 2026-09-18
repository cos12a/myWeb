export function computeJoinedView(src: Float32Array, length: number, capacity: number, start: number): Float32Array {
  if (length < capacity) {
    return src.subarray(0, length)
  }
  const tail = src.subarray(start)
  const head = src.subarray(0, start)
  const joined = new Float32Array(length)
  joined.set(tail, 0)
  joined.set(head, tail.length)
  return joined
}

export function computeYRangeFromSeries(series: Array<Float32Array | undefined>): { yMin: number; yMax: number } {
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (const arr of series) {
    if (!arr) continue
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]
      if (v < yMin) yMin = v
      if (v > yMax) yMax = v
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1
    yMax = 1
  }
  if (yMax === yMin) {
    const pad = Math.max(1, Math.abs(yMax) * 0.1)
    yMax += pad
    yMin -= pad
  }
  return { yMin, yMax }
}


