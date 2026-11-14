export type Fit = "cover" | "contain";

export interface CropParams {
  offsetX: number;
  offsetY: number;
  zoom: number;
  fit: Fit;
}

export const DEFAULT_CROP: CropParams = { offsetX: 0, offsetY: 0, zoom: 1, fit: "cover" };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Wheel delta (positive = scroll down = zoom out), logarithmically. */
export function zoomBy(current: number, delta: number): number {
  return clamp(current * Math.exp(-delta * 0.002), MIN_ZOOM, MAX_ZOOM);
}

/** Pointer pixel delta inside a box of `boxWidth`×`boxHeight` → pan fractions. */
export function panBy(
  current: CropParams,
  dx: number,
  dy: number,
  boxWidth: number,
  boxHeight: number,
): CropParams {
  return {
    ...current,
    offsetX: clamp(current.offsetX + (dx / boxWidth) * 2, -1, 1),
    offsetY: clamp(current.offsetY + (dy / boxHeight) * 2, -1, 1),
  };
}

export const DISPLAY_W = 240;
export const DISPLAY_H = 135;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The same visible-source / destination maths the Rust renderer uses
 * (`render` in gmk87-protocol), expressed in fractional pixels so a client
 * canvas can draw the crop at any size without an IPC round trip.
 * `dst` is the area of a `destW`×`destH` canvas the image occupies.
 */
export function cropGeometry(
  srcW: number,
  srcH: number,
  crop: CropParams,
  destW: number,
  destH: number,
): { src: Rect; dst: Rect } {
  const target = DISPLAY_W / DISPLAY_H;
  const ratio = srcW / Math.max(1, srcH);
  let visW: number;
  let visH: number;
  if (crop.fit === "cover") {
    [visW, visH] = ratio > target ? [srcH * target, srcH] : [srcW, srcW / target];
  } else {
    [visW, visH] = ratio > target ? [srcW, srcW / target] : [srcH * target, srcH];
  }
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  visW /= zoom;
  visH /= zoom;
  const x0 = (Math.max(0, srcW - visW) / 2) * (1 + clamp(crop.offsetX, -1, 1));
  const y0 = (Math.max(0, srcH - visH) / 2) * (1 + clamp(crop.offsetY, -1, 1));
  const src = { x: x0, y: y0, w: Math.min(visW, srcW), h: Math.min(visH, srcH) };
  if (crop.fit === "cover") return { src, dst: { x: 0, y: 0, w: destW, h: destH } };
  const scale = Math.min(destW / src.w, destH / src.h);
  const w = src.w * scale;
  const h = src.h * scale;
  return { src, dst: { x: (destW - w) / 2, y: (destH - h) / 2, w, h } };
}

/** Draws `image` into `ctx` exactly as the device preview would frame it. */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  crop: CropParams,
  destW: number,
  destH: number,
): void {
  const { src, dst } = cropGeometry(image.width, image.height, crop, destW, destH);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, destW, destH);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h);
}

/** Stable identity of a crop, for "is this preview current" checks. */
export function cropKey(crop: CropParams): string {
  return `${crop.offsetX.toFixed(4)}|${crop.offsetY.toFixed(4)}|${crop.zoom.toFixed(4)}|${crop.fit}`;
}
