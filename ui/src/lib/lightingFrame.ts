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
}

/**
 * Samples the LED model once per key for one moment: colour, visible
 * intensity and cap tint go into `out` (FRAME_STRIDE floats per key), and the
 * intensity-weighted average colour is returned for the rim, spill and ambient light.
 */
export function sampleFrame(lighting: LedLighting, coords: readonly KeyCoord[], timeMs: number, out: Float32Array): AmbientSample {
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let aw = 0;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    const s = ledSample(lighting, c.x, c.y, i, timeMs);
    const inten = keyIntensity(lighting, s.intensity);
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
  return { r: aw > 0 ? ar / aw : 0, g: aw > 0 ? ag / aw : 0, b: aw > 0 ? ab / aw : 0, weight: aw };
}
