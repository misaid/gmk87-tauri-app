import { useEffect, useRef } from "react";
import { useDialogFocusTrap } from "@/lib/useDialog";

export const GLOSSARY: ReadonlyArray<{ term: string; def: string }> = [
  {
    term: "Underglow",
    def: "Light under the key plate.",
  },
  {
    term: "Side LEDs",
    def: "The edge light bars.",
  },
  {
    term: "Slot",
    def: "One of two display images.",
  },
  {
    term: "Frame budget",
    def: "36 animation frames across both slots.",
  },
  {
    term: "Frame delay",
    def: "Milliseconds per frame.",
  },
  {
    term: "Auto-apply",
    def: "Edits write to the board live.",
  },
  {
    term: "Preset",
    def: "A saved lighting look.",
  },
  {
    term: "VIA",
    def: "Key remapping, coming later.",
  },
  {
    term: "Win Lock",
    def: "Disables the Windows key.",
  },
  {
    term: "Read-back",
    def: "The board can't be read; the app shows what it last wrote.",
  },
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="dialog-panel max-h-[80vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 id="help-title" className="text-base font-semibold text-[var(--text)]">
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          >
            Close
          </button>
        </div>
        <div className="mt-3 rounded-[12px] border border-[var(--line)] p-3 text-xs leading-relaxed text-[var(--muted)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dim)]">Shortcuts</p>
          <p className="mt-1.5 text-[var(--text)]">
            1–4 tabs · ? help · p pause · Ctrl/Cmd+Z undo
          </p>
        </div>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dim)]">Glossary</p>
        <dl className="mt-2 flex flex-col gap-2.5">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="rounded-[12px] border border-[var(--line)] p-3">
              <dt className="text-[13px] font-medium text-[var(--text)]">{g.term}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{g.def}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
