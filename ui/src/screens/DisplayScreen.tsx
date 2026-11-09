import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CropEditor } from "@/components/CropEditor";
import { UploadControls } from "@/components/UploadControls";
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
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const connected = useAppStore((s) => s.connected);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const displayHistory = useAppStore((s) => s.displayHistory);
  const lastUploaded = useAppStore((s) => s.lastUploaded);
  const undoDisplayUpload = useAppStore((s) => s.undoDisplayUpload);

  const problem = entry.info ? budgetError({ totalFrames, delayMs: entry.delayMs }) : null;
  const displayDraftDirty = entry.source != null && (lastUploaded == null || lastUploaded[slot].name !== entry.name);
  const compressed = entry.info && entry.info.dropped.length > 0;

  async function onFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    void loadSource(bytes, file.name);
  }

  return (
    <div className="flex flex-col gap-6 pt-3">
      <div>
        <h1 className="text-[var(--text-h1)] font-semibold text-white">Display</h1>
        <p className="mt-1 text-sm text-white/80">Put an animated image on the 240×135 board display.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/80" role="status">
          <span className="font-medium">Editing Slot {slot === "slot0" ? "0" : "1"}</span>
          <span className="text-white/70">— all steps below affect this slot.</span>
          {(["slot0", "slot1"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSlot(s)} aria-pressed={slot === s} className={slot === s ? "rounded-md bg-white px-2 py-1 text-xs font-medium text-black" : "rounded-md border border-white/15 px-2 py-1 text-xs text-white/80"}>
              Slot {s === "slot0" ? "0" : "1"}
            </button>
          ))}
        </div>
      </div>
      {displayDraftDirty && (
        <p className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-white/80" role="status">
          Display draft: <span className="font-medium text-sky-300">{entry.name || "image"}</span> — Write image to board in step 4 when you're ready. Nothing is on the display yet.
        </p>
      )}
      {!connected && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-white/80" role="note">
          <span>You're offline — you can prepare images, but upload unlocks after connecting.</span>
          <Button variant="outline" size="sm" onClick={() => setActiveTab("device")}>
            Go to Device
          </Button>
        </div>
      )}
      {/* Step 1 — Choose */}
      <section className="flex flex-col gap-3" aria-labelledby="display-step1">
        <h2 id="display-step1" className="flex items-center gap-2 text-[var(--text-h2)] font-medium text-white">
          <span className="flex size-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
          Choose image or GIF
        </h2>
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
        <p className="text-xs text-white/70">Each slot holds one animated image. Slots are sent together — the other slot is preserved.</p>
      </section>

      {/* Step 2 — Crop */}
      <section className="flex flex-col gap-3" aria-labelledby="display-step2">
        <h2 id="display-step2" className="flex items-center gap-2 text-[var(--text-h2)] font-medium text-white">
          <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${entry.source ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10"}`}>2</span>
          Crop to 240 × 135
        </h2>
        <fieldset disabled={!entry.source} className={entry.source ? "" : "pointer-events-none opacity-50"} aria-disabled={!entry.source}>
          <CropEditor />
        </fieldset>
        {!entry.source && <p className="text-xs text-white/70">Choose an image above to start cropping.</p>}
      </section>

      {/* Step 3 — Timing */}
      <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-4" aria-labelledby="display-step3">
        <h2 id="display-step3" className="flex items-center gap-2 text-[var(--text-h2)] font-medium text-white">
          <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${entry.info ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10"}`}>3</span>
          Timing
        </h2>
        <div>
          <div className="mb-1 flex justify-between text-white/80">
            <span>Frame delay (Slot {slot === "slot0" ? "0" : "1"})</span>
            <span className="flex items-center gap-2">
              <span>{entry.delayMs} ms · {entry.delayMs <= 166 ? "Fast" : entry.delayMs <= 333 ? "Normal" : "Slow"}</span>
              <input
                type="number"
                min={60}
                max={500}
                step={10}
                aria-label="Frame delay milliseconds"
                className="w-20 rounded-md border border-white/15 bg-neutral-900 px-2 py-0.5 text-sm text-white"
                value={entry.delayMs}
                onChange={(e) => setDelayMs(Math.min(500, Math.max(60, Number(e.target.value))))}
              />
            </span>
          </div>
          <Slider
            id="frame-delay"
            min={60}
            max={500}
            step={10}
            value={[entry.delayMs]}
            onValueChange={([value]) => setDelayMs(value)}
          />
          <p className="mt-1 text-xs text-white/70">Faster animation uses more frames. Check the live budget before you choose the delay.</p>
        </div>
        <div>
          <div className="flex justify-between text-white/80">
            <span>Animation length (both slots)</span>
            <span>{`${totalFrames} / 36`}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={totalFrames} aria-valuemin={0} aria-valuemax={36} aria-label="Frame budget used">
            <div
              className={
                totalFrames > 36
                  ? "h-full rounded-full bg-red-400"
                  : totalFrames > 30
                    ? "h-full rounded-full bg-amber-400"
                    : "h-full rounded-full bg-emerald-400"
              }
              style={{ width: `${Math.min(100, (totalFrames / 36) * 100)}%` }}
            />
          </div>
          <div className="mt-2 flex gap-2 text-xs text-white/70">
            <span className="rounded bg-white/5 px-2 py-1">Slot 0: {entries.slot0.info?.frames ?? "—"} frames</span>
            <span className="rounded bg-white/5 px-2 py-1">Slot 1: {entries.slot1.info?.frames ?? "—"} frames</span>
            <span className="rounded bg-white/5 px-2 py-1">{totalFrames > 36 ? "Over budget" : totalFrames > 30 ? "Nearly full" : "Fits"}</span>
          </div>
          {compressed && entry.info && (
            <p className="mt-1 text-xs text-sky-300">
              {`Compressed from ${entry.info.sourceFrames} to ${entry.info.frames} frames to fit the budget.`}
            </p>
          )}
          {problem && <p className="mt-2 text-xs text-amber-300">{problem}</p>}
        </div>
      </section>

      {/* Step 4 — Upload */}
      <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-4" aria-labelledby="display-step4">
        <h2 id="display-step4" className="flex items-center gap-2 text-[var(--text-h2)] font-medium text-white">
          <span className="flex size-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">4</span>
          Write image to board
        </h2>
        <UploadControls />

        {displayHistory && displayHistory.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-3">
            <span className="text-xs text-white/70">
              Previous write: {displayHistory.at(-1)?.label} · {displayHistory.length} in history
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void undoDisplayUpload()}>
              Undo write{displayHistory.length > 1 ? ` (${displayHistory.length})` : ""}
            </Button>
          </div>
        )}

        <p className="text-xs text-white/70">
          Writing rewrites both slots. The untouched slot is resent exactly as stored. The last 10 writes can be undone.
        </p>
      </section>
    </div>
  );
}
