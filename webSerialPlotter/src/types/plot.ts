/** Describes a plotted series' identity and color. */
export interface PlotSeries {
  id: number
  name: string
  color: string
  visible: boolean
}

/**
 * Windowed snapshot used by the canvas renderer.
 * - getSeriesData(id) returns a contiguous Float32Array for the visible window.
 * - getTimes() returns a contiguous Float64Array of timestamps for the same window.
 * - length is the window length (number of samples visible).
 * - windowStartTotal is the absolute sample index (from boot) of the first visible sample.
 * - anchors are precomputed sample-aligned ticks created at append-time; filtered to the window.
 */
export interface PlotSnapshot {
  series: PlotSeries[]
  getSeriesData: (seriesId: number) => Float32Array
  yMin: number
  yMax: number
  getTimes: () => Float64Array
  // these are used to hint that a redraw is needed
  viewPortCursor: number
  viewPortSize: number
}


