import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RingStore } from "../RingStore";

describe("RingStore", () => {
  let store: RingStore;

  beforeEach(() => {
    store = new RingStore(100, 10); // Small capacity for easier testing
  });

  describe("Construction and Initialization", () => {
    it("should initialize with default parameters", () => {
      const defaultStore = new RingStore();
      expect(defaultStore.getCapacity()).toBe(100000);
      expect(defaultStore.getViewPortSize()).toBe(200);
      expect(defaultStore.getSeries()).toHaveLength(0);
    });

    it("should initialize with custom parameters", () => {
      expect(store.getCapacity()).toBe(100);
      expect(store.getViewPortSize()).toBe(10);
      expect(store.getSeries()).toHaveLength(0);
    });

    it("should have writeIndex and viewPortCursor at 0", () => {
      expect(store.writeIndex).toBe(0);
      expect(store.getViewPortCursor()).toBe(0);
    });

    it("should not be frozen initially", () => {
      expect(store.getFrozen()).toBe(false);
    });
  });

  describe("Series Management", () => {
    it("should create series with correct IDs and default colors", () => {
      // Create 3 series by appending data
      store.append([1, 2, 3]);
      const series = store.getSeries();
      expect(series[0]).toEqual({
        id: 0,
        name: "S1",
        color: "#60a5fa",
        visible: true,
      });
      expect(series[1]).toEqual({
        id: 1,
        name: "S2",
        color: "#f472b6",
        visible: true,
      });
      expect(series[2]).toEqual({
        id: 2,
        name: "S3",
        color: "#34d399",
        visible: true,
      });
    });

    it("should set new series", () => {
      store.setSeries(["Temperature", "Humidity"]);
      const series = store.getSeries();
      expect(series).toHaveLength(2);
      expect(series[0].name).toBe("Temperature");
      expect(series[1].name).toBe("Humidity");
    });

    it("should rename series", () => {
      store.append([1, 2, 3]); // Create series first
      store.renameSeries(0, "NewName");
      expect(store.getSeries()[0].name).toBe("NewName");
    });

    it("should set series color", () => {
      store.append([1, 2, 3]); // Create series first
      store.setSeriesColor(0, "#ff0000");
      expect(store.getSeries()[0].color).toBe("#ff0000");
    });

    it("should handle invalid series ID for rename", () => {
      store.append([1, 2, 3]); // Create series first
      const originalName = store.getSeries()[0].name;
      store.renameSeries(999, "InvalidID");
      expect(store.getSeries()[0].name).toBe(originalName);
    });

    it("should toggle series visibility", () => {
      store.append([1, 2, 3]); // Create series first
      expect(store.getSeries()[0].visible).toBe(true);
      store.toggleSeriesVisibility(0);
      expect(store.getSeries()[0].visible).toBe(false);
      store.toggleSeriesVisibility(0);
      expect(store.getSeries()[0].visible).toBe(true);
    });

    it("should handle invalid series ID for toggle visibility", () => {
      store.append([1, 2, 3]); // Create series first
      const originalVisibility = store.getSeries()[0].visible;
      store.toggleSeriesVisibility(999);
      expect(store.getSeries()[0].visible).toBe(originalVisibility);
    });
  });

  describe("Data Appending", () => {
    it("should append valid data", () => {
      store.append([1.0, 2.0, 3.0]);
      expect(store.writeIndex).toBe(1);
      expect(store.getViewPortCursor()).toBe(0);
    });

    it("should create series to match data length", () => {
      // Initially has 0 series, append 2 values
      expect(store.getSeries()).toHaveLength(0);
      store.append([1.0, 2.0]);

      // Should create 2 series and accept the data
      expect(store.getSeries()).toHaveLength(2);
      expect(store.writeIndex).toBe(1);

      const data = store.getViewPortData();
      expect(data.getSeriesData(0)[data.getSeriesData(0).length - 1]).toBe(1.0);
      expect(data.getSeriesData(1)[data.getSeriesData(1).length - 1]).toBe(2.0);
    });

    it("should update global min/max on append", () => {
      store.append([1.0, 10.0, 5.0]);
      expect(store.globalMin).toBe(1.0);
      expect(store.globalMax).toBe(10.0);

      store.append([-5.0, 15.0, 0.0]);
      expect(store.globalMin).toBe(-5.0);
      expect(store.globalMax).toBe(15.0);
    });

    it("should handle NaN values in min/max tracking", () => {
      store.append([NaN, 5.0, NaN]);
      expect(store.globalMin).toBe(5.0);
      expect(store.globalMax).toBe(5.0);
    });

    it("should handle infinite values in min/max tracking", () => {
      store.append([Infinity, 5.0, -Infinity]);
      expect(store.globalMin).toBe(5.0);
      expect(store.globalMax).toBe(5.0);
    });

    it("should update viewPortCursor when not frozen", () => {
      store.append([1, 2, 3]);
      expect(store.getViewPortCursor()).toBe(0);
      store.append([4, 5, 6]);
      expect(store.getViewPortCursor()).toBe(1);
    });

    it("should not update viewPortCursor when frozen", () => {
      store.setFrozen(true);
      store.append([1, 2, 3]);
      expect(store.getViewPortCursor()).toBe(0);
      store.append([4, 5, 6]);
      expect(store.getViewPortCursor()).toBe(0);
    });
  });

  describe("Ring Buffer Wrapping", () => {
    beforeEach(() => {
      // Fill buffer to capacity and beyond
      for (let i = 0; i < 105; i++) {
        store.append([i * 10, i * 20, i * 30]);
      }
    });

    it("should wrap around when capacity is exceeded", () => {
      expect(store.writeIndex).toBe(105);
      expect(store.writeIndex % store.getCapacity()).toBe(5);
    });

    it("should overwrite oldest data when wrapping", () => {
      // The first 5 samples (0-4) should be overwritten by samples 100-104
      // Should have latest 10 samples (writeIndex - 1 is 104, so cursor should be at 104)
      expect(store.getViewPortCursor()).toBe(104);
    });

    it("should maintain correct min/max after wrapping", () => {
      // writeIndex is 105, cursor should be 104 (latest), viewport size is 10
      // So we should get samples 95-104
      // For series 0: values 95*10=950 to 104*10=1040
      // For series 2: values 95*30=2850 to 104*30=3120
      const viewPortData = store.getViewPortData();
      expect(viewPortData.yMin).toBe(950);
      expect(viewPortData.yMax).toBe(3120); // From series 2: 104 * 30
    });
  });

  describe("Viewport Management", () => {
    beforeEach(() => {
      // Add some test data
      for (let i = 0; i < 20; i++) {
        store.append([i, i * 2, i * 3]);
      }
    });

    it("should set viewport size within bounds", () => {
      expect(store.setViewPortSize(15)).toBe(15);
      expect(store.getViewPortSize()).toBe(15);
    });

    it("should clamp viewport size to capacity", () => {
      expect(store.setViewPortSize(150)).toBe(100); // Clamped to capacity
      expect(store.getViewPortSize()).toBe(100);
    });

    it("should enforce minimum viewport size", () => {
      expect(store.setViewPortSize(5)).toBe(10); // Clamped to minimum
      expect(store.getViewPortSize()).toBe(10);
    });

    it("should set viewport cursor within bounds", () => {
      expect(store.setViewPortCursor(15)).toBe(15);
      expect(store.getViewPortCursor()).toBe(15);
    });

    it("should clamp cursor to valid range", () => {
      expect(store.setViewPortCursor(-5)).toBe(0);
      expect(store.setViewPortCursor(1000)).toBe(19); // writeIndex - 1
    });

    it("should adjust cursor by delta", () => {
      store.setViewPortCursor(10);
      expect(store.adjustViewPortCursor(5)).toBe(15);
      expect(store.adjustViewPortCursor(-20)).toBe(0); // Clamped
    });

    it("should round cursor position", () => {
      expect(store.setViewPortCursor(10.7)).toBe(11);
      expect(store.setViewPortCursor(10.3)).toBe(10);
    });
  });

  describe("Freeze/Unfreeze Behavior", () => {
    beforeEach(() => {
      for (let i = 0; i < 10; i++) {
        store.append([i, i * 2, i * 3]);
      }
    });

    it("should freeze viewport at current position", () => {
      store.setViewPortCursor(5);
      store.setFrozen(true);

      store.append([100, 200, 300]);
      expect(store.getViewPortCursor()).toBe(5); // Should not move
    });

    it("should unfreeze and jump to latest", () => {
      store.setViewPortCursor(5);
      store.setFrozen(true);
      store.append([100, 200, 300]);

      store.setFrozen(false);
      expect(store.getViewPortCursor()).toBe(10); // Should jump to latest
    });
  });

  describe("Viewport Data Extraction", () => {
    beforeEach(() => {
      for (let i = 0; i < 15; i++) {
        store.append([i, i * 10, i * 100]);
      }
      store.setViewPortSize(10); // Gets clamped to minimum 10
      store.setViewPortCursor(10);
    });

    it("should extract correct viewport data", () => {
      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);
      const series1 = data.getSeriesData(1);
      const times = data.getTimes();

      expect(series0.length).toBe(10);
      expect(series1.length).toBe(10);
      expect(times.length).toBe(10);

      // Cursor at 10, size 10, so we should get samples 1-10
      expect(Array.from(series0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(Array.from(series1)).toEqual([
        10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
      ]);
    });

    it("should calculate correct y-range from viewport", () => {
      const data = store.getViewPortData();
      expect(data.yMin).toBe(1); // Min from samples 1-10 across all series
      expect(data.yMax).toBe(1000); // Max from samples 1-10 across all series (10 * 100)
    });

    it("should handle viewport at start of data", () => {
      store.setViewPortCursor(2);
      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);

      // Cursor at 2, size 10, so we get samples -7 to 2
      // But samples -7 through -1 should be NaN, and we get 0,1,2 as valid data
      expect(series0.length).toBe(10);
      for (let i = 0; i < 7; i++) {
        expect(isNaN(series0[i])).toBe(true);
      }
      expect(series0[7]).toBe(0);
      expect(series0[8]).toBe(1);
      expect(series0[9]).toBe(2);
    });

    it("should handle viewport with mostly NaN data", () => {
      // Since cursor gets clamped to 0, and we have size 10, we get samples -9 to 0
      // Only sample 0 is valid data, rest should be NaN
      store.setViewPortCursor(0);
      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);
      expect(series0.length).toBe(10);
      for (let i = 0; i < 9; i++) {
        expect(isNaN(series0[i])).toBe(true);
      }
      expect(series0[9]).toBe(0); // Only the last sample should be valid
    });

    it("should handle y-range edge cases", () => {
      const emptyStore = new RingStore(10, 15); // Size gets clamped to 10
      const data = emptyStore.getViewPortData();
      expect(data.yMin).toBe(-1);
      expect(data.yMax).toBe(1);
    });

    it("should handle single value y-range", () => {
      const singleValueStore = new RingStore(10, 15); // Gets clamped to 10 minimum
      singleValueStore.append([5, 5, 5]);
      const data = singleValueStore.getViewPortData();
      // With single value 5, padding is Math.max(1, |5| * 0.1) = Math.max(1, 0.5) = 1
      expect(data.yMin).toBe(4); // 5 - 1
      expect(data.yMax).toBe(6); // 5 + 1
    });

    it("should clear data immediately when reset is called", () => {
      const clearStore = new RingStore(100, 10);
      clearStore.append([1, 2, 3]);
      expect(clearStore.writeIndex).toBe(1);

      clearStore.reset(clearStore.getCapacity(), clearStore.getViewPortSize(), [
        "S1",
        "S2",
        "S3",
      ]);

      expect(clearStore.writeIndex).toBe(0);
      expect(
        clearStore.getViewPortData().getSeriesData(0).every(Number.isNaN),
      ).toBe(true);
    });
  });

  describe("Capacity Management", () => {
    beforeEach(() => {
      // Fill with 20 samples
      for (let i = 0; i < 20; i++) {
        store.append([i, i * 10, i * 100]);
      }
    });

    it("should handle capacity increase", () => {
      store.setCapacity(200);
      expect(store.getCapacity()).toBe(200);
      expect(store.writeIndex).toBe(20); // Should preserve writeIndex

      // Should preserve all data
      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);
      expect(series0[series0.length - 1]).toBe(19); // Latest value should be preserved
    });

    it("should handle capacity decrease with data preservation", () => {
      store.setCapacity(10);
      expect(store.getCapacity()).toBe(10);
      expect(store.writeIndex).toBe(10); // Should be adjusted

      // Should preserve latest 10 samples (10-19)
      store.setViewPortSize(10);
      store.setViewPortCursor(9); // Latest available
      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);

      expect(Array.from(series0)).toEqual([
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      ]);
    });

    it("should recompute global min/max after capacity change", () => {
      store.setCapacity(10); // Keep only latest 10 samples

      // Min/max should be recalculated for remaining data
      expect(store.globalMin).toBeGreaterThanOrEqual(10); // From latest samples
      expect(store.globalMax).toBe(1900); // 19 * 100
    });

    it("should adjust viewport constraints after capacity change", () => {
      store.setViewPortSize(50); // Larger than new capacity
      store.setCapacity(30);

      expect(store.getViewPortSize()).toBe(30); // Clamped to new capacity
    });

    it("should handle no-op capacity change", () => {
      const originalWriteIndex = store.writeIndex;
      store.setCapacity(100); // Same as current
      expect(store.writeIndex).toBe(originalWriteIndex);
    });
  });

  describe("Ring Buffer Coordinate Handling", () => {
    beforeEach(() => {
      // Create a scenario where we have wrapped around
      for (let i = 0; i < 105; i++) {
        store.append([i, i * 10, i * 100]);
      }
      // Now writeIndex = 105, ring positions 0-4 contain samples 100-104
      // ring positions 5-99 contain samples 5-99
    });

    it("should handle viewport that spans ring wrap", () => {
      store.setViewPortSize(10);
      store.setViewPortCursor(99); // Ensure we're within valid range (writeIndex-1 = 104)

      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);

      // Cursor at 99, size 10, so we get samples 90-99
      expect(Array.from(series0)).toEqual([
        90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
      ]);
    });

    it("should handle viewport near start after wrapping", () => {
      // After wrapping (105 samples), we have:
      // - Ring positions 0-4 contain samples 100-104 (overwritten the original 0-4)
      // - Ring positions 5-99 contain samples 5-99 (unchanged)
      // When we ask for viewport at cursor 10, size 10, we get samples 1-10
      // But samples 1-4 were overwritten by 101-104
      store.setViewPortCursor(10);
      store.setViewPortSize(10);

      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);

      // Should get samples 1-10, but 1-4 are now overwritten/unavailable due to wrapping
      expect(series0.length).toBe(10);
      // Check that first 4 values are NaN (overwritten samples)
      expect(isNaN(series0[0])).toBe(true);
      expect(isNaN(series0[1])).toBe(true);
      expect(isNaN(series0[2])).toBe(true);
      expect(isNaN(series0[3])).toBe(true);
      // Check that remaining values are correct (samples 5-10)
      expect(Array.from(series0.slice(4))).toEqual([5, 6, 7, 8, 9, 10]);
    });
  });

  describe("Zoom Controls", () => {
    beforeEach(() => {
      for (let i = 0; i < 50; i++) {
        store.append([i, i * 2, i * 3]);
      }
      store.setViewPortSize(20);
    });

    it("should zoom by valid factor", () => {
      store.zoomByFactor(2.0); // Zoom in
      expect(store.getViewPortSize()).toBe(10);

      store.zoomByFactor(0.5); // Zoom out
      expect(store.getViewPortSize()).toBe(20);
    });

    it("should clamp zoom factor", () => {
      store.zoomByFactor(5.0); // Too big, should be clamped to 2.0
      expect(store.getViewPortSize()).toBe(10);

      store.setViewPortSize(20);
      store.zoomByFactor(0.1); // Too small, should be clamped to 0.5
      expect(store.getViewPortSize()).toBe(40);
    });

    it("should respect capacity limits when zooming", () => {
      store.setViewPortSize(80);
      store.zoomByFactor(0.5); // Would make 160, but capacity is 100
      expect(store.getViewPortSize()).toBe(100);
    });

    it("should respect minimum size when zooming", () => {
      store.setViewPortSize(20);
      store.zoomByFactor(5.0); // Would make 4, but minimum is 10
      expect(store.getViewPortSize()).toBe(10);
    });

    it("should handle wheel zoom", () => {
      const initialSize = store.getViewPortSize();
      store.handleWheel({ deltaY: 100, clientX: 0 }); // Positive deltaY zooms IN (smaller size)
      expect(store.getViewPortSize()).toBeLessThan(initialSize);

      store.setViewPortSize(initialSize); // Reset
      store.handleWheel({ deltaY: -100, clientX: 0 }); // Negative deltaY zooms OUT (bigger size)
      expect(store.getViewPortSize()).toBeGreaterThan(initialSize);
    });

    it("should clamp wheel delta", () => {
      const initialSize = store.getViewPortSize();
      store.handleWheel({ deltaY: 10000, clientX: 0 }); // Very large delta should zoom IN heavily
      // Should still work, just clamped to maximum delta of 1000
      expect(store.getViewPortSize()).toBeLessThan(initialSize);
    });
  });

  describe("Event Subscription", () => {
    it("should subscribe and unsubscribe listeners", () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      store.append([1, 2, 3]);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      store.append([4, 5, 6]);
      expect(listener).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it("should emit on various operations", () => {
      const listener = vi.fn();
      store.subscribe(listener);

      store.setSeries(["A", "B"]);
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      store.setViewPortSize(50);
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      store.setViewPortCursor(10);
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      store.setFrozen(true);
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("Momentum Scrolling", () => {
    beforeEach(() => {
      for (let i = 0; i < 50; i++) {
        store.append([i, i * 2, i * 3]);
      }
      // TODO: Fix timer mocking for vitest 3.x
      // vi.useFakeTimers()

      // Mock requestAnimationFrame to execute callback synchronously for testing
      let rafId = 0;
      const rafCallbacks = new Map<number, () => void>();

      globalThis.requestAnimationFrame = vi.fn((cb) => {
        rafId++;
        const id = rafId;
        rafCallbacks.set(id, cb);
        // Execute synchronously for deterministic testing
        setTimeout(() => {
          if (rafCallbacks.has(id)) {
            rafCallbacks.delete(id);
            cb();
          }
        }, 0);
        return id;
      });

      globalThis.cancelAnimationFrame = vi.fn((id) => {
        rafCallbacks.delete(id);
      });
      // Mock only the methods we need
      Object.defineProperty(globalThis, "performance", {
        value: { now: vi.fn(() => Date.now()) },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // TODO: Fix timer mocking for vitest 3.x
      // vi.useRealTimers()

      // Stop momentum FIRST to cancel any pending animations
      store.stopMomentum();

      // Give a moment for any pending timers to clear
      return new Promise((resolve) => {
        setTimeout(() => {
          // Clean up mocked globals
          const global = globalThis as Record<string, unknown>;
          delete global.requestAnimationFrame;
          delete global.cancelAnimationFrame;
          delete global.performance;
          resolve(undefined);
        }, 100);
      });
    });

    it("should start momentum with valid velocity", () => {
      store.startMomentum(5.0);
      // Can't access private momentumState, but we can test that stopMomentum works
      store.stopMomentum(); // Should not throw
    });

    it("should ignore invalid velocity", () => {
      const initialCursor = store.getViewPortCursor();
      store.startMomentum(NaN);
      expect(store.getViewPortCursor()).toBe(initialCursor);

      store.startMomentum(0.001); // Below threshold
      expect(store.getViewPortCursor()).toBe(initialCursor);
    });

    it("should stop momentum", () => {
      store.startMomentum(5.0);
      store.stopMomentum(); // Should not throw
    });

    it("should not start momentum for very small velocity", () => {
      const initialCursor = store.getViewPortCursor();
      store.startMomentum(0.001); // Below threshold
      expect(store.getViewPortCursor()).toBe(initialCursor);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty data gracefully", () => {
      const data = store.getViewPortData();
      // With no series, should return empty data
      expect(data.getSeriesData(0).length).toBe(0);
      expect(data.yMin).toBe(-1);
      expect(data.yMax).toBe(1);
    });

    it("should handle invalid series ID in getSeriesData", () => {
      store.append([1, 2, 3]);
      const data = store.getViewPortData();
      expect(data.getSeriesData(999).length).toBe(0);
    });

    it("should handle cursor beyond available data", () => {
      store.append([1, 2, 3]);
      store.setViewPortCursor(1000);
      expect(store.getViewPortCursor()).toBe(0); // Clamped to writeIndex - 1
    });

    it("should handle viewport size larger than available data", () => {
      store.append([1, 2, 3]);
      store.append([4, 5, 6]);
      store.setViewPortSize(50);

      const data = store.getViewPortData();
      const series0 = data.getSeriesData(0);

      // Should return padded data with NaNs
      expect(series0.length).toBe(50);
      expect(series0[48]).toBe(1);
      expect(series0[49]).toBe(4);
    });

    it("should preserve data integrity across multiple operations", () => {
      // Add initial data
      for (let i = 0; i < 30; i++) {
        store.append([i, i * 2, i * 3]);
      }

      // Change capacity
      store.setCapacity(20);

      // Change series
      store.setSeries(["X", "Y"]);
      expect(store.getSeries()).toHaveLength(2);

      // The data should be reset when series change
      expect(store.writeIndex).toBe(0);
    });
  });
});
