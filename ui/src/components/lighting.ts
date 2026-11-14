export interface UnderglowState {
  effect: number;
  brightness: number;
  speed: number;
  orientation: number;
  rainbow: number;
  color: [number, number, number];
}

export interface LedState {
  mode: number;
  saturation: number;
  rainbow: number;
  color: number;
}

/** A key's board position, normalised to 0..1 (x: left→right, y: top→bottom). */
export interface KeyPos {
  x: number;
  y: number;
  index: number;
}

export type GlowCategory = "off" | "static" | "breathing" | "wave" | "rainbow" | "reactive";

/** A keyframe sequence for a glow, driven entirely by device state (no randomness). */
export interface GlowAnimation {
  colors: string[];
  opacity: number[];
  durationSec: number;
  loop: boolean;
}

// The 19 underglow effects (spec §3.5), grouped by how they read visually.
const UNDERGLOW_CATEGORY: Readonly<Record<number, GlowCategory>> = {
  0: "off",
  1: "wave", // Horizontal dimming wave
  2: "wave", // Horizontal pulse wave
  3: "wave", // Waterfall
  4: "rainbow", // Full cycling colors
  5: "breathing", // Breathing
  6: "static", // Full one color
  7: "reactive", // Glow pressed key
  8: "reactive", // Glow spreading
  9: "reactive", // Glow row
  10: "reactive", // Random pattern
  11: "rainbow", // Rainbow cycle
  12: "rainbow", // Rainbow waterfall
  13: "wave", // Wave from center
  14: "reactive", // Circling J/K
  15: "reactive", // Raining
  16: "wave", // Wave left-right
  17: "breathing", // Slow saturation cycle
  18: "rainbow", // Slow rainbow from center
};

/** A deterministic flicker envelope for the key/row-reactive effects (no Math.random). */
const REACTIVE_ENVELOPE = [1, 0.35, 0.85, 0.25, 0.95, 0.45, 0.7, 0.3];

/** A fixed 7-stop rainbow loop, reversed when the orientation flag is set. */
function rainbowStops(orientation: number): string[] {
  const hues = [0, 51, 102, 153, 204, 255, 306, 360];
  const ordered = orientation === 1 ? [...hues].reverse() : hues;
  return ordered.map((h) => `hsl(${h}, 85%, 58%)`);
}

export function underglowCategory(effect: number): GlowCategory {
  return UNDERGLOW_CATEGORY[effect] ?? "static";
}

/** Maps underglow state to a keyframe animation; the same input always yields the same output. */
export function underglowAnimation(u: UnderglowState): GlowAnimation {
  const category = underglowCategory(u.effect);
  const brightnessScale = u.brightness / 9;
  const baseOpacity = 0.12 + brightnessScale * 0.58;
  const durationSec = 2 + (u.speed / 9) * 4;
  const solid = `rgb(${u.color[0]}, ${u.color[1]}, ${u.color[2]})`;

  if (category === "off") {
    return { colors: ["transparent"], opacity: [0], durationSec: 1, loop: false };
  }
  if (u.rainbow === 1 || category === "rainbow") {
    const stops = rainbowStops(u.orientation);
    return { colors: stops, opacity: stops.map(() => baseOpacity), durationSec, loop: true };
  }
  if (category === "breathing") {
    return { colors: [solid], opacity: [baseOpacity * 0.2, baseOpacity, baseOpacity * 0.2], durationSec, loop: true };
  }
  if (category === "wave") {
    return {
      colors: [solid],
      opacity: [baseOpacity * 0.35, baseOpacity, baseOpacity * 0.35],
      durationSec: durationSec * 0.55,
      loop: true,
    };
  }
  if (category === "reactive") {
    return {
      colors: [solid],
      opacity: REACTIVE_ENVELOPE.map((f) => baseOpacity * f),
      durationSec: durationSec * 0.7,
      loop: true,
    };
  }
  return { colors: [solid], opacity: [baseOpacity], durationSec: 1, loop: false };
}

/** Clamps a coordinate to 0..1 so out-of-range key positions saturate, not wrap. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Flips a coordinate when the device orientation flag asks for right-to-left. */
function mirror(coord: number, orientation: number): number {
  return orientation === 1 ? 1 - coord : coord;
}

/** Normalised distance from the board centre: 0 at centre, 1 at a corner. */
function distFromCenter(x: number, y: number): number {
  return clamp01(Math.hypot(x - 0.5, y - 0.5) / Math.hypot(0.5, 0.5));
}

/** Cyclically rotates an array by k positions (deterministic phase shift). */
function rotate<T>(arr: readonly T[], k: number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  const shift = ((k % n) + n) % n;
  return arr.map((_, i) => arr[(i + shift) % n]);
}

/** The spatial coordinate waves travel along: x for horizontal, y for waterfall, radius for centre-out. */
function waveT(u: UnderglowState, key: KeyPos): number {
  const x = clamp01(key.x);
  const y = clamp01(key.y);
  if (u.effect === 3) return mirror(y, u.orientation); // Waterfall: top → bottom
  if (u.effect === 13) return distFromCenter(x, y); // Wave from center: centre → out
  return mirror(x, u.orientation); // 1, 2, 16 and fallback: left ↔ right
}

/** The spatial coordinate the rainbow gradient follows for this effect. */
function rainbowT(u: UnderglowState, key: KeyPos): number {
  const x = clamp01(key.x);
  const y = clamp01(key.y);
  if (u.effect === 12) return mirror(y, u.orientation); // Rainbow waterfall: top → bottom
  if (u.effect === 18) return distFromCenter(x, y); // Slow rainbow from center
  return mirror(x, u.orientation); // 4, 11 and rainbow flag: left ↔ right
}

/**
 * Maps underglow state plus one key's position to that key's glow.
 * Static/breathing are uniform; waves, rainbows and reactives are phase-shifted
 * per key so neighbouring keys show different colours/brightness over time.
 */
export function perKeyUnderglow(u: UnderglowState, key: KeyPos): GlowAnimation {
  const category = underglowCategory(u.effect);
  const brightnessScale = u.brightness / 9;
  const baseOpacity = 0.12 + brightnessScale * 0.58;
  const durationSec = 2 + (u.speed / 9) * 4;
  const solid = `rgb(${u.color[0]}, ${u.color[1]}, ${u.color[2]})`;

  if (category === "off") {
    return { colors: ["transparent"], opacity: [0], durationSec: 1, loop: false };
  }
  if (u.rainbow === 1 || category === "rainbow") {
    const stops = rainbowStops(u.orientation);
    const shift = Math.floor(clamp01(rainbowT(u, key)) * stops.length) % stops.length;
    return {
      colors: rotate(stops, shift),
      opacity: stops.map(() => baseOpacity),
      durationSec,
      loop: true,
    };
  }
  if (category === "wave") {
    const wave = [baseOpacity * 0.35, baseOpacity, baseOpacity * 0.35];
    const shift = Math.floor(clamp01(waveT(u, key)) * wave.length) % wave.length;
    return {
      colors: [solid],
      opacity: rotate(wave, shift),
      durationSec: durationSec * 0.55,
      loop: true,
    };
  }
  if (category === "reactive") {
    const envelope = REACTIVE_ENVELOPE.map((f) => baseOpacity * f);
    const x = mirror(clamp01(key.x), u.orientation);
    const y = mirror(clamp01(key.y), u.orientation);
    const shift = Math.floor(x * envelope.length) + Math.floor(y * envelope.length) + key.index;
    return {
      colors: [solid],
      opacity: rotate(envelope, shift),
      durationSec: durationSec * 0.7,
      loop: true,
    };
  }
  // Breathing and static stay uniform across keys.
  return underglowAnimation(u);
}

const LED_SWATCH_RGB: Readonly<Record<number, [number, number, number]>> = {
  0: [229, 72, 77],
  1: [247, 107, 21],
  2: [255, 214, 10],
  3: [70, 167, 88],
  4: [18, 165, 148],
  5: [0, 145, 255],
  6: [142, 78, 198],
  7: [242, 242, 242],
  8: [0, 0, 0],
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export interface LedBarSample {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

/**
 * The side light bar's colour and brightness at `timeMs`, from the selected
 * mode / colour / saturation / rainbow. Pure and time-based so it renders the
 * same in a static frame (t = 0) as in the live loop.
 * Modes: 0 blink, 1 pulse rainbow, 2 alternating blink, 3 fixed, 4 alternating fixed.
 */
export function ledBarSample(led: LedState, timeMs: number): LedBarSample {
  if (led.color === 8) return { r: 0, g: 0, b: 0, a: 0 };
  const intensity = 0.3 + (led.saturation / 9) * 0.7;
  const base = LED_SWATCH_RGB[led.color] ?? LED_SWATCH_RGB[0];
  const t = timeMs / 1000;
  if (led.rainbow === 1 || led.mode === 1) {
    const [r, g, b] = hslToRgb(((t / 4) % 1) * 360, 0.85, 0.58);
    const pulse = led.mode === 1 ? 0.65 + 0.35 * Math.sin(t * 2.2) : 1;
    return { r, g, b, a: intensity * pulse };
  }
  const blink = Math.floor(t / 0.6) % 2 === 0;
  // The second colour of a "pair" isn't readable from the board; use a contrasting swatch.
  const pair = LED_SWATCH_RGB[(led.color + 4) % 8] ?? base;
  switch (led.mode) {
    case 0:
      return { r: base[0], g: base[1], b: base[2], a: blink ? intensity : 0.05 };
    case 2: {
      const c = blink ? base : pair;
      return { r: c[0], g: c[1], b: c[2], a: intensity };
    }
    case 4: {
      const c = Math.floor(t / 1.5) % 2 === 0 ? base : pair;
      return { r: c[0], g: c[1], b: c[2], a: intensity };
    }
    default:
      return { r: base[0], g: base[1], b: base[2], a: intensity };
  }
}

/** Maps side-LED state to a keyframe animation; the same input always yields the same output. */
export function ledAnimation(led: LedState): GlowAnimation {
  const off = led.color === 8;
  const [r, g, b] = LED_SWATCH_RGB[led.color] ?? LED_SWATCH_RGB[0];
  const solid = `rgb(${r}, ${g}, ${b})`;
  const intensity = 0.25 + (led.saturation / 9) * 0.75;

  if (off) {
    return { colors: ["transparent"], opacity: [0], durationSec: 1, loop: false };
  }
  if (led.rainbow === 1 || led.mode === 1) {
    const stops = rainbowStops(0);
    return { colors: stops, opacity: stops.map(() => intensity), durationSec: 3, loop: true };
  }
  if (led.mode === 0 || led.mode === 2) {
    return { colors: [solid], opacity: [intensity, 0.05, intensity, 0.05], durationSec: 1.2, loop: true };
  }
  // Fixed color / Fixed color (alternate)
  return { colors: [solid], opacity: [intensity], durationSec: 1, loop: false };
}

/** Plain-language brightness step, shared by the slider label and the board chip. */
export function brightnessWord(v: number): string {
  if (v === 0) return "Off";
  if (v <= 3) return "Dim";
  if (v <= 6) return "Medium";
  if (v <= 8) return "Bright";
  return "Vivid";
}

/** "Bright · 8/9" */
export function brightnessLabel(v: number): string {
  return `${brightnessWord(v)} · ${v}/9`;
}

/** Quantised ambient board colour (r g b, strength 0..1) so CSS vars only change on visible steps. */
export function ambientFrom(avg: { r: number; g: number; b: number } | null, k: number): { rgb: string; k: string } {
  if (!avg) return { rgb: "120 130 160", k: "0" };
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v / 6) * 6));
  return { rgb: `${q(avg.r)} ${q(avg.g)} ${q(avg.b)}`, k: (Math.round(Math.max(0, Math.min(1, k)) * 20) / 20).toFixed(2) };
}
