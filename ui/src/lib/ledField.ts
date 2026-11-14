/**
 * The per-key LED model: a pure, deterministic function from lighting state +
 * a key's position to the colour that key's LED shows at a moment in time.
 *
 * No randomness, no DOM — the keyboard preview samples it per key inside a
 * canvas loop, and the effect gallery samples it for static thumbnails.
 */

export interface LedLighting {
  effect: number;
  brightness: number;
  speed: number;
  orientation: number;
  rainbow: number;
  color: [number, number, number];
}

export interface LedSample {
  r: number;
  g: number;
  b: number;
  /** 0..1 luminance multiplier; brightness 0 forces 0. */
  intensity: number;
}

const TAU = Math.PI * 2;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function frac(v: number): number {
  return v - Math.floor(v);
}

/** A deterministic hash in 0..1 — stands in for Math.random without randomness. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 0..1 wave: one full cycle per unit of x. */
function wave(x: number): number {
  return 0.5 + 0.5 * Math.cos(TAU * x);
}

/** Animation rate in cycles/second. Device speed 0 is the fastest. */
function rate(speed: number): number {
  return 0.25 + ((9 - clamp(speed, 0, 9)) / 9) * 1.5;
}

/** HSV (h in degrees) to 0..255 RGB. */
function hsv(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** 0..255 RGB to HSV (h in degrees, s/v in 0..1). */
function rgbToHsv([r, g, b]: [number, number, number]): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

/**
 * Samples one key's LED.
 *
 * @param x, y   0..1 across the key field (left→right, top→bottom)
 * @param keyIndex per-key identity for pressed-key / random effects
 * @param timeMs milliseconds on the animation clock
 */
export function ledSample(
  l: LedLighting,
  x: number,
  y: number,
  keyIndex: number,
  timeMs: number,
): LedSample {
  const nx = clamp01(x);
  const ny = clamp01(y);
  const mx = l.orientation === 1 ? 1 - nx : nx;
  const my = l.orientation === 1 ? 1 - ny : ny;
  const brightness = clamp(l.brightness, 0, 9) / 9;
  const speed = clamp(l.speed, 0, 9);
  const rawPhase = (rate(speed) * timeMs) / 1000; // continuous, for cos-based effects
  const phase = frac(rawPhase); // cyclic, for hue / triangle effects
  const d = clamp01(Math.hypot(nx - 0.5, ny - 0.5) / Math.hypot(0.5, 0.5));
  const color = l.color;
  let f = 0;
  let rgb: [number, number, number] = color;

  if (l.effect !== 0) {
    switch (l.effect) {
      case 1: {
        // Drift: a soft dimming wave travelling left→right.
        f = 0.12 + 0.88 * wave(mx - rawPhase);
        break;
      }
      case 2: {
        // Pulse drift: one sharp pulse sweeping across.
        const q = frac(mx - rawPhase);
        f = q < 0.18 ? Math.pow(1 - q / 0.18, 1.4) : 0.04;
        break;
      }
      case 3: {
        // Rain shower: soft bands falling top→bottom.
        f = 0.1 + 0.9 * wave(my * 1.6 - rawPhase);
        break;
      }
      case 4: {
        // Colour spectrum: hues cycle across the board.
        rgb = hsv((mx + phase) * 360, 0.85, 1);
        f = 0.95;
        break;
      }
      case 5: {
        // Breathe: the whole board brightens and dims together.
        f = 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(TAU * rawPhase));
        break;
      }
      case 6: {
        // Steady glow.
        f = 1;
        break;
      }
      case 7: {
        // Tap glow: each key twinkles on its own deterministic phase.
        const h = hash(keyIndex + 0.37);
        const glint = Math.max(0, Math.cos(TAU * (rawPhase * 2 + h)));
        f = 0.05 + 0.95 * Math.pow(glint, 5);
        break;
      }
      case 8: {
        // Ripple spread: rings expanding from the centre.
        f = 0.06 + 0.94 * Math.pow(wave(d * 1.5 - rawPhase), 2);
        break;
      }
      case 9: {
        // Row sweep: a soft band of rows lighting in turn.
        const q = frac(my - rawPhase);
        f = q < 0.25 ? Math.sin((q / 0.25) * Math.PI) : 0.07;
        break;
      }
      case 10: {
        // Flicker: every key flips brightness a couple of times a second.
        const step = Math.floor(timeMs / 400);
        f = 0.08 + 0.92 * hash(keyIndex * 3.71 + step * 17.77);
        break;
      }
      case 11: {
        // Rainbow cycle: the whole board shifts through the spectrum together.
        rgb = hsv(phase * 360, 0.85, 1);
        f = 1;
        break;
      }
      case 12: {
        // Rainbow waterfall: hue by row, bands falling top→bottom.
        rgb = hsv((my + phase) * 360, 0.85, 1);
        const q = frac(my * 1.5 - rawPhase);
        f = q < 0.3 ? Math.pow(1 - q / 0.3, 1.2) : 0.15;
        break;
      }
      case 13: {
        // Ripple centre: one wave spreading out from the middle.
        f = 0.08 + 0.92 * wave(d - rawPhase);
        break;
      }
      case 14: {
        // Orbit: a bright arc circling the centre of the board.
        const ang = frac(Math.atan2(ny - 0.5, nx - 0.5) / TAU + 0.5);
        f = 0.08 + 0.92 * wave(ang - rawPhase);
        break;
      }
      case 15: {
        // Downpour: falling streaks with per-column timing.
        const col = Math.floor(nx * 12);
        const off = hash(col * 5.37);
        const q = frac(my * 1.3 - rawPhase - off);
        f = q < 0.22 ? Math.pow(1 - q / 0.22, 1.3) : 0.09;
        break;
      }
      case 16: {
        // Tide: a wave that sweeps left then comes back.
        const tri = 1 - Math.abs(2 * phase - 1);
        const dd = (mx - tri) * 2.4;
        f = 0.08 + 0.92 * Math.exp(-dd * dd);
        break;
      }
      case 17: {
        // Slow hue breathing: hue fixed, saturation slowly breathes.
        const [h0, s0] = rgbToHsv(color);
        const breath = 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(TAU * rawPhase * 0.5));
        rgb = hsv(h0, s0 * breath, 1);
        f = 0.9;
        break;
      }
      case 18: {
        // Slow rainbow: hue varies radially and drifts slowly.
        rgb = hsv((d + rawPhase * 0.5) * 360, 0.85, 1);
        f = 0.9;
        break;
      }
      default: {
        f = 1;
        break;
      }
    }

    // The rainbow flag forces hue cycling on top of any effect.
    if (l.rainbow === 1) {
      rgb = hsv((mx + phase) * 360, 0.85, 1);
    }
  }

  return {
    r: clamp(rgb[0], 0, 255),
    g: clamp(rgb[1], 0, 255),
    b: clamp(rgb[2], 0, 255),
    intensity: clamp01(f) * brightness,
  };
}

/** A sample as a CSS colour; alpha defaults to the sample's intensity. */
export function ledCss(s: LedSample, alpha?: number): string {
  const a = alpha ?? s.intensity;
  return `rgba(${Math.round(s.r)}, ${Math.round(s.g)}, ${Math.round(s.b)}, ${clamp01(a).toFixed(3)})`;
}

/**
 * Eight samples left→right across the middle of the board, as CSS colours
 * with alpha baked in — the static effect thumbnails.
 */
export function ledStops(l: LedLighting, timeMs = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) / 8;
    const s = ledSample(l, x, 0.5, Math.round(x * 80), timeMs);
    out.push(ledCss(s, s.intensity <= 0.004 ? 0 : 0.15 + 0.85 * s.intensity));
  }
  return out;
}

/**
 * A rows x cols grid of samples as CSS colours (alpha baked in, normalised to
 * full brightness so thumbnails read at full hue) — row-based effects read
 * vertically and ripples read from the centre.
 */
export function ledGrid(l: LedLighting, timeMs: number, rows: number, cols: number): string[][] {
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) / rows;
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols;
      const s = ledSample(l, x, y, r * cols + c, timeMs);
      const peak = clamp(l.brightness, 0, 9) / 9 || 1;
      const i = clamp01(s.intensity / peak);
      row.push(ledCss(s, i <= 0.004 ? 0 : 0.1 + 0.9 * Math.pow(i, 2.2)));
    }
    out.push(row);
  }
  return out;
}

/** Dim base underglow every lit key keeps so the whole board reads as an LED field. */
export const KEY_FLOOR = 0.18;

/**
 * The visible intensity (0..1) a key's LED is drawn at. Effects that do not
 * turn the board off keep a dim floor under every key; lit keys are pushed up
 * with a contrast curve so waves, ripples and rain stand out against it.
 * Brightness 0 and the Off effect stay fully dark.
 */
export function keyIntensity(l: Pick<LedLighting, "effect" | "brightness">, sampled: number): number {
  if (l.effect === 0) return 0;
  const bn = clamp01(l.brightness / 9);
  if (bn === 0) return 0;
  const v = clamp01(sampled / bn);
  const scale = 0.4 + 0.6 * bn;
  return clamp01((KEY_FLOOR + (1 - KEY_FLOOR) * Math.pow(v, 2)) * scale);
}
