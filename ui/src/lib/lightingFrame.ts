import { capTint, keyIntensity, ledSample, type LedLighting } from "@/lib/ledField";
import { FRAME_STRIDE } from "@/lib/lightingPerf";

export interface KeyCoord {
  x: number;
  y: number;
}

export interface AmbientSample {
  r: number;
  g: number;
  b: number;
  /** Sum of key intensities (0 when the board is dark). */
  weight: number;
  /** Mean per-key power (0..1): how far the power-on wipe has travelled across the board. */
  power: number;
}

/** Share of the board width over which the power-on wipe fades a key in. */
const WIPE_FEATHER = 0.4;

/** Power of a key at normalised x for eased progress e: 0 before the wipe arrives, 1 once it passed. */
export function keyPower(e: number, x: number): number {
  if (e >= 1) return 1;
  const p = (e - x * (1 - WIPE_FEATHER)) / WIPE_FEATHER;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

/**
 * Samples the LED model once per key for one moment: colour, visible
 * intensity and cap tint go into `out` (FRAME_STRIDE floats per key), and the
 * intensity-weighted average colour is returned for the rim, spill and ambient light.
 * `e` is the eased power-on progress (0 dark, 1 fully lit): intensity and cap tint are
 * scaled per key by `keyPower`, which also lands in `powers` when given.
 */
export function sampleFrame(
  lighting: LedLighting,
  coords: readonly KeyCoord[],
  timeMs: number,
  out: Float32Array,
  e = 1,
  powers?: Float32Array,
): AmbientSample {
  let pw = 0;
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let aw = 0;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    const s = ledSample(lighting, c.x, c.y, i, timeMs);
    const p = keyPower(e, c.x);
    pw += p;
    if (powers) powers[i] = p;
    const inten = keyIntensity(lighting, s.intensity) * p;
    const o = i * FRAME_STRIDE;
    out[o] = Math.round(s.r);
    out[o + 1] = Math.round(s.g);
    out[o + 2] = Math.round(s.b);
    out[o + 3] = inten;
    out[o + 4] = capTint(inten);
    if (inten > 0) {
      ar += s.r * inten;
      ag += s.g * inten;
      ab += s.b * inten;
      aw += inten;
    }
  }
  return { r: aw > 0 ? ar / aw : 0, g: aw > 0 ? ag / aw : 0, b: aw > 0 ? ab / aw : 0, weight: aw, power: coords.length ? pw / coords.length : 0 };
}
