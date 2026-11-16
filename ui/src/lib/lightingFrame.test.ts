import { describe, expect, it } from "vitest";
import { keyPower, sampleFrame } from "./lightingFrame";
import { FRAME_STRIDE } from "./lightingPerf";
import type { LedLighting } from "./ledField";

const lighting: LedLighting = { effect: 6, brightness: 9, speed: 5, orientation: 0, rainbow: 0, color: [255, 255, 255] };
const coords = [0, 0.25, 0.5, 0.75, 1].map((x) => ({ x, y: 0.5 }));

function run(e: number) {
  const out = new Float32Array(coords.length * FRAME_STRIDE);
  const powers = new Float32Array(coords.length);
  const avg = sampleFrame(lighting, coords, 0, out, e, powers);
  return { out, powers, avg };
}
const inten = (out: Float32Array, i: number) => out[i * FRAME_STRIDE + 3];
const tint = (out: Float32Array, i: number) => out[i * FRAME_STRIDE + 4];

describe("sampleFrame power-on", () => {
  it("is fully dark at e = 0", () => {
    const { out, powers, avg } = run(0);
    for (let i = 0; i < coords.length; i++) {
      expect(inten(out, i)).toBe(0);
      expect(tint(out, i)).toBe(0);
      expect(powers[i]).toBe(0);
    }
    expect(avg.weight).toBe(0);
    expect(avg.power).toBe(0);
  });

  it("wipes left to right at e = 0.5", () => {
    const lit = run(1);
    const { out, powers, avg } = run(0.5);
    expect(powers[0]).toBe(1);
    expect(powers[2]).toBeCloseTo(0.5, 5);
    expect(powers[4]).toBe(0);
    expect(inten(out, 0)).toBeCloseTo(inten(lit.out, 0), 5);
    expect(inten(out, 2)).toBeCloseTo(inten(lit.out, 2) * 0.5, 5);
    expect(tint(out, 2)).toBeCloseTo(tint(lit.out, 2) * 0.5, 5);
    expect(inten(out, 4)).toBe(0);
    expect(avg.power).toBeGreaterThan(0);
    expect(avg.power).toBeLessThan(1);
    expect(avg.weight).toBeLessThan(lit.avg.weight);
  });

  it("is untouched at e = 1", () => {
    const { powers, avg } = run(1);
    for (const p of powers) expect(p).toBe(1);
    expect(avg.power).toBe(1);
    expect(avg.weight).toBeGreaterThan(0);
  });

  it("keyPower is clamped and monotonic in e", () => {
    expect(keyPower(0, 0)).toBe(0);
    expect(keyPower(1, 1)).toBe(1);
    expect(keyPower(0.4, 0.5)).toBeLessThan(keyPower(0.6, 0.5));
  });
});
