import { useEffect, useRef } from "react";
import { useDialogFocusTrap } from "@/lib/useDialog";

export const GLOSSARY: ReadonlyArray<{ term: string; def: string }> = [
  {
    term: "Underglow",
    def: "The light that spills from beneath the key plate. Effects 0–18 on the board — waves, rainbows, breathing — are all underglow.",
  },
  {
    term: "Side LEDs",
    def: "The two strip lights on the left and right edges of the board. They have their own mode, saturation, colour and rainbow flag, separate from underglow.",
  },
  {
    term: "Slot",
    def: "One of two image slots (Slot 0 / Slot 1) for the display. Each holds one animated image. Both slots are resent on every upload.",
  },
  {
    term: "Frame budget",
    def: "The board stores 36 animation frames total across both slots. A 40-frame GIF is compressed down to fit — frames are dropped and the app says so.",
  },
  {
    term: "Frame delay",
    def: "How long each frame shows, in milliseconds. Lower delay = faster animation, but it can push you over the frame budget.",
  },
  {
    term: "Auto-apply",
    def: "Lighting edits preview instantly and are written to the board automatically a moment later. Offline, they wait and apply as soon as the keyboard connects.",
  },
  {
    term: "Preset",
    def: "A named bundle of lighting settings (e.g. gaming, matrix). Choosing one stages the look; it is written to the board like any other edit. You can undo it.",
  },
  {
    term: "VIA",
    def: "A standard for remapping QMK keyboards. When detected, key remapping becomes available in a future version.",
  },
  {
    term: "Win Lock",
    def: "Disables the Windows key so a stray press doesn't open the Start menu mid-game.",
  },
  {
    term: "Read-back",
    def: "Asking the board what it currently holds. The GMK87 can't be read back — the app keeps the last settings it wrote instead.",
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
            1 / 2 / 3 / 4 switch tabs · ? opens help · p pauses animation · Cmd/Ctrl+Z undoes the last write
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
