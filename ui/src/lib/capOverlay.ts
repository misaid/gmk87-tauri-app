import type { KeyRect } from "@/lib/glowRender";
import { FRAME_STRIDE } from "@/lib/lightingPerf";

/**
 * The cap-level half of the per-key lighting: the faint lower-third wash of
 * the LED colour and the board-wide "unlit caps sit a touch darker" shading.
 * Both used to be CSS (`--t` gradient and `filter: brightness`) rewritten on
 * every cap each frame; here they are painted for all caps on one canvas that
 * sits above the (now static) caps.
 */
export class CapOverlay {
  private ctx: CanvasRenderingContext2D;
  private paths: Path2D[] = [];
  private rects: KeyRect[] = [];
  private scale = 1;
  private last: string[] = [];

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
    this.last = [];
    this.paths = this.rects.map((r) => {
      const p = new Path2D();
      const w = Math.round(r.w * scale);
      const h = Math.round(r.h * scale);
      // Circular corners of 16% of the key's height, as the DOM cap draws them.
      p.roundRect(0, 0, w, h, h * 0.16);
      return p;
    });
  }

  /** Repaints; skips work when no cap's quantised state changed. */
  draw(frame: Float32Array): void {
    const ctx = this.ctx;
    let dirty = this.last.length !== this.rects.length;
    const sig: string[] = dirty ? new Array(this.rects.length) : this.last;
    for (let k = 0; k < this.rects.length; k++) {
      const o = k * FRAME_STRIDE;
      const s = `${frame[o]},${frame[o + 1]},${frame[o + 2]},${Math.round(frame[o + 3] * 60)}`;
      if (sig[k] !== s) {
        sig[k] = s;
        dirty = true;
      }
    }
    if (!dirty) return;
    this.last = sig;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let k = 0; k < this.rects.length; k++) {
      const o = k * FRAME_STRIDE;
      const i = frame[o + 3];
      const t = frame[o + 4];
      const r = this.rects[k];
      const x = Math.round(r.x * this.scale);
      const y = Math.round(r.y * this.scale);
      const h = Math.round(r.h * this.scale);
      ctx.setTransform(1, 0, 0, 1, x, y);
      if (t > 0.001) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0.55, `rgba(${frame[o]},${frame[o + 1]},${frame[o + 2]},0)`);
        g.addColorStop(1, `rgba(${frame[o]},${frame[o + 1]},${frame[o + 2]},${t.toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fill(this.paths[k]);
      }
      // filter: brightness(0.9 + 0.1 * i) multiplies the cap by b; black at (1 - b) does the same.
      const darken = 1 - (0.9 + 0.1 * i);
      if (darken > 0.001) {
        ctx.fillStyle = `rgba(0,0,0,${darken.toFixed(3)})`;
        ctx.fill(this.paths[k]);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
