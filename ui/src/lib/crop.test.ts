import { describe, expect, it } from "vitest";
import { DEFAULT_CROP, MAX_ZOOM, MIN_ZOOM, panBy, zoomBy } from "./crop";

describe("zoomBy", () => {
  it("never goes below the neutral zoom", () => {
    expect(zoomBy(1, 500)).toBe(MIN_ZOOM);
  });
  it("never exceeds the maximum zoom", () => {
    expect(zoomBy(7, -5000)).toBe(MAX_ZOOM);
  });
  it("is monotonic in the wheel delta", () => {
    expect(zoomBy(2, -100)).toBeGreaterThan(2);
    expect(zoomBy(2, 100)).toBeLessThan(2);
  });
});

describe("panBy", () => {
  it("converts pixel deltas to clamped fractions", () => {
    const moved = panBy(DEFAULT_CROP, 100, -100, 400, 400);
    expect(moved.offsetX).toBeCloseTo(0.5);
    expect(moved.offsetY).toBeCloseTo(-0.5);
  });
  it("clamps to the pan range", () => {
    const moved = panBy(DEFAULT_CROP, 10000, 10000, 400, 400);
    expect(moved.offsetX).toBe(1);
    expect(moved.offsetY).toBe(1);
  });
  it("does not change the fit or zoom", () => {
    const moved = panBy({ ...DEFAULT_CROP, fit: "contain", zoom: 3 }, 10, 10, 400, 400);
    expect(moved.fit).toBe("contain");
    expect(moved.zoom).toBe(3);
  });
});
