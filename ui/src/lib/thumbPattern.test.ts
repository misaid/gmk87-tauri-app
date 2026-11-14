import { describe, expect, it } from "vitest";
import { thumbIntensity } from "./thumbPattern";

const grid = (effect: number) =>
  Array.from({ length: 4 }, (_, r) => Array.from({ length: 14 }, (_, c) => thumbIntensity(effect, r, c, 4, 14)));

describe("thumbIntensity", () => {
  it("falls back for effects without a hand-drawn frame", () => {
    expect(thumbIntensity(4, 0, 0, 4, 14)).toBeNull();
  });
  it("row sweep lights a single column", () => {
    const lit = grid(9)[0].filter((v) => v === 1).length;
    expect(lit).toBe(1);
  });
  it("ripple spread is a ring: dark centre, lit edge ring", () => {
    const g = grid(8);
    expect(g[1][7]).toBe(0);
    expect(g.flat().some((v) => v === 1)).toBe(true);
  });
  it("breathe peaks in the centre, steady is uniform", () => {
    const b = grid(5);
    expect(b[1][7]).toBeGreaterThan(b[0][0]!);
    expect(new Set(grid(6).flat())).toEqual(new Set([1]));
  });
  it("patterns differ pairwise for the look-alike effects", () => {
    const keys = [1, 5, 6, 14, 16].map((e) => JSON.stringify(grid(e)));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
