import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CropEditor } from "@/components/CropEditor";
import { PanelHead } from "@/components/PanelHead";
import { UploadControls } from "@/components/UploadControls";
import { LIBRARY_DRAG_TYPE, MediaLibraryPanel } from "@/components/MediaLibraryPanel";
import { budgetError } from "@/lib/budget";
import { selectTotalFrames, useAppStore } from "@/store";

const MAX_FRAMES = 36;

function frameCount(n: number): string {
  return `${n} ${n === 1 ? "frame" : "frames"}`;
}

/** One line for a slot: "Empty", or the name with its frame count once known. */
function slotSummary(e: { name: string; info: { frames: number } | null }): string {
  if (!e.name && !e.info) return "Empty";
  const name = e.name || "image";
  return e.info ? `${name} · ${frameCount(e.info.frames)}` : name;
}

/** 36 cells, one per frame the board can hold: slot 0 solid, slot 1 muted, free dim, overflow red. */
function FrameBudget({ slot0, slot1, total }: { slot0: number; slot1: number; total: number }) {
  const over = Math.max(0, total - MAX_FRAMES);
  return (
    <div
      className="flex items-center gap-3"
      role="progressbar"
      aria-valuenow={total}
      aria-valuemin={0}
      aria-valuemax={MAX_FRAMES}
      aria-label="Frame budget used"
    >
      <div aria-hidden className="flex flex-1 gap-[2px]">
        {Array.from({ length: MAX_FRAMES }, (_, i) => {
          const overflow = over > 0 && i >= MAX_FRAMES - Math.min(MAX_FRAMES, over);
          const color = overflow ? "var(--danger)" : i < slot0 ? "var(--text)" : i < slot0 + slot1 ? "var(--muted)" : "rgba(255,255,255,.1)";
          const kind = overflow ? "over" : i < slot0 ? "slot0" : i < slot0 + slot1 ? "slot1" : "free";
          return <span key={i} data-cell={kind} className="h-2.5 flex-1 rounded-[1px]" style={{ background: color }} />;
        })}
      </div>
      <span className={`readout shrink-0 text-[12px] ${over > 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{`${String(total).padStart(2, " ")} / ${MAX_FRAMES}`}</span>
    </div>
  );
}

export default function DisplayScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const slot = useAppStore((s) => s.slot);
  const setSlot = useAppStore((s) => s.setSlot);
  const entry = useAppStore((s) => s.entries[s.slot]);
  const entries = useAppStore((s) => s.entries);
  const board = useAppStore((s) => s.state);
  const totalFrames = useAppStore(selectTotalFrames);
  const loadSource = useAppStore((s) => s.loadSource);
  const libraryUse = useAppStore((s) => s.libraryUse);
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const displayHistory = useAppStore((s) => s.displayHistory);
  const undoDisplayUpload = useAppStore((s) => s.undoDisplayUpload);

  const problem = entry.info ? budgetError({ totalFrames, delayMs: entry.delayMs }) : null;
  const compressed = entry.info && entry.info.dropped.length > 0;
  const empty = !entry.source;
  const framesOf = (s: "slot0" | "slot1") => entries[s].info?.frames ?? (board ? (s === "slot0" ? board.slot0Frames : board.slot1Frames) ?? 0 : 0);

  async function onFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    void loadSource(bytes, file.name);
  }

  const choose = (
    <Button variant={empty ? "default" : "outline"} size="sm" className={empty ? "h-9" : undefined} onClick={() => fileInput.current?.click()}>
      Choose image or GIF
    </Button>
  );

  return (
    <div className="grid gap-3 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section
        className="panel flex flex-col gap-3 p-4"
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
        <PanelHead n={1} title="Screen" id="display-crop" className="mb-0" />
        <div className="mx-auto flex w-full max-w-[620px] gap-2.5" aria-label="Display slots">
          {(["slot0", "slot1"] as const).map((s) => {
            const e = entries[s];
            const hasImage = Boolean(e.source || e.previewUrl);
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
                className="tile flex min-w-0 max-w-[190px] flex-1 flex-col gap-2 p-2 text-left"
              >
                <span aria-hidden className="relative flex aspect-[132/74] w-full items-center justify-center overflow-hidden rounded-[3px] bg-[#050608]" style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,.9)" }}>
                  {e.previewUrl ? (
                    <img src={e.previewUrl} alt="" draggable={false} className="size-full object-cover [image-rendering:pixelated]" />
                  ) : (
                    <span className="readout text-[10px] tracking-[0.16em] text-[var(--dim)]">{hasImage ? "…" : "EMPTY"}</span>
                  )}
                </span>
                <span className="block min-w-0 px-0.5">
                  <span className="silk block !text-[10px]">Slot {s === "slot0" ? "0" : "1"}</span>
                  <span className="readout mt-0.5 block truncate text-[11px] text-[var(--muted)]">{slotSummary(e)}</span>
                </span>
                <span aria-hidden className="tile-led" />
              </button>
            );
          })}
        </div>
        <CropEditor footer={empty ? null : choose} />
        {empty && (
          <div className="flex flex-col items-center gap-2.5 pb-1 text-center">
            <p className="text-[12.5px] text-[var(--muted)]">Drop an image or GIF here</p>
            {choose}
          </div>
        )}
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
      </section>

      <section className="panel flex flex-col gap-5 self-start p-4" aria-labelledby="display-upload">
        <PanelHead n={2} title="Send" id="display-upload" className="mb-0" />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="silk">Frame delay</span>
            <span className="readout text-[12px] text-[var(--text)]">
              {entry.delayMs} ms · {entry.delayMs <= 166 ? "Fast" : entry.delayMs <= 333 ? "Normal" : "Slow"}
            </span>
          </div>
          <Slider id="frame-delay" aria-label="Frame delay" min={60} max={500} step={10} value={[entry.delayMs]} onValueChange={([value]) => setDelayMs(value)} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="silk">Frame budget</span>
          <FrameBudget slot0={framesOf("slot0")} slot1={framesOf("slot1")} total={totalFrames} />
          {compressed && entry.info && <p className="readout text-[11px] text-[var(--muted)]">{`${entry.info.sourceFrames} → ${frameCount(entry.info.frames)}`}</p>}
          {problem && <p className="readout text-[11px] text-[var(--warn)]">{problem}</p>}
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
