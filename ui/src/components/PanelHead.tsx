import type { ReactNode } from "react";

/** Indexed silkscreen header: `01  LABEL ─────`. Every panel on every screen starts with one. */
export function PanelHead({ n, title, id, children, className = "mb-3" }: { n: number; title: string; id?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <h2 id={id} tabIndex={id ? -1 : undefined} className="flex items-center gap-2.5 outline-offset-4">
        <span aria-hidden className="readout text-[11px] text-[var(--dim)]">{String(n).padStart(2, "0")}</span>
        <span className="silk">{title}</span>
      </h2>
      <span aria-hidden className="h-px flex-1 bg-[var(--line)]" />
      {children}
    </div>
  );
}
