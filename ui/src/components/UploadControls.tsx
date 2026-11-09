import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { budgetError } from "@/lib/budget";
import { useDialogFocusTrap } from "@/lib/useDialog";
import { selectTotalFrames, useAppStore } from "@/store";

export function UploadControls() {
  const uploads = useAppStore((s) => s.uploads);
  const progress = useAppStore((s) => s.progress);
  const upload = useAppStore((s) => s.upload);
  const cancel = useAppStore((s) => s.cancel);
  const entry = useAppStore((s) => s.entries[s.slot]);
  const entries = useAppStore((s) => s.entries);
  const connected = useAppStore((s) => s.connected);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const lastUploaded = useAppStore((s) => s.lastUploaded);
  const totalFrames = useAppStore(selectTotalFrames);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, confirmOpen);

  const busy = uploads > 0;
  const problem = entry.source ? budgetError({ totalFrames, delayMs: entry.delayMs }) : null;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : 0;

  const blockedReasons: string[] = [];
  if (!connected) blockedReasons.push("Connect a keyboard");
  if (!entry.source) blockedReasons.push("Choose an image or GIF");
  if (entry.source && !entry.info) blockedReasons.push("Counting frames…");
  if (problem) blockedReasons.push(problem);
  const blocked = busy || blockedReasons.length > 0;

  const slotFrames = (s: "slot0" | "slot1") => entries[s].info?.frames ?? "—";
  const slotName = (s: "slot0" | "slot1") => entries[s].name || `Slot ${s === "slot0" ? "0" : "1"}`;
  const dropped = entry.info?.dropped?.length ?? 0;

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
        Write image to board
      </Button>
      {dropped > 0 && entry.info && (
        <p className="rounded-md bg-sky-400/10 px-2 py-1 text-xs text-sky-300" role="note">
          Will drop {dropped} frames: {entry.info.sourceFrames} → {entry.info.frames} to fit 36 total.
        </p>
      )}
      {blockedReasons.length > 0 && !busy && (
        <div id="upload-blocked-reasons" className="text-xs text-white/70" role="note">
          <p>To upload, please:</p>
          <ul className="list-disc pl-4">
            {blockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {!connected && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setActiveTab("device")}>
              Go to Device
            </Button>
          )}
        </div>
      )}
      {busy && (
        <Button variant="outline" onClick={() => void cancel()}>
          Cancel
        </Button>
      )}
      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={percent} />
          <span className="text-xs text-white/70">
            {percent}% · {progress ? `${progress.bytesSent} / ${progress.totalBytes} bytes` : "—"} · {totalFrames} frames
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
            className="dialog-panel w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="upload-confirm-title" className="text-base font-medium text-white">
              Write this image to the board?
            </h3>
            <dl className="mt-3 space-y-1.5 text-sm">
              {(["slot0", "slot1"] as const).map((s) => {
                const before = lastUploaded?.[s]?.name || `Slot ${s === "slot0" ? "0" : "1"} (on board)`;
                const after = slotName(s);
                const beforeFrames = lastUploaded?.[s]?.info?.frames ?? "—";
                const changed = before !== after;
                return (
                  <div key={s} className="flex items-center justify-between gap-3 border-b border-white/10 pb-1.5">
                    <dt className="text-white/70">{s === "slot0" ? "Slot 0" : "Slot 1"}</dt>
                    <dd className="text-right">
                      <span className="text-white/60">{before} · {beforeFrames} frames</span>
                      <span aria-hidden className="text-white/60"> → </span>
                      <span className={changed ? "font-semibold text-sky-300" : ""}>{after} · {slotFrames(s)} frames</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            {dropped > 0 && entry.info && (
              <p className="mt-1 text-xs text-sky-300">Drops {dropped} frames ({entry.info.sourceFrames} → {entry.info.frames}) to fit.</p>
            )}
            <p className="mt-1 text-sm text-white/70">
              Both slots are resent. The other slot keeps its image. This overwrites what the board shows.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirmOpen(false);
                  void upload(entry.delayMs, true);
                }}
              >
                Write image
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
