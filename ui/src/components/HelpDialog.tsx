import { useEffect, useRef } from "react";
import { useDialogFocusTrap } from "@/lib/useDialog";

const PROJECT_URL = "https://github.com/misaid/gmk87-tauri-app";

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

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = isMac ? "⌘" : "Ctrl";

/** Shortcut legends; the number keys follow the tab order in the header. */
export const SHORTCUTS: ReadonlyArray<{ keys: string[]; does: string }> = [
  { keys: ["1"], does: "Device" },
  { keys: ["2"], does: "Lighting" },
  { keys: ["3"], does: "Display" },
  { keys: ["4"], does: "Profiles" },
  { keys: ["?"], does: "Open this help" },
  { keys: ["P"], does: "Pause or resume animations" },
  { keys: [MOD, "Z"], does: "Undo" },
  { keys: [MOD, "Shift", "Z"], does: "Redo" },
  { keys: [MOD, "↵"], does: "Apply a held draft to the keyboard" },
];

export function HelpDialog({ open, onClose, version }: { open: boolean; onClose: () => void; version?: string }) {
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
        className="dialog-panel max-h-[84vh] w-full max-w-lg overflow-y-auto p-6 min-[900px]:max-w-[820px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 id="help-title" className="display text-[18px] uppercase tracking-[0.02em] text-[var(--text)]">
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--r-ctl)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--bg-raise-2)] hover:text-[var(--text)]"
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-5 min-[900px]:grid-cols-2">
          <div>
            <p className="silk">Shortcuts</p>
            <table className="mt-2 w-full border-collapse text-[12.5px]">
              <tbody>
                {SHORTCUTS.map((row) => (
                  <tr key={row.does} className="border-t border-[var(--line)] first:border-t-0">
                    <th scope="row" className="w-[40%] py-1.5 pr-3 text-left font-normal">
                      <span className="inline-flex items-center gap-1">
                        {row.keys.map((k) => (
                          <kbd key={k} className="keycap-dark readout inline-flex h-6 min-w-6 items-center justify-center px-1.5 text-[11px]" style={{ fontFamily: k === "↵" ? "var(--font-ui)" : undefined }}>
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </th>
                    <td className="py-1.5 text-[var(--muted)]">{row.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="silk">Glossary</p>
            <dl className="mt-2 flex flex-col">
              {GLOSSARY.map((g) => (
                <div key={g.term} className="border-t border-[var(--line)] py-2 first:border-t-0">
                  <dt className="text-[13px] font-[550] text-[var(--text)]">{g.term}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{g.def}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className="readout mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--dim)]">
          {version && <span>GMK87 Configurator v{version}</span>}
          <a href={PROJECT_URL} target="_blank" rel="noreferrer" className="text-[var(--muted)] underline underline-offset-4 transition-colors hover:text-[var(--text)]">
            Open project page
          </a>
        </p>
      </div>
    </div>
  );
}
