import { describe, expect, it } from "vitest";
import { ledBarSample } from "./lighting";

describe("ledBarSample", () => {
  it("is dark when the colour is Off", () => {
    expect(ledBarSample({ mode: 3, saturation: 9, rainbow: 0, color: 8 }, 0).a).toBe(0);
  });
  it("shows the selected colour for a fixed mode, brighter with saturation", () => {
    const lo = ledBarSample({ mode: 3, saturation: 0, rainbow: 0, color: 5 }, 0);
    const hi = ledBarSample({ mode: 3, saturation: 9, rainbow: 0, color: 5 }, 0);
    expect([hi.r, hi.g, hi.b]).toEqual([0, 145, 255]);
    expect(hi.a).toBeGreaterThan(lo.a);
  });
  it("blinks in mode 0", () => {
    const led = { mode: 0, saturation: 9, rainbow: 0, color: 0 };
    expect(ledBarSample(led, 0).a).toBeGreaterThan(ledBarSample(led, 700).a);
  });
  it("alternates colours in mode 2 and cycles hue for rainbow", () => {
    const pair = { mode: 2, saturation: 9, rainbow: 0, color: 0 };
    expect(ledBarSample(pair, 0).r).not.toBe(ledBarSample(pair, 700).r);
    const rb = { mode: 3, saturation: 9, rainbow: 1, color: 0 };
    expect(ledBarSample(rb, 0).g).not.toBe(ledBarSample(rb, 1500).g);
  });
});
