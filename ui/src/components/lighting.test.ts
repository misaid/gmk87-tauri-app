import { describe, expect, it } from "vitest";
import {
  ledAnimation,
  perKeyUnderglow,
  underglowAnimation,
  underglowCategory,
  type LedState,
  type UnderglowState,
} from "./lighting";
import { LED_MODES, UNDERGLOW_EFFECTS } from "@/lib/effects";

function underglow(overrides: Partial<UnderglowState> = {}): UnderglowState {
  return {
    effect: 6,
    brightness: 9,
    speed: 4,
    orientation: 0,
    rainbow: 0,
    color: [255, 0, 0],
    ...overrides,
  };
}

function led(overrides: Partial<LedState> = {}): LedState {
  return { mode: 3, saturation: 9, rainbow: 0, color: 0, ...overrides };
}

describe("underglowAnimation", () => {
  it("is reproducible: the same state always yields the same animation", () => {
    for (const effect of UNDERGLOW_EFFECTS) {
      const a = underglowAnimation(underglow({ effect: effect.value }));
      const b = underglowAnimation(underglow({ effect: effect.value }));
      expect(a).toEqual(b);
    }
  });

  it("produces a valid, non-empty animation for every named effect", () => {
    // `colors` and `opacity` are independent keyframe tracks (e.g. breathing
    // holds one colour while opacity pulses through several steps), so their
    // lengths are not required to match.
    for (const effect of UNDERGLOW_EFFECTS) {
      const anim = underglowAnimation(underglow({ effect: effect.value }));
      expect(anim.colors.length).toBeGreaterThan(0);
      expect(anim.opacity.length).toBeGreaterThan(0);
      expect(anim.durationSec).toBeGreaterThan(0);
      for (const o of anim.opacity) {
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is fully off for effect 0", () => {
    expect(underglowCategory(0)).toBe("off");
    const anim = underglowAnimation(underglow({ effect: 0 }));
    expect(anim.opacity).toEqual([0]);
    expect(anim.loop).toBe(false);
  });

  it("falls back to static for an unknown effect value", () => {
    expect(underglowCategory(99)).toBe("static");
  });

  it("forces a rainbow sequence when the rainbow flag is set, regardless of effect", () => {
    const anim = underglowAnimation(underglow({ effect: 6, rainbow: 1 }));
    expect(anim.colors.length).toBeGreaterThan(1);
  });

  it("reverses the rainbow order when orientation flips", () => {
    const forward = underglowAnimation(underglow({ effect: 11, orientation: 0 }));
    const reversed = underglowAnimation(underglow({ effect: 11, orientation: 1 }));
    expect(forward.colors).toEqual([...reversed.colors].reverse());
  });

  it("scales opacity with brightness", () => {
    const dim = underglowAnimation(underglow({ effect: 6, brightness: 0 }));
    const bright = underglowAnimation(underglow({ effect: 6, brightness: 9 }));
    expect(bright.opacity[0]).toBeGreaterThan(dim.opacity[0]);
  });

  it("scales duration with speed for an animated effect", () => {
    const fast = underglowAnimation(underglow({ effect: 5, speed: 0 }));
    const slow = underglowAnimation(underglow({ effect: 5, speed: 9 }));
    expect(slow.durationSec).toBeGreaterThan(fast.durationSec);
  });
});

describe("perKeyUnderglow", () => {
  const left = { x: 0.05, y: 0.5, index: 0 };
  const right = { x: 0.95, y: 0.5, index: 80 };
  const top = { x: 0.5, y: 0.05, index: 0 };
  const bottom = { x: 0.5, y: 0.95, index: 60 };
  const center = { x: 0.5, y: 0.5, index: 40 };
  const corner = { x: 0.05, y: 0.05, index: 0 };

  it("is off for effect 0 for every key", () => {
    for (const key of [left, right, center]) {
      const anim = perKeyUnderglow(underglow({ effect: 0 }), key);
      expect(anim.opacity).toEqual([0]);
      expect(anim.loop).toBe(false);
    }
  });

  it("is uniform for the static effect", () => {
    expect(perKeyUnderglow(underglow({ effect: 6 }), left)).toEqual(
      perKeyUnderglow(underglow({ effect: 6 }), right),
    );
  });

  it("varies by x for horizontal waves (1, 2, 16)", () => {
    for (const effect of [1, 2, 16]) {
      const a = perKeyUnderglow(underglow({ effect }), left);
      const b = perKeyUnderglow(underglow({ effect }), right);
      expect(a).not.toEqual(b);
    }
  });

  it("varies by y for waterfall (3)", () => {
    const a = perKeyUnderglow(underglow({ effect: 3 }), top);
    const b = perKeyUnderglow(underglow({ effect: 3 }), bottom);
    expect(a).not.toEqual(b);
    // Waterfall falls top→bottom, so keys sharing y match regardless of x.
    const sameY = perKeyUnderglow(underglow({ effect: 3 }), { x: 0.9, y: 0.05, index: 5 });
    expect(sameY).toEqual(a);
  });

  it("varies by distance from centre for wave-from-center (13)", () => {
    const a = perKeyUnderglow(underglow({ effect: 13 }), center);
    const b = perKeyUnderglow(underglow({ effect: 13 }), corner);
    expect(a).not.toEqual(b);
  });

  it("varies colour by x for rainbow gradients (4, 11)", () => {
    for (const effect of [4, 11]) {
      const a = perKeyUnderglow(underglow({ effect }), left);
      const b = perKeyUnderglow(underglow({ effect }), right);
      expect(a.colors).not.toEqual(b.colors);
    }
  });

  it("varies colour by y for rainbow waterfall (12)", () => {
    const a = perKeyUnderglow(underglow({ effect: 12 }), top);
    const b = perKeyUnderglow(underglow({ effect: 12 }), bottom);
    expect(a.colors).not.toEqual(b.colors);
  });

  it("varies colour by distance for slow rainbow from centre (18)", () => {
    const a = perKeyUnderglow(underglow({ effect: 18 }), center);
    const b = perKeyUnderglow(underglow({ effect: 18 }), corner);
    expect(a.colors).not.toEqual(b.colors);
  });

  it("varies for reactive effects by key", () => {
    for (const effect of [7, 8, 9, 10, 14, 15]) {
      const a = perKeyUnderglow(underglow({ effect }), left);
      const b = perKeyUnderglow(underglow({ effect }), right);
      expect(a).not.toEqual(b);
    }
  });

  it("mirrors the horizontal mapping when orientation flips", () => {
    const fwdLeft = perKeyUnderglow(underglow({ effect: 1, orientation: 0 }), left);
    const revRight = perKeyUnderglow(underglow({ effect: 1, orientation: 1 }), right);
    expect(fwdLeft).toEqual(revRight);
  });

  it("is deterministic per key", () => {
    expect(perKeyUnderglow(underglow({ effect: 11 }), center)).toEqual(
      perKeyUnderglow(underglow({ effect: 11 }), center),
    );
  });

  it("produces valid animations for every effect and every key", () => {
    for (const effect of UNDERGLOW_EFFECTS) {
      for (const key of [left, right, top, bottom, center]) {
        const anim = perKeyUnderglow(underglow({ effect: effect.value }), key);
        expect(anim.colors.length).toBeGreaterThan(0);
        expect(anim.opacity.length).toBeGreaterThan(0);
        expect(anim.durationSec).toBeGreaterThan(0);
      }
    }
  });
});

describe("ledAnimation", () => {
  it("is reproducible: the same state always yields the same animation", () => {
    for (const mode of LED_MODES) {
      const a = ledAnimation(led({ mode: mode.value }));
      const b = ledAnimation(led({ mode: mode.value }));
      expect(a).toEqual(b);
    }
  });

  it("produces a valid, non-empty animation for every named mode", () => {
    for (const mode of LED_MODES) {
      const anim = ledAnimation(led({ mode: mode.value }));
      expect(anim.colors.length).toBeGreaterThan(0);
      expect(anim.opacity.length).toBeGreaterThan(0);
    }
  });

  it("is off when the colour index is 8 (Off)", () => {
    const anim = ledAnimation(led({ color: 8 }));
    expect(anim.opacity).toEqual([0]);
  });

  it("blinks for the two blinking modes", () => {
    for (const mode of [0, 2]) {
      const anim = ledAnimation(led({ mode }));
      expect(anim.opacity.length).toBeGreaterThan(1);
      expect(anim.loop).toBe(true);
    }
  });

  it("is a steady colour for the two fixed modes", () => {
    for (const mode of [3, 4]) {
      const anim = ledAnimation(led({ mode }));
      expect(anim.opacity).toHaveLength(1);
      expect(anim.loop).toBe(false);
    }
  });
});

import { ambientFrom, brightnessLabel } from "./lighting";

describe("brightnessLabel / ambientFrom", () => {
  it("formats word and step the same way everywhere", () => {
    expect(brightnessLabel(8)).toBe("Bright · 8/9");
    expect(brightnessLabel(0)).toBe("Off · 0/9");
  });
  it("quantises ambient colour and clamps strength", () => {
    expect(ambientFrom({ r: 80, g: 180, b: 255 }, 0.98)).toEqual({ rgb: "85 187 255", k: "1.00" });
    expect(ambientFrom(null, 1).k).toBe("0");
  });
});
