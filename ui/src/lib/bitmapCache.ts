/**
 * Decoded-image cache for the crop editor. A source is decoded once into an
 * ImageBitmap (capped at MAX_EDGE, which is far more than the 240×135 display
 * can show) and reused by every redraw and every slot switch.
 */
const MAX_EDGE = 1600;

export type Source = CanvasImageSource & { width: number; height: number };
const cache = new WeakMap<Uint8Array, Promise<Source | null>>();
const ready = new WeakMap<Uint8Array, Source>();

/** The decoded bitmap if it is already available, so slot switches can paint synchronously. */
export function peekBitmap(bytes: Uint8Array | null): Source | null {
  return (bytes && ready.get(bytes)) || null;
}

export function getBitmap(bytes: Uint8Array): Promise<Source | null> {
  let hit = cache.get(bytes);
  if (!hit) {
    hit = decode(bytes).then((bmp) => {
      if (bmp) ready.set(bytes, bmp);
      return bmp;
    });
    cache.set(bytes, hit);
  }
  return hit;
}

/** Draws `src` into a canvas capped at MAX_EDGE; plain 2D drawing, no resize options (WebKit ignores them). */
function rasterize(src: Source): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !src.width || !src.height) return null;
  const k = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** True when a tiny downscale of `src` has any visible pixel; a blank bitmap would paint the editor black. */
function hasPixels(src: Source): boolean {
  if (typeof document === "undefined") return true;
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;
  try {
    ctx.drawImage(src, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  } catch {
    return true;
  }
}

async function viaImageElement(blob: Blob): Promise<HTMLCanvasElement | null> {
  if (typeof Image === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return rasterize(img);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decode(bytes: Uint8Array): Promise<Source | null> {
  const blob = new Blob([bytes as BlobPart]);
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      if (hasPixels(bmp)) {
        if (Math.max(bmp.width, bmp.height) <= MAX_EDGE) return bmp;
        const small = rasterize(bmp);
        bmp.close();
        if (small && hasPixels(small)) return small;
      } else {
        bmp.close();
      }
    } catch {
      // fall through to the <img> path
    }
  }
  const viaImg = await viaImageElement(blob);
  return viaImg && hasPixels(viaImg) ? viaImg : null;
}

/** Decode `url` off-thread so an <img> swapped to it paints immediately instead of flashing blank. */
export async function decodeUrl(url: string): Promise<void> {
  if (typeof Image === "undefined") return;
  const img = new Image();
  img.src = url;
  try {
    if (typeof img.decode === "function") await img.decode();
  } catch {
    // A failed pre-decode just falls back to the normal load path.
  }
}

/** Decode a slot's image during idle time so the first switch is instant. */
export function predecode(bytes: Uint8Array | null): void {
  if (!bytes) return;
  const run = () => void getBitmap(bytes);
  const w = globalThis as { requestIdleCallback?: (cb: () => void) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(run);
  else setTimeout(run, 50);
}

/** A ≤`size`px JPEG data URL of the image, for library thumbnails. */
export async function makeThumbnail(bytes: Uint8Array, size = 96): Promise<{ thumb: string; width: number; height: number }> {
  const bmp = await getBitmap(bytes);
  if (!bmp || typeof document === "undefined") return { thumb: "", width: 0, height: 0 };
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext("2d");
  if (!ctx) return { thumb: "", width: bmp.width, height: bmp.height };
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { thumb: c.toDataURL("image/jpeg", 0.8), width: bmp.width, height: bmp.height };
}
