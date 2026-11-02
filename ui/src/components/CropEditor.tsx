import { useRef, useState } from "react";
import { panBy, zoomBy, type CropParams } from "@/lib/crop";
import { useAppStore } from "@/store";

export function CropEditor() {
  const crop = useAppStore((s) => s.crop);
  const setCrop = useAppStore((s) => s.setCrop);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);

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
    force((n) => n + 1);
  }

  function nextZoom(delta: number): CropParams {
    return { ...crop, zoom: zoomBy(crop.zoom, delta) };
  }

  return (
    <div
      ref={surface}
      data-testid="crop-surface"
      className="relative aspect-[240/135] w-full max-w-2xl cursor-grab touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-black"
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
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Display preview"
          draggable={false}
          className="size-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
          Drag to pan · scroll to zoom
        </span>
      )}
      <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/60">
        {crop.zoom.toFixed(2)}×
      </div>
    </div>
  );
}
