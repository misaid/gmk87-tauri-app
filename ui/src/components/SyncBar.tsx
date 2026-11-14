import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, CloudOff, Ellipsis, Loader2, Redo2, TriangleAlert, Undo2 } from "lucide-react";
import { diffSummary, deriveSyncStatus, formatClock } from "@/lib/lightingSync";
import { LIGHTING_MODES, LIGHTING_MODE_LABEL, getLightingMode, setLightingMode, subscribeLightingMode } from "@/lib/lightingPerf";
import { OFFLINE_STATE, useAppStore } from "@/store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = isMac ? "⌘" : "Ctrl";

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-1 rounded border border-white/15 bg-white/[0.06] px-1 font-mono text-[10px] leading-4 text-[var(--muted)]">{children}</kbd>;
}

/** Persistent trust layer: where the board stands relative to what you see. */
export function SyncBar() {
  const connected = useAppStore((s) => s.connected);
  const draft = useAppStore((s) => s.draft);
  const committed = useAppStore((s) => s.state);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const applying = useAppStore((s) => s.applying);
  const applyFailed = useAppStore((s) => s.applyFailed);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const history = useAppStore((s) => s.lightingHistory);
  const redoStack = useAppStore((s) => s.redoStack);
  const draftFuture = useAppStore((s) => s.draftFuture);
  const autoApply = useAppStore((s) => s.autoApply);
  const setAutoApply = useAppStore((s) => s.setAutoApply);
  const commitDraft = useAppStore((s) => s.commitDraft);
  const discardDraft = useAppStore((s) => s.discardDraft);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);

  const [menuOpen, setMenuOpen] = useState(false);
  const previewMode = useSyncExternalStore(subscribeLightingMode, getLightingMode);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const base = deriveSyncStatus({ connected, draftDirty, applying, applyFailed });
  // Live mode: a pending edit is about to be written, so call it Applying, not Draft.
  const status = autoApply && base === "draft" ? "applying" : base;
  const changes = draft && draftDirty ? diffSummary(committed ?? OFFLINE_STATE, draft) : [];
  const canUndo = draft ? true : (history?.length ?? 0) > 0;
  const canRedo = (draftFuture?.length ?? 0) > 0 || (redoStack?.length ?? 0) > 0;

  const pill =
    status === "synced"
      ? { icon: <Check className="size-3.5" aria-hidden />, tone: "text-[var(--success)]", label: "Synced", sub: lastSyncedAt ? `Last synced ${formatClock(lastSyncedAt)}` : autoApply ? "Live" : "" }
      : status === "draft"
        ? { icon: <span aria-hidden className="size-2 rounded-full bg-[var(--warn)]" />, tone: "text-[var(--warn)]", label: "Draft — not on board", sub: "" }
        : status === "applying"
          ? { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, tone: "text-[var(--text)]", label: "Applying…", sub: "" }
          : status === "offline"
            ? { icon: <CloudOff className="size-3.5" aria-hidden />, tone: "text-[var(--warn)]", label: "Not connected", sub: draftDirty ? "Queued" : "" }
            : { icon: <TriangleAlert className="size-3.5" aria-hidden />, tone: "text-[#ff6b6b]", label: "Couldn’t apply", sub: "Draft kept" };

  const btn =
    "inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-35";
  const icon = "inline-flex size-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-white/[0.07] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-30";

  return (
    <div role="group" aria-label="Sync status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="group relative flex min-w-0 items-center gap-2" tabIndex={changes.length ? 0 : undefined}>
        <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${pill.tone}`}>
          {pill.icon}
          {pill.label}
        </span>
        <span className="truncate text-[12px] text-[var(--muted)]">
          {status === "draft" && changes.length > 0 ? `${changes.slice(0, 2).join(" · ")}${changes.length > 2 ? ` · +${changes.length - 2} more` : ""}` : pill.sub}
        </span>
        {changes.length > 0 && (
          <div
            role="tooltip"
            className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-[300px] rounded-[12px] border border-white/10 bg-[rgba(14,16,22,0.95)] p-3 text-[12px] opacity-0 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          >
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
              {changes.length} change{changes.length > 1 ? "s" : ""} to apply
            </p>
            <ul className="flex flex-col gap-1 text-[var(--text)]">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            className={icon}
            aria-label="Sync options"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Sync options"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Ellipsis className="size-4" aria-hidden />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-[250px] rounded-[12px] border border-white/10 bg-[rgba(14,16,22,0.96)] p-3 text-[12px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl">
              <label className="flex cursor-pointer items-start gap-2 text-[var(--text)]">
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={!autoApply} onChange={(e) => setAutoApply(!e.target.checked)} />
                <span>
                  <span className="block font-medium">Draft mode</span>
                  <span className="block text-[11px] leading-snug text-[var(--muted)]">Hold edits until Apply.</span>
                </span>
              </label>
              <div className="mt-3 border-t border-white/10 pt-3" role="radiogroup" aria-label="Lighting preview">
                <span className="block font-medium text-[var(--text)]">Lighting preview</span>
                <span className="mb-2 block text-[11px] leading-snug text-[var(--muted)]">How the board animates here. Static is easiest on the machine.</span>
                <div className="grid grid-cols-4 gap-1">
                  {LIGHTING_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={previewMode === m}
                      onClick={() => setLightingMode(m)}
                      className={`h-7 rounded-md text-[11px] font-medium transition-colors ${previewMode === m ? "bg-white text-[#0b0d12]" : "bg-white/[0.06] text-[var(--muted)] hover:bg-white/[0.1] hover:text-[var(--text)]"}`}
                    >
                      {LIGHTING_MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <button type="button" className={icon} aria-label="Undo" title={`Undo (${MOD}+Z)`} disabled={!canUndo || applying} onClick={() => void undo()}>
          <Undo2 className="size-4" aria-hidden />
        </button>
        <button type="button" className={icon} aria-label="Redo" title={`Redo (${MOD}+Shift+Z)`} disabled={!canRedo || applying} onClick={() => void redo()}>
          <Redo2 className="size-4" aria-hidden />
        </button>
        <button type="button" className={`${btn} text-[var(--muted)] hover:bg-white/[0.07] hover:text-[var(--text)]`} disabled={!draftDirty || applying} onClick={discardDraft}>
          Revert
        </button>
        {!autoApply && (
        <button
          type="button"
          className={`${btn} bg-white text-[#0b0d12] shadow-[0_0_18px_-6px_rgba(255,255,255,0.7)] hover:bg-white/90`}
          disabled={!draftDirty || !connected || applying}
          onClick={() => void commitDraft()}
        >
          Apply to keyboard
          <Kbd>{`${MOD}↵`}</Kbd>
        </button>
        )}
      </div>
    </div>
  );
}
