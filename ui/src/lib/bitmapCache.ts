/**
 * Decoded-image cache for the crop editor. A source is decoded once into an
 * ImageBitmap (capped at MAX_EDGE, which is far more than the 240×135 display
 * can show) and reused by every redraw and every slot switch.
 */
const MAX_EDGE = 1600;
const cache = new WeakMap<Uint8Array, Promise<ImageBitmap | null>>();
const ready = new WeakMap<Uint8Array, ImageBitmap>();

/** The decoded bitmap if it is already available, so slot switches can paint synchronously. */
export function peekBitmap(bytes: Uint8Array | null): ImageBitmap | null {
  return (bytes && ready.get(bytes)) || null;
}

export function getBitmap(bytes: Uint8Array): Promise<ImageBitmap | null> {
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

async function decode(bytes: Uint8Array): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const blob = new Blob([bytes as BlobPart]);
    const full = await createImageBitmap(blob);
    const edge = Math.max(full.width, full.height);
    if (edge <= MAX_EDGE) return full;
    const k = MAX_EDGE / edge;
    const small = await createImageBitmap(full, {
      resizeWidth: Math.round(full.width * k),
      resizeHeight: Math.round(full.height * k),
      resizeQuality: "high",
    });
    full.close();
    return small;
  } catch {
    return null;
  }
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
