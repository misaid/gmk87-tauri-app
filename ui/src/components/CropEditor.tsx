import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_CROP, cropKey, drawCrop, panBy, zoomBy, type CropParams } from "@/lib/crop";
import { getBitmap } from "@/lib/bitmapCache";
import { useAppStore } from "@/store";

/** Wheel gestures commit to the store once the wheel has been quiet this long. */
const WHEEL_END_MS = 120;

/**
 * Pan/zoom editor. During a gesture the crop lives in a ref and is drawn
 * straight onto a canvas from the already-decoded bitmap on requestAnimationFrame:
 * no store writes, no IPC, no React renders. The crop is committed once when the
 * gesture ends, and the store then asks the backend for the true device render.
 */
function CropEditorImpl() {
  const source = useAppStore((s) => s.entries[s.slot].source);
  const committed = useAppStore((s) => s.entries[s.slot].crop);
  const previewUrl = useAppStore((s) => s.entries[s.slot].previewUrl ?? null);
  const previewKey = useAppStore((s) => s.entries[s.slot].previewKey ?? null);
  const setCrop = useAppStore((s) => s.setCrop);

  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const zoomLabel = useRef<HTMLDivElement>(null);
  const live = useRef<CropParams>(committed);
  const bitmap = useRef<ImageBitmap | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const wheelTimer = useRef<number | undefined>(undefined);
  const [gesturing, setGesturing] = useState(false);
  const [hasBitmap, setHasBitmap] = useState(false);

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
    if (ctx) drawCrop(ctx, bmp, live.current, w, h);
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(paint);
  }, [paint]);

  // The store's crop wins whenever no gesture is in flight (slot switch, reset, library load).
  useEffect(() => {
    live.current = committed;
    schedule();
  }, [committed, schedule]);

  // Decode once (cached per source), then every redraw is a drawImage.
  useEffect(() => {
    let cancelled = false;
    bitmap.current = null;
    setHasBitmap(false);
    if (source) {
      void getBitmap(source).then((bmp) => {
        if (cancelled) return;
        bitmap.current = bmp;
        setHasBitmap(Boolean(bmp));
        schedule();
      });
    } else {
      schedule();
    }
    return () => {
      cancelled = true;
    };
  }, [source, schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(wheelTimer.current);
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
      schedule();
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(commit, WHEEL_END_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [schedule, commit]);

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    const { width, height } = box();
    live.current = panBy(live.current, dx, dy, width, height);
    schedule();
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

  // Show the true device render only when it matches the crop on screen.
  const showTrue = Boolean(previewUrl) && !gesturing && previewKey === cropKey(committed);
  const showCanvas = hasBitmap && !showTrue;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={surface}
        data-testid="crop-surface"
        tabIndex={0}
        role="group"
        aria-label="Display image. Arrow keys pan. Plus and minus zoom."
        className="relative aspect-[240/135] w-full max-w-2xl cursor-grab touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
        <canvas
          ref={canvas}
          data-testid="crop-canvas"
          className={showCanvas ? "absolute inset-0 size-full" : "absolute inset-0 size-full opacity-0"}
        />
        {showTrue && previewUrl && (
          <img
            src={previewUrl}
            alt="Display preview"
            draggable={false}
            className="absolute inset-0 size-full object-cover [image-rendering:pixelated]"
          />
        )}
        {!previewUrl && !hasBitmap && (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Drag to pan · scroll to zoom
          </span>
        )}
        <div
          ref={zoomLabel}
          className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/70"
        >
          {committed.zoom.toFixed(2)}×
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setCrop({ ...DEFAULT_CROP })}>
          Reset crop
        </Button>
        <span className="text-xs text-white/70">Tab to the image, then use arrow keys to pan and + / − to zoom.</span>
      </div>
    </div>
  );
}

export const CropEditor = memo(CropEditorImpl);
