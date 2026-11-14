import { buildGlowMasks, composeLevel, type GlowMasks } from "@/lib/glowAtlas";
import { FRAME_STRIDE, INSTANCE_STRIDE, packInstances, type PackedKey } from "@/lib/lightingPerf";

/** A key's cap rectangle in CSS px, relative to the glow canvas. */
export interface KeyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlowRenderer {
  readonly kind: "2d" | "gl";
  /** Lay out for a canvas of `cssW`×`cssH` CSS px; `scale` is device px per CSS px. */
  resize(cssW: number, cssH: number, keys: readonly KeyRect[], scale: number): void;
  /** Draw one frame; `frame` holds FRAME_STRIDE floats per key. */
  draw(frame: Float32Array): void;
  dispose(): void;
}

/** Quantisation of intensity for the 2D sprite cache (1/LEVELS steps). */
const LEVELS = 24;

const maskCache = new Map<string, GlowMasks>();
function masksFor(w: number, h: number, scale: number): GlowMasks {
  const key = `${w.toFixed(2)}x${h.toFixed(2)}@${scale}`;
  let hit = maskCache.get(key);
  if (!hit) {
    hit = buildGlowMasks(w, h, scale);
    maskCache.set(key, hit);
    if (maskCache.size > 48) maskCache.delete(maskCache.keys().next().value as string);
  }
  return hit;
}

interface KeyClass {
  masks: GlowMasks;
  /** Distinct (width, height) classes share masks; keys differ only by position. */
  levels: Map<number, HTMLCanvasElement>;
  scratch: HTMLCanvasElement | null;
}

function classOf(rects: readonly KeyRect[], scale: number): { classes: KeyClass[]; keyClass: number[] } {
  const ids = new Map<string, number>();
  const classes: KeyClass[] = [];
  const keyClass = rects.map((r) => {
    const id = `${Math.round(r.w * scale)}x${Math.round(r.h * scale)}`;
    let n = ids.get(id);
    if (n === undefined) {
      n = classes.length;
      ids.set(id, n);
      classes.push({ masks: masksFor(r.w, r.h, scale), levels: new Map(), scratch: null });
    }
    return n;
  });
  return { classes, keyClass };
}

function toCanvas(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")?.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c;
}

export class Glow2D implements GlowRenderer {
  readonly kind = "2d" as const;
  private ctx: CanvasRenderingContext2D;
  private classes: KeyClass[] = [];
  private keyClass: number[] = [];
  private rects: KeyRect[] = [];
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, keys: readonly KeyRect[], scale: number): void {
    this.scale = scale;
    this.canvas.width = Math.max(1, Math.round(cssW * scale));
    this.canvas.height = Math.max(1, Math.round(cssH * scale));
    this.rects = [...keys];
    const g = classOf(this.rects, scale);
    this.classes = g.classes;
    this.keyClass = g.keyClass;
  }

  private level(cls: KeyClass, q: number) {
    let lv = cls.levels.get(q);
    if (!lv) {
      lv = toCanvas(composeLevel(cls.masks, q / LEVELS), cls.masks.width, cls.masks.height);
      cls.levels.set(q, lv);
    }
    return lv;
  }

  /** Tints `mask` (white, alpha only) with `rgb` on the scratch canvas and screens it onto the board. */
  private screen(cls: KeyClass, mask: HTMLCanvasElement, rgb: string, dx: number, dy: number): void {
    const sctx = cls.scratch?.getContext("2d");
    if (!sctx || !cls.scratch) return;
    const m = cls.masks;
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, m.width, m.height);
    sctx.fillStyle = rgb;
    sctx.fillRect(0, 0, m.width, m.height);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(mask, 0, 0);
    this.ctx.drawImage(cls.scratch, dx, dy);
  }

  draw(frame: Float32Array): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Opaque black screens to nothing; every key's light is then screen-blended on top.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = "screen";
    for (let k = 0; k < this.rects.length; k++) {
      const o = k * FRAME_STRIDE;
      const i = frame[o + 3];
      if (i <= 0.004) continue;
      const cls = this.classes[this.keyClass[k]];
      const lv = this.level(cls, Math.max(1, Math.round(i * LEVELS)));
      const m = cls.masks;
      if (!cls.scratch) {
        cls.scratch = document.createElement("canvas");
        cls.scratch.width = m.width;
        cls.scratch.height = m.height;
      }
      const r = this.rects[k];
      const dx = Math.round(r.x * this.scale - m.ox);
      const dy = Math.round(r.y * this.scale - m.oy);
      const R = frame[o];
      const G = frame[o + 1];
      const B = frame[o + 2];
      this.screen(cls, lv, `rgb(${R},${G},${B})`, dx, dy);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  dispose(): void {
    this.classes = [];
    this.rects = [];
  }
}

const VERT = `#version 300 es
in vec2 aCorner;
in vec4 aRect;
in vec4 aUv;
in vec4 aCol;
uniform vec2 uSize;
out vec2 vUv;
out vec4 vCol;
void main() {
  vec2 p = aRect.xy + aCorner * aRect.zw;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
  vUv = mix(aUv.xy, aUv.zw, aCorner);
  vCol = aCol;
}`;

/**
 * Light is screen-blended, like the original CSS layers: every layer of every key multiplies
 * the "darkness" (1 - colour) of what is below, so the sum is order independent. Each key
 * outputs 1 - prod(1 - alpha * colour) and the blend func `ONE, ONE_MINUS_SRC_COLOR` accumulates it.
 */
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vCol;
uniform sampler2D uA;
out vec4 o;
void main() {
  vec4 m = texture(uA, vUv);
  float i = vCol.a;
  vec3 c = vCol.rgb;
  float a1 = min(1.0, 2.0 * i) * m.r + min(1.0, 1.2 * i) * m.g;
  float a2 = min(1.0, 1.4 * i) * m.b;
  float a3 = min(1.0, 0.9 * i) * m.a;
  vec3 dark = (1.0 - a1 * c) * (1.0 - a2 * c) * (1.0 - a3 * c);
  o = vec4(1.0 - dark, 0.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${gl.getShaderInfoLog(sh) ?? "shader error"}`);
  return sh;
}

/** One instanced draw of every lit key's glow quad on the GPU. */
export class GlowGL implements GlowRenderer {
  readonly kind = "gl" as const;
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private instanceBuf!: WebGLBuffer;
  private texA: WebGLTexture | null = null;
  private keys: PackedKey[] = [];
  private data = new Float32Array(0);
  private atlas = { w: 1, h: 1 };
  private lost = false;
  private verified = false;
  private cssW = 1;
  private cssH = 1;
  private uSize: WebGLUniformLocation | null = null;
  private onLost: (() => void) | undefined;
  private lastLayout: { keys: readonly KeyRect[]; scale: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    onLost?: () => void,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.onLost = onLost;
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
    this.init();
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onLost?.();
  };

  private handleRestored = () => {
    this.lost = false;
    this.init();
    if (this.lastLayout) this.resize(this.cssW, this.cssH, this.lastLayout.keys, this.lastLayout.scale);
  };

  private init(): void {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error("createProgram failed");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    this.program = prog;
    this.uSize = gl.getUniformLocation(prog, "uSize");
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, "uA"), 0);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("createVertexArray failed");
    this.vao = vao;
    gl.bindVertexArray(vao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aCorner = gl.getAttribLocation(prog, "aCorner");
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    const inst = gl.createBuffer();
    if (!inst) throw new Error("createBuffer failed");
    this.instanceBuf = inst;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const stride = INSTANCE_STRIDE * 4;
    for (const [name, off] of [["aRect", 0], ["aUv", 16], ["aCol", 32]] as const) {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    gl.clearColor(0, 0, 0, 1);
  }

  private upload(unit: number, data: Uint8Array, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  resize(cssW: number, cssH: number, keys: readonly KeyRect[], scale: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.lastLayout = { keys, scale };
    this.canvas.width = Math.max(1, Math.round(cssW * scale));
    this.canvas.height = Math.max(1, Math.round(cssH * scale));
    if (this.lost) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const { classes, keyClass } = classOf(keys, scale);
    // Shelf-pack each class's masks into one atlas.
    const ATLAS_W = 1024;
    const place: Array<{ x: number; y: number }> = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const c of classes) {
      if (x + c.masks.width > ATLAS_W) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      place.push({ x, y });
      x += c.masks.width;
      rowH = Math.max(rowH, c.masks.height);
    }
    const atlasH = Math.max(1, y + rowH);
    const a = new Uint8Array(ATLAS_W * atlasH * 4);
    classes.forEach((c, n) => {
      const { x: px, y: py } = place[n];
      for (let row = 0; row < c.masks.height; row++) {
        const src = row * c.masks.width * 4;
        const dst = ((py + row) * ATLAS_W + px) * 4;
        a.set(c.masks.a.subarray(src, src + c.masks.width * 4), dst);
      }
    });
    if (this.texA) gl.deleteTexture(this.texA);
    this.texA = this.upload(0, a, ATLAS_W, atlasH);
    this.atlas = { w: ATLAS_W, h: atlasH };
    this.keys = keys.map((r, k) => {
      const cls = classes[keyClass[k]];
      const p = place[keyClass[k]];
      return {
        x: Math.round(r.x * scale - cls.masks.ox),
        y: Math.round(r.y * scale - cls.masks.oy),
        w: cls.masks.width,
        h: cls.masks.height,
        ax: p.x,
        ay: p.y,
      };
    });
    this.data = new Float32Array(this.keys.length * INSTANCE_STRIDE);
  }

  draw(frame: Float32Array): void {
    if (this.lost) return;
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    const n = packInstances(this.keys, frame, this.atlas.w, this.atlas.h, this.data);
    if (n === 0) return;
    gl.useProgram(this.program);
    gl.uniform2f(this.uSize, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, n * INSTANCE_STRIDE), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    if (!this.verified && this.data[11] >= 0.12) this.verify(n);
  }

  /**
   * Some drivers hand back a context that draws nothing. After the first lit frame, read one pixel
   * from the first lit key's glow; if it is still black, report failure so the caller falls back to 2D.
   */
  private verify(n: number): void {
    const gl = this.gl;
    const x = Math.round(this.data[0] + this.data[2] / 2);
    const y = Math.round(this.data[1] + this.data[3] * 0.55);
    const px = new Uint8Array(4);
    const cx = Math.max(0, Math.min(this.canvas.width - 1, x));
    const cy = Math.max(0, Math.min(this.canvas.height - 1, this.canvas.height - 1 - y));
    gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (n > 0 && px[0] + px[1] + px[2] === 0) {
      this.lost = true;
      this.onLost?.();
      return;
    }
    this.verified = true;
  }

  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    // Release GPU objects but keep the context itself: React may re-run the effect on the same canvas.
    const gl = this.gl;
    if (this.lost) return;
    if (this.texA) gl.deleteTexture(this.texA);
    gl.deleteBuffer(this.instanceBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.texA = null;
  }
}

/** Creates the glow renderer; GL throws when it cannot start so the caller can remount a 2D canvas. */
export function createGlow(kind: "gl" | "2d", canvas: HTMLCanvasElement, onLost?: () => void): GlowRenderer {
  return kind === "gl" ? new GlowGL(canvas, onLost) : new Glow2D(canvas);
}

/**
 * The seam under each cap: a crisp hot line plus its soft spread shadow. These are blended
 * normally (not screened), so they live on their own small 2D layer between glow and caps.
 */
export class SeamLayer {
  private ctx: CanvasRenderingContext2D;
  private classes: KeyClass[] = [];
  private keyClass: number[] = [];
  private rects: KeyRect[] = [];
  private scale = 1;
  private sprites = new Map<KeyClass, { shadow: HTMLCanvasElement; body: HTMLCanvasElement; x0: number; y0: number; w: number; h: number }>();
  private scratch = new Map<KeyClass, HTMLCanvasElement>();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, keys: readonly KeyRect[], scale: number): void {
    this.scale = scale;
    this.canvas.width = Math.max(1, Math.round(cssW * scale));
    this.canvas.height = Math.max(1, Math.round(cssH * scale));
    this.rects = [...keys];
    const g = classOf(this.rects, scale);
    this.classes = g.classes;
    this.keyClass = g.keyClass;
    this.sprites.clear();
    this.scratch.clear();
  }

  /** The seam only covers a thin strip, so its sprites are cropped to the pixels that matter. */
  private spritesFor(cls: KeyClass) {
    let s = this.sprites.get(cls);
    if (!s) {
      const m = cls.masks;
      let x0 = m.width;
      let y0 = m.height;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if (m.b[(y * m.width + x) * 4] > 1 || m.b[(y * m.width + x) * 4 + 1] > 1) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const w = Math.max(1, x1 - x0 + 1);
      const h = Math.max(1, y1 - y0 + 1);
      const shadow = new Uint8ClampedArray(w * h * 4);
      const body = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const src = ((y + y0) * m.width + x + x0) * 4;
          const dst = (y * w + x) * 4;
          shadow[dst] = shadow[dst + 1] = shadow[dst + 2] = 255;
          shadow[dst + 3] = m.b[src];
          body[dst] = body[dst + 1] = body[dst + 2] = 255;
          body[dst + 3] = m.b[src + 1];
        }
      }
      s = { shadow: toCanvas(shadow, w, h), body: toCanvas(body, w, h), x0, y0, w, h };
      this.sprites.set(cls, s);
      const sc = document.createElement("canvas");
      sc.width = w;
      sc.height = h;
      this.scratch.set(cls, sc);
    }
    return s;
  }

  private stamp(cls: KeyClass, mask: HTMLCanvasElement, rgb: string, alpha: number, dx: number, dy: number): void {
    const sc = this.scratch.get(cls);
    const sctx = sc?.getContext("2d");
    if (!sc || !sctx) return;
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, sc.width, sc.height);
    sctx.fillStyle = rgb;
    sctx.fillRect(0, 0, sc.width, sc.height);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(mask, 0, 0);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sc, dx, dy);
  }

  draw(frame: Float32Array): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let k = 0; k < this.rects.length; k++) {
      const o = k * FRAME_STRIDE;
      const i = frame[o + 3];
      if (i <= 0.004) continue;
      const cls = this.classes[this.keyClass[k]];
      const sp = this.spritesFor(cls);
      const r = this.rects[k];
      const dx = Math.round(r.x * this.scale - cls.masks.ox) + sp.x0;
      const dy = Math.round(r.y * this.scale - cls.masks.oy) + sp.y0;
      const R = frame[o];
      const G = frame[o + 1];
      const B = frame[o + 2];
      // The seam element sits at opacity `i`; its shadow colour also carries `i`, hence i squared.
      this.stamp(cls, sp.shadow, `rgb(${R},${G},${B})`, i * i, dx, dy);
      this.stamp(cls, sp.body, `rgb(${Math.round(R * 0.8 + 51)},${Math.round(G * 0.8 + 51)},${Math.round(B * 0.8 + 51)})`, i, dx, dy);
    }
    ctx.globalAlpha = 1;
  }
}
