import type { ReactNode } from "react";

/**
 * The rail under the board: a hairline, the screen title in the display face, and the readouts for
 * that screen. A write sends a light segment once along the hairline (remounted by `pulseKey`).
 */
export function Rail({ title, maxWidth, pulseKey, children }: { title: string; maxWidth: string; pulseKey: number; children?: ReactNode }) {
  return (
    <div className="mx-auto w-full px-2" style={{ maxWidth: `calc(${maxWidth} + 16px)` }}>
      <div className="rail flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
        {pulseKey > 0 && (
          <span aria-hidden className="rail-pulse-track">
            <span key={pulseKey} className="rail-pulse" />
          </span>
        )}
        <h1 className="display shrink-0 text-[18px] uppercase tracking-[0.02em]">
          {title}
        </h1>
        <div className="readout flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-[var(--dim)]">{children}</div>
      </div>
    </div>
  );
}
