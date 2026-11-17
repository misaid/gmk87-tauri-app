import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { KNOB_FACE, KNOB_SHADOW } from "@/components/keyboard";
import { DEFAULT_CROP, cropKey, drawCrop, panBy, zoomBy, type CropParams } from "@/lib/crop";
import { getBitmap, peekBitmap, type Source } from "@/lib/bitmapCache";
import { useAppStore } from "@/store";

/** Wheel gestures commit to the store once the wheel has been quiet this long. */
const WHEEL_END_MS = 120;

/** After the last move, redraw once at full smoothing quality. */
const SETTLE_MS = 140;

/**
 * Pan/zoom editor. During a gesture the crop lives in a ref and is drawn
 * straight onto a canvas from the already-decoded bitmap on requestAnimationFrame:
 * no store writes, no IPC, no React renders. The crop is committed once when the
 * gesture ends, and the store then asks the backend for the true device render.
 */
function CropEditorImpl({ footer }: { footer?: ReactNode }) {
  const source = useAppStore((s) => s.entries[s.slot].source);
  const committed = useAppStore((s) => s.entries[s.slot].crop);
  const previewUrl = useAppStore((s) => s.entries[s.slot].previewUrl ?? null);
  const previewKey = useAppStore((s) => s.entries[s.slot].previewKey ?? null);
  const setCrop = useAppStore((s) => s.setCrop);

  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const live = useRef<CropParams>(committed);
  const bitmap = useRef<Source | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const wheelTimer = useRef<number | undefined>(undefined);
  const settleTimer = useRef<number | undefined>(undefined);
  const moving = useRef(false);
  const [gesturing, setGesturing] = useState(false);
  const [hasBitmap, setHasBitmap] = useState(false);

  const paintRef = useRef<() => void>(() => {});
  const paint = useCallback(() => {
    raf.current = 0;
    const el = canvas.current;
    const bmp = bitmap.current;
    if (zoomLabel.current) zoomLabel.current.textContent = `${live.current.zoom.toFixed(2)}×`;
    if (!el || !bmp) return;
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round((rect.width || 480) * dpr));
    const h = Math.max(1, Math.round((rect.height || 270) * dpr));
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    // Cheap bilinear while the crop is moving, one sharp redraw once it settles.
    drawCrop(ctx, bmp, live.current, w, h, moving.current ? "low" : "high");
    window.clearTimeout(settleTimer.current);
    if (moving.current) {
      settleTimer.current = window.setTimeout(() => {
        moving.current = false;
        schedule();
      }, SETTLE_MS);
    }
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(paintRef.current);
  }, []);
  const motion = useCallback(() => {
    moving.current = true;
    schedule();
  }, [schedule]);

  paintRef.current = paint;

  // The store's crop wins whenever no gesture is in flight (slot switch, reset, library load).
  useEffect(() => {
    live.current = committed;
    schedule();
  }, [committed, schedule]);

  // Decode once (cached per source), then every redraw is a drawImage. A bitmap that
  // is already decoded (slot switch) is installed synchronously, and the previous
  // frame stays on the canvas until the new one is ready, so nothing flashes black.
  useEffect(() => {
    let cancelled = false;
    const hit = peekBitmap(source);
    bitmap.current = hit;
    setHasBitmap(Boolean(hit));
    if (hit) schedule();
    if (source && !hit) {
      void getBitmap(source).then((bmp) => {
        if (cancelled) return;
        bitmap.current = bmp;
        setHasBitmap(Boolean(bmp));
        schedule();
      });
    } else if (!source) {
      schedule();
    }
    return () => {
      cancelled = true;
    };
  }, [source, schedule]);

  // Re-fit the backing store when the surface is resized (window, layout changes).
  useEffect(() => {
    const el = surface.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      window.clearTimeout(wheelTimer.current);
      window.clearTimeout(settleTimer.current);
    },
    [],
  );

  function box() {
    const rect = surface.current?.getBoundingClientRect();
    return { width: rect?.width || 480, height: rect?.height || 270 };
  }

  const commit = useCallback(() => {
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = undefined;
    setGesturing(false);
    if (cropKey(live.current) !== cropKey(useAppStore.getState().entries[useAppStore.getState().slot].crop)) {
      setCrop({ ...live.current });
    }
  }, [setCrop]);

  const beginGesture = () => {
    setGesturing((g) => (g ? g : true));
  };

  // Wheel needs a non-passive listener so the page does not scroll while zooming.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1;
      live.current = { ...live.current, zoom: zoomBy(live.current.zoom, event.deltaY * unit * 0.5) };
      beginGesture();
      motion();
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(commit, WHEEL_END_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [motion, commit]);

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    const { width, height } = box();
    live.current = panBy(live.current, dx, dy, width, height);
    motion();
  }

  function keyCommit(next: CropParams) {
    live.current = next;
    schedule();
    setCrop(next);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { width, height } = box();
    const step = event.shiftKey ? 40 : 10;
    const c = live.current;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        keyCommit(panBy(c, step, 0, width, height));
        break;
      case "ArrowRight":
        event.preventDefault();
        keyCommit(panBy(c, -step, 0, width, height));
        break;
      case "ArrowUp":
        event.preventDefault();
        keyCommit(panBy(c, 0, step, width, height));
        break;
      case "ArrowDown":
        event.preventDefault();
        keyCommit(panBy(c, 0, -step, width, height));
        break;
      case "+":
      case "=":
        event.preventDefault();
        keyCommit({ ...c, zoom: zoomBy(c.zoom, -10) });
        break;
      case "-":
      case "_":
        event.preventDefault();
        keyCommit({ ...c, zoom: zoomBy(c.zoom, 10) });
        break;
    }
  }

  // The canvas always stays visible and painted; the true device render is layered
  // on top (already decoded by the store) only while it matches the crop on screen.
  const showTrue = Boolean(previewUrl) && !gesturing && previewKey === cropKey(committed);
  const loaded = Boolean(source) || hasBitmap || Boolean(previewUrl);

  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-2">
      {/* The board's screen module, enlarged: bezel, black recess with the live crop, and the matte knob. */}
      <div
        className="grid grid-cols-[1fr_64px] items-center rounded-[8px] border border-white/[0.06] p-3"
        style={{ background: "linear-gradient(180deg, #1c1e24, #121418)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.07), 0 18px 30px -16px rgba(0,0,0,.8)" }}
      >
        <div className="relative rounded-[4px] bg-[#050608] p-[5px]" style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,.9)" }}>
          <div
            ref={surface}
            data-testid="crop-surface"
            tabIndex={0}
            role="group"
            aria-label="Display image. Arrow keys pan. Plus and minus zoom."
            className="relative aspect-[240/135] w-full cursor-grab touch-none select-none overflow-hidden rounded-[2px] bg-black"
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, y: event.clientY };
              live.current = useAppStore.getState().entries[useAppStore.getState().slot].crop;
              beginGesture();
              (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              if (!drag.current) return;
              drag.current = null;
              commit();
            }}
            onPointerCancel={() => {
              drag.current = null;
              commit();
            }}
            onKeyDown={onKeyDown}
          >
            <canvas ref={canvas} data-testid="crop-canvas" className="absolute inset-0 size-full" />
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Display preview"
                draggable={false}
                style={{ visibility: showTrue || !hasBitmap ? "visible" : "hidden" }}
                className="absolute inset-0 size-full object-cover [image-rendering:pixelated]"
              />
            )}
            {!loaded && (
              <span className="readout absolute inset-0 flex items-center justify-center text-[12px] tracking-[0.16em] text-[var(--dim)]">NO IMAGE</span>
            )}
            {/* Gloss, like the glass on the real screen. */}
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(120deg, rgba(255,255,255,.08), transparent 30%)" }} />
          </div>
        </div>
        <div aria-hidden className="relative mx-auto size-[52px] rounded-full" style={{ backgroundImage: KNOB_FACE, boxShadow: KNOB_SHADOW }}>
          <span className="absolute left-1/2 top-[10%] h-[24%] w-[7%] -translate-x-1/2 rounded-full bg-white/80" />
        </div>
      </div>
      <div className="readout flex items-center justify-between px-1 text-[11px] text-[var(--dim)]">
        <span>240 × 135</span>
        <span ref={zoomLabel}>{committed.zoom.toFixed(2)}×</span>
      </div>
      {loaded && (
        <div className="flex flex-wrap items-center gap-3">
          {footer}
          <Button variant="outline" size="sm" onClick={() => setCrop({ ...DEFAULT_CROP })}>
            Reset crop
          </Button>
          <span className="text-[11.5px] text-[var(--muted)]">Drag to pan, scroll to zoom. Arrow keys and + / − also work.</span>
        </div>
      )}
    </div>
  );
}

export const CropEditor = memo(CropEditorImpl);
