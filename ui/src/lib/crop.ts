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
