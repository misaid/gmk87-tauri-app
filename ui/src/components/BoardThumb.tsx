import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { drawBoardThumb, peakTime, subscribeThumbClock, thumbLayout } from "@/lib/boardThumb";
import type { LedLighting } from "@/lib/ledField";

/** A mini keyboard on a canvas: static at its peak frame, animated only while `live` (shared clock). */
export function BoardThumb({ lighting, live = false, className = "" }: { lighting: LedLighting; live?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const { aspect } = thumbLayout();
  const key = `${lighting.effect}|${lighting.brightness}|${lighting.speed}|${lighting.orientation}|${lighting.rainbow}|${lighting.color.join(",")}`;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const c = ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const base = peakTime(lighting.effect);
    let w = 0;
    let h = 0;
    const paint = (t: number) => {
      if (w > 0 && h > 0) {
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBoardThumb(c, w, h, lighting, t);
      }
    };
    const size = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width === w && r.height === h) return;
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      paint(base);
    };
    size();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(size);
      ro.observe(canvas);
    }
    paint(base);
    let unsub: (() => void) | undefined;
    if (live && !reduce) {
      let start = 0;
      unsub = subscribeThumbClock((now) => {
        if (!start) start = now;
        paint(base + (now - start));
      });
    }
    return () => {
      unsub?.();
      ro?.disconnect();
    };
    // `key` captures every field of `lighting` that affects drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live, reduce]);

  return <canvas ref={ref} aria-hidden className={`block w-full rounded-[6px] ${className}`} style={{ aspectRatio: `${aspect}` }} />;
}
