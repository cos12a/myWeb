import type { PlotSeries } from "../types/plot";

export interface ViewPortData {
  series: PlotSeries[];
  getSeriesData: (id: number) => Float32Array;
  yMin: number;
  yMax: number;
  getTimes: () => Float64Array;
  viewPortCursor: number;
  viewPortSize: number;
  firstTimestamp: number | null;
}

/**
 * RingStore maintains fixed-capacity series buffers and timestamps in a ring.
 * - append(values) writes one sample across all series, records Date.now() to times
 */
export class RingStore {
  // Series data
  series: PlotSeries[] = [];
  // The buffers for each series - these are the raw data
  buffers: Float32Array[] = [];
  // The timestamps for each sample - these are the timestamps of each sample
  times: Float64Array = new Float64Array(0);
  // The capacity of the ring buffer - this is the number of samples that can be stored
  capacity: number = 100000;
  // The index of the next sample to be written - this is the index of the next sample to be written
  writeIndex: number = 0;
  // The cursor position of the viewport - this is the index of the rightmost displayed sample
  viewPortCursor: number = 0;
  // The size of the viewport - this is the number of samples displayed to the left of the cursor
  viewPortSize: number = 2000;
  // Whether the viewport is frozen - if true, the viewport will not move when new data is appended
  frozen: boolean = false;
  // Incremental min/max tracking
  globalMin: number = Number.POSITIVE_INFINITY;
  globalMax: number = Number.NEGATIVE_INFINITY;
  // Track the first timestamp ever received for relative time calculations
  firstTimestamp: number | null = null;
  // The maximum allowed viewport size (UI-configurable)
  private maxViewPortSize: number = 2000;

  private listeners = new Set<() => void>();
  private version = 0;

  constructor(capacity = 100000, viewPortSize = 200) {
    this.reset(capacity, viewPortSize, []);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  getVersion() {
    return this.version;
  }

  private invalidateViewPortCache() {
    this.cachedViewPortData = null;
  }

  setSeries(names: string[]) {
    // TODO - ideally should keep any existing data and just update the series names/add new ones
    this.reset(this.capacity, this.viewPortSize, names);
  }

  getSeries() {
    return this.series;
  }

  reset(capacity = 100000, viewPortSize = 200, seriesNames: string[]) {
    // construct with a set of series
    this.series = new Array(seriesNames.length).fill(0).map((_, i) => ({
      id: i,
      name: seriesNames[i],
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      visible: true,
    }));
    // create the buffers for storing the series data - these should be filled with NaN
    this.buffers = new Array(seriesNames.length)
      .fill(0)
      .map(() => new Float32Array(capacity).fill(NaN));
    // create the timestamps for each sample - these should be filled with NaN
    this.times = new Float64Array(capacity).fill(NaN);
    // set the capacity
    this.capacity = capacity;
    // set the write index to 0
    this.writeIndex = 0;
    // set the view port cursor to 0
    this.viewPortCursor = 0;
    // clamp max viewport size to capacity
    this.maxViewPortSize = Math.max(
      10,
      Math.min(this.maxViewPortSize, capacity),
    );
    // set the view port size (clamped)
    this.viewPortSize = Math.max(
      10,
      Math.min(viewPortSize, Math.min(capacity, this.maxViewPortSize)),
    );
    // set the frozen state to false
    this.frozen = false;
    // Incremental min/max tracking
    this.globalMin = Number.POSITIVE_INFINITY;
    this.globalMax = Number.NEGATIVE_INFINITY;
    // Reset first timestamp
    this.firstTimestamp = null;
    this.invalidateViewPortCache();
    this.emit();
  }

  setCapacity(capacity: number) {
    // nothing to do if the capacity is the same
    if (capacity === this.capacity) return;
    // create the new buffers making sure that they are filled with NaN
    const newBuffers = this.buffers.map(() =>
      new Float32Array(capacity).fill(NaN),
    );
    const newTimes = new Float64Array(capacity).fill(NaN);
    // Determine how many samples we currently retain and how many we can keep
    const retainedCount = Math.min(this.writeIndex, this.capacity);
    const keepCount = Math.min(retainedCount, capacity);

    // Copy the latest keepCount samples into the front of the new buffers in order
    const srcStartTotalIndex = this.writeIndex - keepCount;
    for (let j = 0; j < keepCount; j++) {
      const srcTotalIndex = srcStartTotalIndex + j;
      const srcRingIndex =
        ((srcTotalIndex % this.capacity) + this.capacity) % this.capacity;
      for (let s = 0; s < this.series.length; s++) {
        newBuffers[s][j] = this.buffers[s][srcRingIndex];
      }
      newTimes[j] = this.times[srcRingIndex];
    }

    // Swap in new storage and update capacity/write index
    this.buffers = newBuffers;
    this.times = newTimes;
    this.capacity = capacity;
    this.writeIndex = keepCount;
    this.invalidateViewPortCache(); // capacity/writeIndex changed

    // Recompute global min/max on the resized buffers
    this.recomputeGlobalMinMax();

    // Revalidate viewport constraints after capacity change
    // Clamp max viewport and viewport size (respect max and capacity); then ensure cursor remains valid
    this.maxViewPortSize = Math.max(
      10,
      Math.min(this.maxViewPortSize, this.capacity),
    );
    this.viewPortSize = Math.min(
      this.viewPortSize,
      Math.min(this.capacity, this.maxViewPortSize),
    );
    // If not frozen, follow the latest sample; otherwise clamp within range
    if (!this.frozen) {
      this.setViewPortCursor(this.writeIndex - 1);
    } else {
      this.setViewPortCursor(this.viewPortCursor);
    }
  }

  getCapacity() {
    return this.capacity;
  }

  append(values: number[]) {
    if (values.length === 0) return;

    // Auto-adjust series count if needed
    if (values.length !== this.buffers.length) {
      this.adjustSeriesCount(values.length);
    }

    // Append values - handle case where we have fewer values than series
    const numValuesToWrite = Math.min(values.length, this.buffers.length);
    for (let i = 0; i < numValuesToWrite; i++) {
      const value = values[i];
      this.buffers[i][this.writeIndex % this.capacity] = value;
      // Update global min/max incrementally
      if (Number.isFinite(value)) {
        if (value < this.globalMin) this.globalMin = value;
        if (value > this.globalMax) this.globalMax = value;
      }
    }

    // Fill remaining series with NaN if we have fewer values than series
    for (let i = numValuesToWrite; i < this.buffers.length; i++) {
      this.buffers[i][this.writeIndex % this.capacity] = NaN;
    }
    const now = Date.now();
    this.times[this.writeIndex % this.capacity] = now;

    // Capture first timestamp ever received
    if (this.firstTimestamp === null) {
      this.firstTimestamp = now;
    }
    this.writeIndex++;
    // if we're not frozen the view port cursor tracks the latest write index
    if (!this.frozen) {
      this.viewPortCursor = this.writeIndex - 1;
    }
    this.invalidateViewPortCache(); // writeIndex changed, possibly viewPortCursor too
    this.emit();
  }

  /** Dynamically adjust the number of series to match incoming data */
  private adjustSeriesCount(newCount: number) {
    if (newCount === this.series.length) return;

    const oldCount = this.series.length;

    if (newCount > oldCount) {
      // Add new series
      for (let i = oldCount; i < newCount; i++) {
        const newSeries: PlotSeries = {
          id: i,
          name: `S${i + 1}`,
          color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          visible: true,
        };
        this.series.push(newSeries);

        // Create new buffer filled with NaN
        const newBuffer = new Float32Array(this.capacity).fill(NaN);
        this.buffers.push(newBuffer);
      }
    } else {
      // Remove excess series
      this.series = this.series.slice(0, newCount);
      this.buffers = this.buffers.slice(0, newCount);
    }

    this.invalidateViewPortCache();
  }

  /** Recompute global min/max across all retained data. */
  private recomputeGlobalMinMax() {
    this.globalMin = Number.POSITIVE_INFINITY;
    this.globalMax = Number.NEGATIVE_INFINITY;

    for (let s = 0; s < this.series.length; s++) {
      const buffer = this.buffers[s];
      for (let i = 0; i < this.capacity; i++) {
        const value = buffer[i];
        if (Number.isFinite(value)) {
          if (value < this.globalMin) this.globalMin = value;
          if (value > this.globalMax) this.globalMax = value;
        }
      }
    }
  }

  getViewPortData() {
    // Check if we can use cached data
    const currentKey = {
      writeIndex: this.writeIndex,
      viewPortCursor: this.viewPortCursor,
      viewPortSize: this.viewPortSize,
      frozen: this.frozen,
    };

    if (
      this.cachedViewPortData !== null &&
      this.cacheKey.writeIndex === currentKey.writeIndex &&
      this.cacheKey.viewPortCursor === currentKey.viewPortCursor &&
      this.cacheKey.viewPortSize === currentKey.viewPortSize &&
      this.cacheKey.frozen === currentKey.frozen
    ) {
      return this.cachedViewPortData;
    }

    // Cache miss - compute viewport data
    this.cacheKey = currentKey;

    // the view port size should never exceed the capacity or the global max
    const viewPortSize = Math.min(
      this.viewPortSize,
      Math.min(this.capacity, this.maxViewPortSize),
    );
    // this is the rightmost index of the view port
    const endPosition = this.viewPortCursor;
    // inclusive start and end positions
    const startPosition = endPosition - (viewPortSize - 1);

    const seriesViews: Float32Array[] = [];
    let timesView: Float64Array;

    if (startPosition > endPosition) {
      // Handle zero-length window case
      for (let k = 0; k < this.buffers.length; k++) {
        seriesViews[k] = new Float32Array(0);
      }
      timesView = new Float64Array(0);
    } else {
      const length = endPosition - startPosition + 1;
      // Initialize arrays with NaN
      for (let k = 0; k < this.series.length; k++) {
        seriesViews[k] = new Float32Array(length).fill(NaN);
      }
      timesView = new Float64Array(length).fill(NaN);

      // Copy valid samples one by one, checking if they exist
      for (let i = 0; i < length; i++) {
        const sampleIndex = startPosition + i;
        // Only copy if this sample index has been written and hasn't been overwritten
        if (
          sampleIndex >= 0 &&
          sampleIndex < this.writeIndex &&
          (this.writeIndex <= this.capacity ||
            sampleIndex >= this.writeIndex - this.capacity)
        ) {
          const ringIndex = sampleIndex % this.capacity;
          for (let k = 0; k < this.series.length; k++) {
            seriesViews[k][i] = this.buffers[k][ringIndex];
          }
          timesView[i] = this.times[ringIndex];
        }
        // If sample doesn't exist or was overwritten, leave as NaN (already initialized)
      }
    }

    // Compute y-range from the current viewport window (only for visible series)
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < seriesViews.length; k++) {
      // Skip hidden series
      if (!this.series[k]?.visible) continue;

      const arr = seriesViews[k];
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (Number.isFinite(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -1;
      yMax = 1;
    } else if (yMax === yMin) {
      const pad = Math.max(1, Math.abs(yMax) * 0.1);
      yMax += pad;
      yMin -= pad;
    }

    const result: ViewPortData = {
      series: this.series,
      getSeriesData: (id: number) => seriesViews[id] ?? new Float32Array(0),
      yMin,
      yMax,
      getTimes: () => timesView,
      viewPortCursor: this.viewPortCursor,
      viewPortSize: this.viewPortSize,
      firstTimestamp: this.firstTimestamp,
    };

    // Cache the result for future calls
    this.cachedViewPortData = result;
    return result;
  }

  // Viewport state management
  setViewPortSize(size: number): number {
    // cannot have a window size that is greater than the capacity or the global max
    this.viewPortSize = Math.min(
      size,
      Math.min(this.capacity, this.maxViewPortSize),
    );
    // cannot have a window size that is less than 10
    this.viewPortSize = Math.max(10, this.viewPortSize);
    this.invalidateViewPortCache(); // viewPortSize changed
    this.emit();
    return this.viewPortSize;
  }

  getViewPortSize(): number {
    return this.viewPortSize;
  }

  setViewPortCursor(position: number): number {
    // cannot have a view port cursor that is less than 0
    const rounded = Math.round(position);
    const maxCursor = Math.max(0, this.writeIndex - 1);
    this.viewPortCursor = Math.min(Math.max(0, rounded), maxCursor);
    this.invalidateViewPortCache(); // viewPortCursor changed
    this.emit();
    return this.viewPortCursor;
  }

  getViewPortCursor(): number {
    return this.viewPortCursor;
  }

  adjustViewPortCursor(delta: number): number {
    return this.setViewPortCursor(this.viewPortCursor + delta);
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    if (!frozen) {
      // not frozen - set the view port cursor to the latest write index
      this.setViewPortCursor(this.writeIndex - 1); // This calls invalidateViewPortCache() internally
    } else {
      this.invalidateViewPortCache(); // frozen state changed
      this.emit();
    }
  }

  getFrozen(): boolean {
    return this.frozen;
  }

  // Zoom controls
  zoomByFactor(factor: number): void {
    const currentLen = this.viewPortSize;
    // cannot have a zoom factor that is less than 0.5 or more than 2
    const clampedFactor = Math.max(0.5, Math.min(2, factor));
    // this is what we're aiming for
    const desired = Math.round(currentLen / clampedFactor);
    // cannot have a window size that is less than 10 or more than the capacity or max
    const newWindowSize = Math.max(
      10,
      Math.min(Math.min(this.capacity, this.maxViewPortSize), desired),
    );
    // Update window size and anchors
    this.setViewPortSize(newWindowSize);
  }

  // Max viewport size controls
  setMaxViewPortSize(maxSize: number): number {
    const clamped = Math.max(10, Math.floor(maxSize));
    const newMax = Math.min(clamped, this.capacity);
    if (newMax !== this.maxViewPortSize) {
      this.maxViewPortSize = newMax;
      // Ensure current viewport respects the new maximum
      if (this.viewPortSize > this.maxViewPortSize) {
        this.viewPortSize = this.maxViewPortSize;
      }
      this.invalidateViewPortCache();
      this.emit();
    }
    return this.maxViewPortSize;
  }

  getMaxViewPortSize(): number {
    return this.maxViewPortSize;
  }

  handleWheel(event: { deltaY: number; clientX: number }): void {
    const clampedDelta =
      Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 1000);
    const factor = Math.exp(clampedDelta * 0.001);
    this.zoomByFactor(factor);
  }

  // Momentum scrolling support
  private momentumState: { animationId: number | null } = { animationId: null };

  // Cached viewport data to avoid regenerating on every render
  private cachedViewPortData: ViewPortData | null = null;
  private cacheKey = {
    writeIndex: -1,
    viewPortCursor: -1,
    viewPortSize: -1,
    frozen: false,
  };

  startMomentum(velocity: number): void {
    this.stopMomentum();

    if (!Number.isFinite(velocity) || Math.abs(velocity) < 0.005) return;

    let currentVelocity = velocity;
    let lastTimestamp = performance.now();

    const step = (ts: number) => {
      const dt = Math.max(1, ts - lastTimestamp);
      lastTimestamp = ts;

      // Exponential decay friction (~0.95 per 16.7ms) - same as old implementation
      currentVelocity *= Math.pow(0.95, dt / 16.7);

      if (Math.abs(currentVelocity) < 0.005) {
        this.stopMomentum();
        return;
      }

      // Apply velocity scaled by time - same as old implementation
      const movement = currentVelocity * dt;
      this.adjustViewPortCursor(movement);
      this.momentumState.animationId = requestAnimationFrame(step);
    };

    this.momentumState.animationId = requestAnimationFrame(step);
  }

  stopMomentum(): void {
    if (this.momentumState.animationId !== null) {
      cancelAnimationFrame(this.momentumState.animationId);
      this.momentumState.animationId = null;
    }
  }

  renameSeries(id: number, name: string) {
    const target = this.series.find((m) => m.id === id);
    if (!target) return;
    target.name = name;
    this.emit();
  }

  setSeriesColor(id: number, color: string) {
    const target = this.series.find((m) => m.id === id);
    if (!target) return;
    target.color = color;
    this.emit();
  }

  toggleSeriesVisibility(id: number) {
    const target = this.series.find((m) => m.id === id);
    if (!target) return;
    target.visible = !target.visible;
    this.invalidateViewPortCache(); // visibility affects y-axis range calculation
    this.emit();
  }
}

const DEFAULT_COLORS = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#f87171",
  "#22d3ee",
  "#84cc16",
];
