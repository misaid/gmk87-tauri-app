import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_CROP, panBy, zoomBy, type CropParams } from "@/lib/crop";
import { useAppStore } from "@/store";

export function CropEditor() {
  const crop = useAppStore((s) => s.entries[s.slot].crop);
  const setCrop = useAppStore((s) => s.setCrop);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  function box() {
    const rect = surface.current?.getBoundingClientRect();
    return { width: rect?.width || 480, height: rect?.height || 270 };
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    const { width, height } = box();
    setCrop(panBy(crop, dx, dy, width, height));
  }

  function nextZoom(delta: number): CropParams {
    return { ...crop, zoom: zoomBy(crop.zoom, delta) };
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { width, height } = box();
    const step = event.shiftKey ? 40 : 10;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setCrop(panBy(crop, step, 0, width, height));
        break;
      case "ArrowRight":
        event.preventDefault();
        setCrop(panBy(crop, -step, 0, width, height));
        break;
      case "ArrowUp":
        event.preventDefault();
        setCrop(panBy(crop, 0, step, width, height));
        break;
      case "ArrowDown":
        event.preventDefault();
        setCrop(panBy(crop, 0, -step, width, height));
        break;
      case "+":
      case "=":
        event.preventDefault();
        setCrop(nextZoom(-10));
        break;
      case "-":
      case "_":
        event.preventDefault();
        setCrop(nextZoom(10));
        break;
    }
  }

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
        const target = event.target as HTMLElement | null;
        target?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        drag.current = null;
      }}
      onWheel={(event) => {
        event.preventDefault();
        setCrop(nextZoom(event.deltaY));
      }}
      onKeyDown={onKeyDown}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Display preview"
          draggable={false}
          className="size-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          Drag to pan · scroll to zoom
        </span>
      )}
      <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/70">
        {crop.zoom.toFixed(2)}×
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
