import { labeledKeys } from "@/components/keyboard";
import { capTint, keyIntensity, ledSample, type LedLighting } from "@/lib/ledField";

/** Simplified real key layout: one rect per key, in the board's own coordinates. */
export interface ThumbKey {
  /** Left/top/width/height as fractions (0..1) of the key field's bounding box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre, 0..1, for the LED model. */
  cx: number;
  cy: number;
}

let layoutCache: { keys: ThumbKey[]; aspect: number } | null = null;

/** Key rects normalised to their bounding box, plus the box's width / height. */
export function thumbLayout(): { keys: ThumbKey[]; aspect: number } {
  if (layoutCache) return layoutCache;
  const src = labeledKeys();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of src) {
    minX = Math.min(minX, k.position[0] - k.size[0] / 2);
    maxX = Math.max(maxX, k.position[0] + k.size[0] / 2);
    minY = Math.min(minY, k.position[1] - k.size[1] / 2);
    maxY = Math.max(maxY, k.position[1] + k.size[1] / 2);
  }
  const W = maxX - minX;
  const H = maxY - minY;
  const keys = src.map((k) => {
    const x = (k.position[0] - k.size[0] / 2 - minX) / W;
    const y = (k.position[1] - k.size[1] / 2 - minY) / H;
    const w = k.size[0] / W;
    const h = k.size[1] / H;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  });
  layoutCache = { keys, aspect: W / H };
  return layoutCache;
}

const peakCache = new Map<number, number>();
/** Resting-frame time (ms at speed 3): the scanned frame with the widest spread of key brightness. */
export function peakTime(effect: number): number {
  const hit = peakCache.get(effect);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestScore = -1;
  for (let t = 0; t < 1600; t += 40) {
    const is = thumbFrame({ effect, brightness: 9, speed: 3, orientation: 0, rainbow: 0, color: [255, 255, 255] }, t).map((k) => k.i);
    const mean = is.reduce((a, v) => a + v, 0) / is.length;
    const score = is.reduce((a, v) => a + (v - mean) ** 2, 0) / is.length;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = t;
    }
  }
  peakCache.set(effect, best);
  return best;
}

/** Per-key colour and intensity for one frame; shared by the canvas draw and tests. */
export function thumbFrame(l: LedLighting, t: number): Array<{ r: number; g: number; b: number; i: number; tint: number }> {
  const { keys } = thumbLayout();
  return keys.map((k, idx) => {
    const s = ledSample(l, k.cx, k.cy, idx, t);
    const i = keyIntensity(l, s.intensity);
    return { r: Math.round(s.r), g: Math.round(s.g), b: Math.round(s.b), i, tint: capTint(i) };
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the mini board (black case, white caps, light from under each cap) into a w x h canvas. */
export function drawBoardThumb(ctx: CanvasRenderingContext2D, w: number, h: number, l: LedLighting, t: number) {
  ctx.clearRect(0, 0, w, h);
  const pad = Math.max(2, h * 0.07);
  ctx.fillStyle = "#0b0c10";
  roundRect(ctx, 0, 0, w, h, Math.min(w, h) * 0.08);
  ctx.fill();
  const bw = w - pad * 2;
  const bh = h - pad * 2;
  const frame = thumbFrame(l, t);
  const { keys } = thumbLayout();
  const gap = Math.max(0.6, bw * 0.0016);
  // Pass 1: light spilling from the bottom of each cap into the gap and onto the case.
  ctx.globalCompositeOperation = "lighter";
  for (let n = 0; n < keys.length; n++) {
    const f = frame[n];
    if (f.i <= 0.01) continue;
    const k = keys[n];
    const kx = pad + k.x * bw;
    const ky = pad + k.y * bh;
    const kw = k.w * bw;
    const kh = k.h * bh;
    const g = ctx.createRadialGradient(kx + kw / 2, ky + kh * 1.05, 0, kx + kw / 2, ky + kh * 1.05, Math.max(kw, kh) * 0.9);
    g.addColorStop(0, `rgba(${f.r},${f.g},${f.b},${Math.min(0.85, f.i * 0.85)})`);
    g.addColorStop(1, `rgba(${f.r},${f.g},${f.b},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(kx - kw * 0.3, ky + kh * 0.5, kw * 1.6, kh * 1.1);
  }
  ctx.globalCompositeOperation = "source-over";
  // Pass 2: white caps with a faint lower-third wash of the LED colour.
  for (let n = 0; n < keys.length; n++) {
    const f = frame[n];
    const k = keys[n];
    const kx = pad + k.x * bw + gap;
    const ky = pad + k.y * bh + gap;
    const kw = k.w * bw - gap * 2;
    const kh = k.h * bh - gap * 2;
    const r = Math.min(kw, kh) * 0.2;
    const g = ctx.createLinearGradient(0, ky, 0, ky + kh);
    g.addColorStop(0, "#fbfbfc");
    g.addColorStop(0.55, "#eceef2");
    g.addColorStop(1, `rgb(${Math.round(220 + (f.r - 220) * f.tint * 1.6)},${Math.round(223 + (f.g - 223) * f.tint * 1.6)},${Math.round(230 + (f.b - 230) * f.tint * 1.6)})`);
    ctx.fillStyle = g;
    roundRect(ctx, kx, ky, kw, kh, r);
    ctx.fill();
  }
}

type Listener = (now: number) => void;
const listeners = new Set<Listener>();
let raf = 0;
let last = 0;

function tick(now: number) {
  if (listeners.size === 0) {
    raf = 0;
    return;
  }
  if (!document.hidden && now - last >= 33) {
    last = now;
    for (const fn of [...listeners]) fn(now);
  }
  raf = requestAnimationFrame(tick);
}

/** One shared rAF timer for every live tile; it stops itself when nobody subscribes. */
export function subscribeThumbClock(fn: Listener): () => void {
  listeners.add(fn);
  if (!raf && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(tick);
  return () => {
    listeners.delete(fn);
  };
}
