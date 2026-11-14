/**
 * Pre-rendered light masks for one keycap size, shared by the 2D and WebGL
 * glow renderers so both draw exactly the same shapes.
 *
 * The board used to build each key's glow from four blurred CSS layers
 * (halo, gap light, row bleed, seam + shadow). Here the same geometry is
 * rasterised once per key size into alpha masks, with the blur applied on the
 * CPU (no `ctx.filter`, which WebKit lacks). Per frame a key only needs its
 * colour and intensity: masks are combined as `alpha = f(intensity) * mask`.
 */

export interface GlowMasks {
  width: number;
  height: number;
  /** Key's top-left corner inside the mask, in mask pixels. */
  ox: number;
  oy: number;
  /** R = halo basis at the centre stop, G = halo basis at the 55% stop, B = gap light, A = row bleed. */
  a: Uint8ClampedArray;
  /** R = seam shadow (outside the seam only), G = seam body. */
  b: Uint8ClampedArray;
}

/** Spill margin (CSS px) kept around the union of all layers so no blur is clipped. */
const PAD = 30;
const SEAM_SPREAD = 3;

/** Normalised 1-D Gaussian kernel for a standard deviation in pixels. */
export function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Separable Gaussian blur of a single-channel float image, in place. */
export function blurInPlace(data: Float32Array, w: number, h: number, sigma: number): void {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      const lo = Math.max(0, x - r);
      const hi = Math.min(w - 1, x + r);
      for (let xx = lo; xx <= hi; xx++) acc += data[row + xx] * k[xx - x + r];
      tmp[row + x] = acc;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const lo = Math.max(0, y - r);
      const hi = Math.min(h - 1, y + r);
      for (let yy = lo; yy <= hi; yy++) acc += tmp[yy * w + x] * k[yy - y + r];
      data[y * w + x] = acc;
    }
  }
}

/** Fraction of the unit pixel [p, p+1) (in CSS units, `size` wide) that lies inside [lo, hi]. */
function overlap(p: number, size: number, lo: number, hi: number): number {
  const a = Math.max(p, lo);
  const b = Math.min(p + size, hi);
  return b > a ? (b - a) / size : 0;
}

const to8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Rasterises and blurs every mask for a key of `w`×`h` CSS px at `scale` device px per CSS px. */
export function buildGlowMasks(w: number, h: number, scale: number): GlowMasks {
  const minX = -0.06 * w - PAD;
  const maxX = 1.06 * w + PAD;
  const minY = -0.02 * h - PAD;
  const maxY = 1.72 * h + 3 + PAD;
  const width = Math.ceil((maxX - minX) * scale);
  const height = Math.ceil((maxY - minY) * scale);
  const ox = -minX * scale;
  const oy = -minY * scale;
  const px = 1 / scale;
  const n = width * height;

  const halo0 = new Float32Array(n);
  const halo1 = new Float32Array(n);
  const gap = new Float32Array(n);
  const band = new Float32Array(n);
  const seamBody = new Float32Array(n);
  const seamHalo = new Float32Array(n);

  // Layer boxes in key-relative CSS px, copied from the original CSS.
  const L1 = { x0: -0.05 * w, x1: 1.05 * w, y0: -0.02 * h + 3, y1: 1.7 * h + 3 };
  const L2 = { x0: -0.06 * w, x1: 1.06 * w, y0: 0.75 * h, y1: 1.55 * h };
  const L3 = { x0: -0.04 * w, x1: 1.04 * w, y0: h, y1: 1.34 * h };
  const seam = { cx: 0.5 * w, cy: 1.06 * h, rx: 0.42 * w, ry: 0.06 * h };

  const l1w = L1.x1 - L1.x0;
  const l1h = L1.y1 - L1.y0;
  const l1cx = L1.x0 + l1w * 0.5;
  const l1cy = L1.y0 + l1h * 0.62;
  const l1rx = l1w * 0.7;
  const l1ry = l1h * 0.62;
  const l2w = L2.x1 - L2.x0;
  const l2h = L2.y1 - L2.y0;
  const l2cx = L2.x0 + l2w * 0.5;
  const l2cy = L2.y0 + l2h * 0.3;
  const l2rx = l2w * 0.62;
  const l2ry = l2h * 0.7;

  for (let y = 0; y < height; y++) {
    const cy = (y - oy) * px;
    const cyc = cy + px / 2;
    for (let x = 0; x < width; x++) {
      const cx = (x - ox) * px;
      const cxc = cx + px / 2;
      const i = y * width + x;

      const c1 = overlap(cx, px, L1.x0, L1.x1) * overlap(cy, px, L1.y0, L1.y1);
      if (c1 > 0) {
        const t = Math.hypot((cxc - l1cx) / l1rx, (cyc - l1cy) / l1ry);
        if (t < 1) {
          const lo = t < 0.55 ? 1 - t / 0.55 : 0;
          const hi = t < 0.55 ? t / 0.55 : 1 - (t - 0.55) / 0.45;
          halo0[i] = lo * c1;
          halo1[i] = hi * c1;
        }
      }
      const c2 = overlap(cx, px, L2.x0, L2.x1) * overlap(cy, px, L2.y0, L2.y1);
      if (c2 > 0) {
        const t = Math.hypot((cxc - l2cx) / l2rx, (cyc - l2cy) / l2ry);
        if (t < 0.78) gap[i] = (1 - t / 0.78) * c2;
      }
      band[i] = overlap(cx, px, L3.x0, L3.x1) * overlap(cy, px, L3.y0, L3.y1);

      // Seam: 3x3 supersampled ellipse for the crisp body, plain ellipse for its spread shadow.
      let body = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const ex = (cx + ((sx + 0.5) / 3) * px - seam.cx) / seam.rx;
          const ey = (cy + ((sy + 0.5) / 3) * px - seam.cy) / seam.ry;
          if (ex * ex + ey * ey <= 1) body++;
        }
      }
      seamBody[i] = body / 9;
      const sx2 = (cxc - seam.cx) / (seam.rx + SEAM_SPREAD);
      const sy2 = (cyc - (seam.cy + 1)) / (seam.ry + SEAM_SPREAD);
      seamHalo[i] = sx2 * sx2 + sy2 * sy2 <= 1 ? 1 : 0;
    }
  }

  blurInPlace(halo0, width, height, 3 * scale);
  blurInPlace(halo1, width, height, 3 * scale);
  blurInPlace(gap, width, height, 4 * scale);
  blurInPlace(band, width, height, 9 * scale);
  blurInPlace(seamHalo, width, height, 4.5 * scale);

  const a = new Uint8ClampedArray(n * 4);
  const b = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = to8(halo0[i]);
    a[i * 4 + 1] = to8(halo1[i]);
    a[i * 4 + 2] = to8(gap[i]);
    a[i * 4 + 3] = to8(band[i]);
    // A box-shadow is only painted outside the element's own shape.
    b[i * 4] = to8(seamHalo[i] * (1 - seamBody[i]));
    b[i * 4 + 1] = to8(seamBody[i]);
  }
  return { width, height, ox, oy, a, b };
}

/**
 * Alpha of the screen-blended light one key adds at a pixel: the union of the halo, gap light
 * and row bleed, all in the LED colour. (The seam line and its shadow are blended normally, on
 * their own layer, see `SeamLayer`.)
 */
export function composePixel(m: { h0: number; h1: number; gap: number; band: number }, intensity: number): number {
  const i = intensity;
  const a1 = Math.min(1, 2 * i) * m.h0 + Math.min(1, 1.2 * i) * m.h1;
  const a2 = Math.min(1, 1.4 * i) * m.gap;
  const a3 = Math.min(1, 0.9 * i) * m.band;
  return 1 - (1 - a1) * (1 - a2) * (1 - a3);
}

/** One intensity level of a key's glow as a white alpha mask, tinted with the LED colour when drawn. */
export function composeLevel(masks: GlowMasks, intensity: number): Uint8ClampedArray {
  const n = masks.width * masks.height;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const a = composePixel(
      { h0: masks.a[p * 4] / 255, h1: masks.a[p * 4 + 1] / 255, gap: masks.a[p * 4 + 2] / 255, band: masks.a[p * 4 + 3] / 255 },
      intensity,
    );
    out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = 255;
    out[p * 4 + 3] = to8(a);
  }
  return out;
}
