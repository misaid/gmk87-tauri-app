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

import { cropGeometry, cropKey, drawCrop } from "./crop";

describe("cropGeometry", () => {
  it("covers a wide source by cropping the sides, centred", () => {
    const { src, dst } = cropGeometry(1920, 1080, DEFAULT_CROP, 480, 270);
    expect(src.h).toBeCloseTo(1080);
    expect(src.w).toBeCloseTo(1080 * (240 / 135));
    expect(src.x).toBeCloseTo((1920 - src.w) / 2);
    expect(dst).toEqual({ x: 0, y: 0, w: 480, h: 270 });
  });
  it("zoom shrinks the visible window and pan moves it to the edges", () => {
    const right = cropGeometry(2000, 1000, { ...DEFAULT_CROP, zoom: 2, offsetX: 1, offsetY: 1 }, 240, 135);
    expect(right.src.w).toBeCloseTo((1000 * (240 / 135)) / 2);
    expect(right.src.x + right.src.w).toBeCloseTo(2000);
    expect(right.src.y + right.src.h).toBeCloseTo(1000);
    const left = cropGeometry(2000, 1000, { ...DEFAULT_CROP, zoom: 2, offsetX: -1 }, 240, 135);
    expect(left.src.x).toBeCloseTo(0);
  });
  it("clamps zoom like the renderer", () => {
    const { src } = cropGeometry(1000, 1000, { ...DEFAULT_CROP, zoom: 99 }, 240, 135);
    const max = cropGeometry(1000, 1000, { ...DEFAULT_CROP, zoom: MAX_ZOOM }, 240, 135);
    expect(src.w).toBeCloseTo(max.src.w);
  });
  it("contain letterboxes inside the canvas", () => {
    const { src, dst } = cropGeometry(1000, 1000, { ...DEFAULT_CROP, fit: "contain" }, 240, 135);
    expect(src.w).toBeCloseTo(1000 * (240 / 135) > 1000 ? 1000 : 1000 * (240 / 135));
    expect(dst.h).toBeCloseTo(135);
    expect(dst.x).toBeGreaterThan(0);
    expect(dst.x * 2 + dst.w).toBeCloseTo(240);
  });
  it("drawCrop issues one drawImage with the computed rects", () => {
    const calls: unknown[][] = [];
    const ctx = { fillRect: () => {}, drawImage: (...a: unknown[]) => calls.push(a), fillStyle: "", imageSmoothingQuality: "" };
    drawCrop(ctx as never, { width: 1920, height: 1080 } as never, DEFAULT_CROP, 240, 135);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(9);
  });
  it("cropKey is stable and distinguishes crops", () => {
    expect(cropKey(DEFAULT_CROP)).toBe(cropKey({ ...DEFAULT_CROP }));
    expect(cropKey(DEFAULT_CROP)).not.toBe(cropKey({ ...DEFAULT_CROP, zoom: 1.5 }));
  });
});

describe("drawCrop smoothing quality", () => {
  it("defaults to high and honours an explicit quality", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      fillRect() {},
      drawImage() {},
      set imageSmoothingQuality(v: string) {
        calls.push(v);
      },
    } as unknown as CanvasRenderingContext2D;
    drawCrop(ctx, { width: 100, height: 100 } as unknown as ImageBitmap, DEFAULT_CROP, 240, 135);
    drawCrop(ctx, { width: 100, height: 100 } as unknown as ImageBitmap, DEFAULT_CROP, 240, 135, "low");
    expect(calls).toEqual(["high", "low"]);
  });
});
