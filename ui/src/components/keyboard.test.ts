import { describe, expect, it } from "vitest";
import { keyboardLayout, underglowColor } from "./keyboard";

describe("keyboardLayout", () => {
  it("lays out a plausible 87-key grid", () => {
    const keys = keyboardLayout();
    expect(keys.length).toBeGreaterThan(80);
    for (const key of keys) {
      expect(key.size[0]).toBeGreaterThan(0);
      expect(key.size[1]).toBeGreaterThan(0);
    }
  });
  it("is deterministic", () => {
    expect(keyboardLayout()).toEqual(keyboardLayout());
  });
});

describe("underglowColor", () => {
  it("returns the RGB color when rainbow is off", () => {
    expect(underglowColor({ underglow: { rainbow: 0, color: [255, 0, 128] } })).toBe(
      "rgb(255, 0, 128)",
    );
  });
  it("returns a neutral hue when rainbow is on", () => {
    expect(underglowColor({ underglow: { rainbow: 1, color: [255, 0, 0] } })).toBe("#8b5cf6");
  });
  it("is dark when brightness is zero", () => {
    expect(
      underglowColor({ underglow: { rainbow: 0, color: [255, 255, 255] }, brightness: 0 }, 0),
    ).toBe("rgb(0, 0, 0)");
  });
});

import { partAnchors } from "./keyboard";

describe("partAnchors", () => {
  it("places the screen, knob, light bar and Win key inside the case", () => {
    const a = partAnchors();
    for (const p of [a.screen, a.knob, a.bar, a.win]) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(100);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(100);
    }
    expect(a.win.x).toBeLessThan(a.screen.x);
  });
});
