import { describe, expect, it } from "vitest";
import { consumeCompletedLines } from "../useBluetooth";

describe("consumeCompletedLines", () => {
  it("splits complete lines and preserves trailing partial data", () => {
    const result = consumeCompletedLines("first\nsecond\nthird");

    expect(result.lines).toEqual(["first", "second"]);
    expect(result.remainder).toBe("third");
  });

  it("drops the trailing carriage return and keeps incomplete line buffered", () => {
    const result = consumeCompletedLines("alpha\r\nbeta\r\npartial");

    expect(result.lines).toEqual(["alpha", "beta"]);
    expect(result.remainder).toBe("partial");
  });
});
