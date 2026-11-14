import { describe, expect, it } from "vitest";
import { peakTime, thumbFrame, thumbLayout } from "./boardThumb";
import { CAP_TINT_MAX } from "./ledField";

const base = { effect: 16, brightness: 9, speed: 3, orientation: 0, rainbow: 0, color: [255, 60, 60] as [number, number, number] };

describe("boardThumb", () => {
  it("lays out one normalised rect per key", () => {
    const { keys, aspect } = thumbLayout();
    expect(keys.length).toBeGreaterThan(80);
    expect(aspect).toBeGreaterThan(2);
    for (const k of keys) {
      expect(k.x).toBeGreaterThanOrEqual(-1e-6);
      expect(k.x + k.w).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
  it("has real contrast between lit and unlit keys at the peak frame, and caps tint stays capped", () => {
    for (const effect of [8, 9, 16]) {
      const f = thumbFrame({ ...base, effect }, peakTime(effect));
      const is = f.map((k) => k.i);
      expect(Math.max(...is) - Math.min(...is)).toBeGreaterThan(0.5);
      for (const k of f) expect(k.tint).toBeLessThanOrEqual(CAP_TINT_MAX + 1e-9);
    }
  });
  it("stays dark when the effect is off", () => {
    expect(thumbFrame({ ...base, effect: 0 }, 0).every((k) => k.i === 0)).toBe(true);
  });
});
