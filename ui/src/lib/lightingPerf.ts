/**
 * Settings and pacing for the live keyboard preview: which renderer draws the
 * per-key glow, how fast it animates, and when it should sleep.
 */

export type LightingMode = "auto" | "gpu" | "cpu" | "static";
export const LIGHTING_MODES: readonly LightingMode[] = ["auto", "gpu", "cpu", "static"];
export const LIGHTING_MODE_LABEL: Record<LightingMode, string> = { auto: "Auto", gpu: "GPU", cpu: "CPU", static: "Static" };

const MODE_KEY = "gmk87.lightingPreview.v1";

function isMode(v: unknown): v is LightingMode {
  return typeof v === "string" && (LIGHTING_MODES as readonly string[]).includes(v);
}

export function loadLightingMode(storage: Pick<Storage, "getItem"> | null = safeStorage()): LightingMode {
  try {
    const v = storage?.getItem(MODE_KEY);
    return isMode(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function saveLightingMode(mode: LightingMode, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(MODE_KEY, mode);
  } catch {
    // Storage can be blocked; the choice then lasts for this session only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let current: LightingMode | null = null;
const listeners = new Set<(m: LightingMode) => void>();

export function getLightingMode(): LightingMode {
  if (current === null) current = loadLightingMode();
  return current;
}

export function setLightingMode(mode: LightingMode): void {
  current = mode;
  saveLightingMode(mode);
  for (const fn of [...listeners]) fn(mode);
}

export function subscribeLightingMode(fn: (m: LightingMode) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test hook: forget the cached mode so the next read hits storage again. */
export function resetLightingModeCache(): void {
  current = null;
}

export type Renderer = "gl" | "2d" | "static";

/** True when a throwaway canvas can create a WebGL2 context. */
export function webgl2Available(make: () => { getContext: (id: string) => unknown } | null = defaultCanvas): boolean {
  try {
    const c = make();
    return Boolean(c && c.getContext("webgl2"));
  } catch {
    return false;
  }
}

function defaultCanvas(): { getContext: (id: string) => unknown } | null {
  return typeof document === "undefined" ? null : document.createElement("canvas");
}

/** Which renderer a mode asks for; GPU and Auto fall back to 2D when WebGL2 is missing. */
export function chooseRenderer(mode: LightingMode, glAvailable: boolean): Renderer {
  if (mode === "static") return "static";
  if (mode === "cpu") return "2d";
  return glAvailable ? "gl" : "2d";
}

/** Frame-rate tiers the adaptive controller steps through. */
export const FPS_TIERS = [60, 30, 15] as const;

/**
 * Picks the preview frame rate from measured frame cost (ms of main-thread work per draw).
 * Drops a tier when the rolling average exceeds `DOWN` of that tier's frame budget and
 * climbs back only when it would sit comfortably under `UP` of the faster tier's budget.
 */
export class AdaptiveQuality {
  static readonly WINDOW = 24;
  static readonly COOLDOWN = 36;
  static readonly DOWN = 0.6;
  static readonly UP = 0.25;

  private costs: number[] = [];
  private since = 0;
  tier = 0;

  constructor(startTier = 0) {
    this.tier = Math.min(FPS_TIERS.length - 1, Math.max(0, startTier));
  }

  get fps(): number {
    return FPS_TIERS[this.tier];
  }

  /** Feed one draw cost; returns the frame rate to use next. */
  push(drawMs: number): number {
    this.costs.push(drawMs);
    if (this.costs.length > AdaptiveQuality.WINDOW) this.costs.shift();
    this.since++;
    if (this.costs.length < AdaptiveQuality.WINDOW || this.since < AdaptiveQuality.COOLDOWN) return this.fps;
    const avg = this.costs.reduce((a, b) => a + b, 0) / this.costs.length;
    if (this.tier < FPS_TIERS.length - 1 && avg > (1000 / this.fps) * AdaptiveQuality.DOWN) {
      this.tier++;
      this.reset();
    } else if (this.tier > 0 && avg < (1000 / FPS_TIERS[this.tier - 1]) * AdaptiveQuality.UP) {
      this.tier--;
      this.reset();
    }
    return this.fps;
  }

  private reset(): void {
    this.costs = [];
    this.since = 0;
  }
}

/** Floats per key in a packed glow frame: r, g, b (0..255), intensity (0..1), cap tint alpha. */
export const FRAME_STRIDE = 5;

/** Floats per GL instance: rect (x, y, w, h), atlas uv (u0, v0, u1, v1), colour r g b (0..1), intensity. */
export const INSTANCE_STRIDE = 12;

export interface PackedKey {
  /** Sprite rect in canvas pixels (already offset by the mask origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Atlas rect in texels. */
  ax: number;
  ay: number;
}

/** Packs per-key placement + colour into the instance buffer; returns the number of instances written. */
export function packInstances(
  keys: readonly PackedKey[],
  frame: Float32Array,
  atlasW: number,
  atlasH: number,
  out: Float32Array,
): number {
  let n = 0;
  for (let k = 0; k < keys.length; k++) {
    const i = frame[k * FRAME_STRIDE + 3];
    if (i <= 0.004) continue;
    const key = keys[k];
    const o = n * INSTANCE_STRIDE;
    out[o] = key.x;
    out[o + 1] = key.y;
    out[o + 2] = key.w;
    out[o + 3] = key.h;
    out[o + 4] = key.ax / atlasW;
    out[o + 5] = key.ay / atlasH;
    out[o + 6] = (key.ax + key.w) / atlasW;
    out[o + 7] = (key.ay + key.h) / atlasH;
    out[o + 8] = frame[k * FRAME_STRIDE] / 255;
    out[o + 9] = frame[k * FRAME_STRIDE + 1] / 255;
    out[o + 10] = frame[k * FRAME_STRIDE + 2] / 255;
    out[o + 11] = i;
    n++;
  }
  return n;
}

/** Quantises a colour channel to `bits` bits, as used for the page-wide ambient colour. */
export function quantise(v: number, bits: number): number {
  const steps = (1 << bits) - 1;
  return Math.round((Math.max(0, Math.min(255, v)) / 255) * steps) * Math.round(255 / steps);
}

/** Limits a callback to `hz` calls per second given a monotonically increasing clock. */
export function rateGate(hz: number): (now: number) => boolean {
  let last = -Infinity;
  const gap = 1000 / hz;
  return (now) => {
    if (now - last < gap) return false;
    last = now;
    return true;
  };
}
