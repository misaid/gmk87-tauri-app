import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CropEditor } from "@/components/CropEditor";
import { UploadControls } from "@/components/UploadControls";
import { LIBRARY_DRAG_TYPE, MediaLibraryPanel } from "@/components/MediaLibraryPanel";
import { budgetError } from "@/lib/budget";
import { selectTotalFrames, useAppStore } from "@/store";

export default function DisplayScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const slot = useAppStore((s) => s.slot);
  const setSlot = useAppStore((s) => s.setSlot);
  const entry = useAppStore((s) => s.entries[s.slot]);
  const entries = useAppStore((s) => s.entries);
  const totalFrames = useAppStore(selectTotalFrames);
  const loadSource = useAppStore((s) => s.loadSource);
  const libraryUse = useAppStore((s) => s.libraryUse);
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const connected = useAppStore((s) => s.connected);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const displayHistory = useAppStore((s) => s.displayHistory);
  const undoDisplayUpload = useAppStore((s) => s.undoDisplayUpload);

  const problem = entry.info ? budgetError({ totalFrames, delayMs: entry.delayMs }) : null;
  const compressed = entry.info && entry.info.dropped.length > 0;

  async function onFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    void loadSource(bytes, file.name);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section
        className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4"
        aria-labelledby="display-crop"
        onDragOver={(ev) => {
          if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
        }}
        onDrop={(ev) => {
          const file = ev.dataTransfer.files?.[0];
          if (!file) return;
          ev.preventDefault();
          void onFile(file);
        }}
      >
        <h2 id="display-crop" className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
          Image & crop
        </h2>
        <div className="grid grid-cols-2 gap-2" aria-label="Display slots">
          {(["slot0", "slot1"] as const).map((s) => {
            const e = entries[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                onDragOver={(ev) => {
                  if (ev.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) ev.preventDefault();
                }}
                onDrop={(ev) => {
                  const id = ev.dataTransfer.getData(LIBRARY_DRAG_TYPE);
                  if (!id) return;
                  ev.preventDefault();
                  ev.stopPropagation();
                  void libraryUse(id, s);
                }}
                aria-pressed={slot === s}
                className={
                  slot === s
                    ? "rounded-[10px] border border-[var(--accent)] bg-[var(--accent)]/12 p-2.5 text-left shadow-[0_0_0_1px_var(--accent)]"
                    : "rounded-[10px] border border-[var(--line)] bg-[var(--panel-2)] p-2.5 text-left transition-colors hover:border-[var(--line-strong)]"
                }
              >
                <span className="block text-[12px] font-medium text-[var(--text)]">
                  Slot {s === "slot0" ? "0" : "1"}
                </span>
                <span className="block truncate text-[11px] text-[var(--muted)]">
                  {e.name || "empty"} · {e.info?.frames ?? "—"} frames
                </span>
              </button>
            );
          })}
        </div>
        <CropEditor />
        {!entry.source && <p className="text-[11px] text-[var(--muted)]">Choose an image to start cropping.</p>}
      </section>

      <section className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4" aria-labelledby="display-upload">
        <h2 id="display-upload" className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
          Send to board
        </h2>

        {!connected && (
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--warn)]/30 bg-[var(--warn)]/10 p-3 text-xs text-[#fde68a]" role="note">
            <span>You're offline — you can prepare images, but upload unlocks after connecting.</span>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("device")}>
              Go to Device
            </Button>
          </div>
        )}

        <div>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            Choose image or GIF
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.gif"
            className="hidden"
            aria-label="Choose image or GIF"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            Each slot holds one animated image. Slots are sent together — the other slot is preserved.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span>Frame delay</span>
            <span className="text-[var(--text)]">
              {entry.delayMs} ms · {entry.delayMs <= 166 ? "Fast" : entry.delayMs <= 333 ? "Normal" : "Slow"}
            </span>
          </div>
          <Slider
            id="frame-delay"
            className="mt-1.5"
            min={60}
            max={500}
            step={10}
            value={[entry.delayMs]}
            onValueChange={([value]) => setDelayMs(value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span>Frame budget</span>
            <span className="text-[var(--text)]">{`${totalFrames} / 36`}</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={totalFrames}
            aria-valuemin={0}
            aria-valuemax={36}
            aria-label="Frame budget used"
          >
            <div
              className={
                totalFrames > 36
                  ? "h-full rounded-full bg-[var(--danger)]"
                  : totalFrames > 30
                    ? "h-full rounded-full bg-[var(--warn)]"
                    : "h-full rounded-full bg-[var(--success)]"
              }
              style={{ width: `${Math.min(100, (totalFrames / 36) * 100)}%` }}
            />
          </div>
          {compressed && entry.info && (
            <p className="mt-1.5 text-[11px] text-[#a5b4fc]">
              {`Compressed from ${entry.info.sourceFrames} to ${entry.info.frames} frames to fit the budget.`}
            </p>
          )}
          {problem && <p className="mt-1.5 text-[11px] text-[#fde68a]">{problem}</p>}
        </div>

        <UploadControls />

        {(displayHistory?.length ?? 0) > 0 && (
          <button
            type="button"
            className="self-start text-xs text-[var(--muted)] underline-offset-4 transition-colors hover:text-[var(--text)] hover:underline"
            onClick={() => void undoDisplayUpload()}
          >
            Undo last write
          </button>
        )}
      </section>

      <MediaLibraryPanel />
    </div>
  );
}
