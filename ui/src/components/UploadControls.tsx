import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { budgetError } from "@/lib/budget";
import { useDialogFocusTrap } from "@/lib/useDialog";
import { dirtySlots, selectTotalFrames, useAppStore } from "@/store";

const num = (s: "slot0" | "slot1") => (s === "slot0" ? "0" : "1");

export function UploadControls() {
  const uploads = useAppStore((s) => s.uploads);
  const progress = useAppStore((s) => s.progress);
  const batch = useAppStore((s) => s.batch);
  const uploadChanged = useAppStore((s) => s.uploadChanged);
  const cancel = useAppStore((s) => s.cancel);
  const slot = useAppStore((s) => s.slot);
  const entries = useAppStore((s) => s.entries);
  const connected = useAppStore((s) => s.connected);
  const lastUploaded = useAppStore((s) => s.lastUploaded);
  const totalFrames = useAppStore(selectTotalFrames);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, confirmOpen);

  const dirty = useMemo(() => dirtySlots(entries, lastUploaded, slot), [entries, lastUploaded, slot]);
  // Listed in slot order, whatever order they are written in.
  const listed = dirty.length === 2 ? (["slot0", "slot1"] as const) : dirty;
  const busy = uploads > 0;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : 0;

  const problem =
    dirty.length > 0
      ? budgetError({ totalFrames, delayMs: Math.min(...dirty.map((s) => entries[s].delayMs)) })
      : null;
  const blockedReasons: string[] = [];
  if (!connected) blockedReasons.push("Connect a keyboard");
  if (dirty.length === 0) blockedReasons.push("No changes to write");
  if (dirty.some((s) => !entries[s].info)) blockedReasons.push("Counting frames…");
  if (problem) blockedReasons.push(problem);
  const blocked = busy || blockedReasons.length > 0;

  const label =
    dirty.length === 0
      ? "Write to board"
      : dirty.length === 1
        ? `Write slot ${num(dirty[0])}`
        : `Write ${dirty.length} slots`;

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        aria-disabled={blocked}
        aria-describedby={blockedReasons.length > 0 && !busy ? "upload-blocked-reasons" : undefined}
        onClick={() => { if (blocked) return; setConfirmOpen(true); }}
        className={blocked ? "opacity-50" : undefined}
      >
        {label}
      </Button>
      {blockedReasons.length > 0 && !busy && (
        <p id="upload-blocked-reasons" className="text-[11px] text-[var(--muted)]" role="note">
          {blockedReasons.join(" · ")}
        </p>
      )}
      {busy && (
        <Button variant="outline" onClick={() => void cancel()}>
          Cancel
        </Button>
      )}
      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={percent} />
          <span className="text-[11px] text-[var(--muted)]">
            {batch ? `Slot ${num(batch.slot)} (${batch.index} of ${batch.total}) · ` : ""}
            {percent}%
          </span>
        </div>
      )}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-confirm-title"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            ref={dialogRef}
            className="dialog-panel w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="upload-confirm-title" className="text-[15px] font-semibold text-[var(--text)]">
              {dirty.length === 1 ? `Write slot ${num(dirty[0])}?` : `Write ${dirty.length} slots?`}
            </h3>
            <ul className="mt-3 flex flex-col gap-1 text-xs text-[var(--muted)]">
              {listed.map((s) => {
                const e = entries[s];
                const dropped = e.info?.dropped?.length ?? 0;
                return (
                  <li key={s}>
                    <span className="text-[var(--text)]">Slot {num(s)}:</span> {e.name || "image"} · {e.info?.frames ?? "—"} frames
                    {dropped > 0 && e.info && (
                      <span className="text-[#c4b5fd]"> (from {e.info.sourceFrames})</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirmOpen(false);
                  void uploadChanged(true);
                }}
              >
                Write
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
