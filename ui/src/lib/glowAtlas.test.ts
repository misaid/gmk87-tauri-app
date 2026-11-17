import { describe, expect, it } from "vitest";
import { blurInPlace, buildGlowMasks, composeLevel, composePixel, gaussianKernel } from "./glowAtlas";

describe("glow masks", () => {
  it("uses a normalised, symmetric Gaussian kernel", () => {
    const k = gaussianKernel(3);
    expect(k.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 5);
    expect(k[0]).toBeCloseTo(k[k.length - 1], 6);
    expect(k[(k.length - 1) / 2]).toBe(Math.max(...k));
  });

  it("blur keeps total energy of an impulse away from the edges", () => {
    const w = 41;
    const data = new Float32Array(w * w);
    data[20 * w + 20] = 1;
    blurInPlace(data, w, w, 3);
    expect(data.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 3);
    expect(data[20 * w + 20]).toBeLessThan(0.1);
  });

  it("puts the glow under the key and the seam just below its bottom edge", () => {
    const m = buildGlowMasks(40, 40, 1);
    const at = (x: number, y: number, arr: Uint8ClampedArray, c: number) => arr[((Math.round(m.oy + y)) * m.width + Math.round(m.ox + x)) * 4 + c];
    // Row-bleed band is solid just under the cap and fades by the time it is well below the seam.
    expect(at(20, 46, m.a, 3)).toBeGreaterThan(110);
    expect(at(20, 85, m.a, 3)).toBeLessThan(5);
    // Seam body sits right under the cap and nowhere inside it.
    expect(at(20, 42, m.b, 1)).toBeGreaterThan(200);
    expect(at(20, 10, m.b, 1)).toBe(0);
    // The seam's shadow is only painted outside the seam itself.
    expect(at(20, 42, m.b, 0)).toBeLessThan(5);
    // Nothing leaks past the sprite padding.
    expect(m.a[3]).toBe(0);
  });

  it("mask size scales with the device pixel scale", () => {
    const a = buildGlowMasks(30, 30, 1);
    const b = buildGlowMasks(30, 30, 2);
    expect(b.width).toBeGreaterThanOrEqual(a.width * 2 - 2);
    expect(b.ox).toBeCloseTo(a.ox * 2, 5);
  });
});

describe("composePixel", () => {
  const m = { h0: 0.6, h1: 0.4, gap: 0.5, band: 0.7 };

  it("is dark with no intensity and grows with it", () => {
    expect(composePixel(m, 0)).toBe(0);
    expect(composePixel(m, 0.3)).toBeLessThan(composePixel(m, 0.6));
    expect(composePixel(m, 1)).toBeLessThanOrEqual(1);
  });

  it("clamps each layer at full alpha before they are combined", () => {
    // Halo stop alpha is 2 * intensity, clamped at 1, so intensity 0.5 and 1 give the same halo.
    const halo = { h0: 1, h1: 0, gap: 0, band: 0 };
    expect(composePixel(halo, 0.5)).toBeCloseTo(composePixel(halo, 1), 6);
  });

  it("composeLevel fills an alpha-only white mask of the right size", () => {
    const masks = buildGlowMasks(20, 20, 1);
    const level = composeLevel(masks, 0.8);
    expect(level.length).toBe(masks.width * masks.height * 4);
    expect(level[0]).toBe(255);
    expect(Math.max(...Array.from(level).filter((_, i) => i % 4 === 3))).toBeGreaterThan(200);
  });
});
