import { describe, expect, it } from "vitest";
import {
  ledCss,
  ledSample,
  ledStops,
  type LedLighting,
} from "./ledField";

function lighting(overrides: Partial<LedLighting> = {}): LedLighting {
  return {
    effect: 6,
    brightness: 9,
    speed: 3,
    orientation: 0,
    rainbow: 0,
    color: [139, 92, 246],
    ...overrides,
  };
}

/** The gallery's canonical thumbnail base and fixed sample time. */
const THUMB_BASE: LedLighting = { ...lighting(), brightness: 6 };
const THUMB_TIME_MS = 1600;

describe("ledSample", () => {
  it("is deterministic: the same inputs always yield the same sample", () => {
    for (let effect = 0; effect <= 18; effect++) {
      for (const timeMs of [0, 500, 1600, 4200]) {
        const a = ledSample(lighting({ effect }), 0.3, 0.7, 42, timeMs);
        const b = ledSample(lighting({ effect }), 0.3, 0.7, 42, timeMs);
        expect(a).toEqual(b);
      }
    }
  });

  it("is fully off for effect 0", () => {
    const s = ledSample(lighting({ effect: 0 }), 0.5, 0.5, 40, 1200);
    expect(s.intensity).toBe(0);
  });

  it("scales intensity with brightness (0 → off, 9 → full)", () => {
    const off = ledSample(lighting({ effect: 6, brightness: 0 }), 0.5, 0.5, 40, 800);
    const mid = ledSample(lighting({ effect: 6, brightness: 4 }), 0.5, 0.5, 40, 800);
    const full = ledSample(lighting({ effect: 6, brightness: 9 }), 0.5, 0.5, 40, 800);
    expect(off.intensity).toBe(0);
    expect(mid.intensity).toBeGreaterThan(0);
    expect(mid.intensity).toBeLessThan(full.intensity);
    expect(full.intensity).toBeCloseTo(1, 5);
  });

  it("returns valid 0..255 channels and intensity in 0..1 for every effect", () => {
    const positions: Array<[number, number, number]> = [
      [0.05, 0.05, 0],
      [0.5, 0.5, 40],
      [0.95, 0.95, 86],
      [0.1, 0.9, 12],
    ];
    for (let effect = 0; effect <= 18; effect++) {
      // Cover well over one full animation cycle, including speed extremes.
      for (const timeMs of [0, 300, 900, 1700, 2600, 4000]) {
        for (const [x, y, keyIndex] of positions) {
          for (const rainbow of [0, 1] as const) {
            for (const orientation of [0, 1] as const) {
              const s = ledSample(
                lighting({ effect, rainbow, orientation, speed: 0 }),
                x,
                y,
                keyIndex,
                timeMs,
              );
              expect(s.r).toBeGreaterThanOrEqual(0);
              expect(s.r).toBeLessThanOrEqual(255);
              expect(s.g).toBeGreaterThanOrEqual(0);
              expect(s.g).toBeLessThanOrEqual(255);
              expect(s.b).toBeGreaterThanOrEqual(0);
              expect(s.b).toBeLessThanOrEqual(255);
              expect(s.intensity).toBeGreaterThanOrEqual(0);
              expect(s.intensity).toBeLessThanOrEqual(1);
              expect(Number.isFinite(s.r + s.g + s.b + s.intensity)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("varies by x for the horizontal dimming wave (1)", () => {
    const l = lighting({ effect: 1 });
    const left = ledSample(l, 0.1, 0.5, 0, 500);
    const right = ledSample(l, 0.9, 0.5, 80, 500);
    expect(left.intensity).not.toBe(right.intensity);
  });

  it("varies by y for the waterfall (3), not by x", () => {
    const l = lighting({ effect: 3 });
    const top = ledSample(l, 0.5, 0.1, 0, 500);
    const bottom = ledSample(l, 0.5, 0.9, 60, 500);
    expect(top.intensity).not.toBe(bottom.intensity);
  });

  it("varies colour by x when the rainbow flag is set", () => {
    const l = lighting({ effect: 6, rainbow: 1 });
    const left = ledSample(l, 0.1, 0.5, 0, 900);
    const right = ledSample(l, 0.9, 0.5, 80, 900);
    expect([left.r, left.g, left.b]).not.toEqual([right.r, right.g, right.b]);
  });

  it("varies colour by x for the cycling-colours effect (4)", () => {
    const l = lighting({ effect: 4 });
    const left = ledSample(l, 0.1, 0.5, 0, 900);
    const right = ledSample(l, 0.9, 0.5, 80, 900);
    expect([left.r, left.g, left.b]).not.toEqual([right.r, right.g, right.b]);
  });

  it("mirrors the horizontal gradient when orientation flips", () => {
    const forward = lighting({ effect: 1, orientation: 0 });
    const reversed = lighting({ effect: 1, orientation: 1 });
    const fwdLeft = ledSample(forward, 0.1, 0.5, 0, 500);
    const revRight = ledSample(reversed, 0.9, 0.5, 80, 500);
    expect(fwdLeft).toEqual(revRight);
    const fwdRight = ledSample(forward, 0.9, 0.5, 80, 500);
    expect(fwdLeft).not.toEqual(fwdRight);
  });

  it("changes the random pattern over time but deterministically per key", () => {
    const l = lighting({ effect: 10 });
    const a = ledSample(l, 0.3, 0.5, 7, 1000);
    const b = ledSample(l, 0.3, 0.5, 7, 1000);
    expect(a).toEqual(b);
    const later = ledSample(l, 0.3, 0.5, 7, 2400);
    const neighbour = ledSample(l, 0.3, 0.5, 8, 1000);
    expect(later.intensity).not.toBe(a.intensity);
    expect(neighbour.intensity).not.toBe(a.intensity);
  });
});

describe("ledCss", () => {
  it("formats an rgba string with the given alpha", () => {
    const css = ledCss({ r: 10.4, g: 200, b: 255, intensity: 0.5 }, 0.25);
    expect(css).toBe("rgba(10, 200, 255, 0.250)");
  });

  it("defaults alpha to the sample intensity", () => {
    const css = ledCss({ r: 1, g: 2, b: 3, intensity: 0.5 });
    expect(css).toBe("rgba(1, 2, 3, 0.500)");
  });
});

describe("ledStops", () => {
  it("returns eight left→right samples", () => {
    expect(ledStops(lighting({ effect: 6 }))).toHaveLength(8);
  });

  it("shows a horizontal rainbow for the rainbow flag", () => {
    const stops = ledStops(lighting({ effect: 6, rainbow: 1 }), 900);
    expect(stops[0]).not.toBe(stops[7]);
  });

  it("makes all 19 effects read differently at the thumbnail's fixed time", () => {
    const seen = new Map<string, number>();
    for (let effect = 0; effect <= 18; effect++) {
      const stops = ledStops({ ...THUMB_BASE, effect }, THUMB_TIME_MS);
      const key = stops.join("|");
      const owner = seen.get(key);
      // Every effect's static thumb must be visually distinct from the others.
      expect(owner ?? null, `effect ${effect} thumb matches effect ${owner}`).toBeNull();
      seen.set(key, effect);
      expect(stops.some((s) => s !== "rgba(0, 0, 0, 0.000)" && !s.endsWith(", 0.000)"))).toBe(
        effect !== 0,
      );
    }
  });
});

describe("ledGrid", () => {
  it("returns rows x cols cells and an Off grid is fully transparent", async () => {
    const { ledGrid } = await import("./ledField");
    const g = ledGrid({ effect: 0, brightness: 9, speed: 3, orientation: 0, rainbow: 0, color: [10, 20, 30] }, 0, 3, 14);
    expect(g).toHaveLength(3);
    expect(g[0]).toHaveLength(14);
  });
});

import { KEY_FLOOR, keyIntensity } from "./ledField";

describe("keyIntensity", () => {
  it("keeps a dim floor under every key for effects that are on, brighter when lit", () => {
    const l = { effect: 8, brightness: 9 };
    expect(keyIntensity(l, 0)).toBeCloseTo(KEY_FLOOR, 5);
    expect(keyIntensity(l, 1)).toBeCloseTo(1, 5);
    expect(keyIntensity(l, 0.5)).toBeLessThan(0.5);
    expect(keyIntensity(l, 0.9) - keyIntensity(l, 0.1)).toBeGreaterThan(0.5);
  });
  it("stays dark for Off and brightness 0", () => {
    expect(keyIntensity({ effect: 0, brightness: 9 }, 1)).toBe(0);
    expect(keyIntensity({ effect: 8, brightness: 0 }, 1)).toBe(0);
  });
});
