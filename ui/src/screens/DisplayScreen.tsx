import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const totalFrames = useAppStore(selectTotalFrames);
  const loadSource = useAppStore((s) => s.loadSource);
  const setDelayMs = useAppStore((s) => s.setDelayMs);

  const problem = entry.info ? budgetError({ totalFrames, delayMs: entry.delayMs }) : null;
  const compressed = entry.info && entry.info.dropped.length > 0;

  async function onFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    void loadSource(bytes, file.name);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4 pt-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Tabs value={slot} onValueChange={(v) => setSlot(v as "slot0" | "slot1")}>
            <TabsList>
              <TabsTrigger value="slot0">Slot 0</TabsTrigger>
              <TabsTrigger value="slot1">Slot 1</TabsTrigger>
            </TabsList>
          </Tabs>
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

        <CropEditor />
      </div>

      <div className="flex flex-col gap-4 text-sm">
        <div>
          <div className="mb-1 flex justify-between text-white/60">
            <span>Frame delay</span>
            <span>{entry.delayMs} ms</span>
          </div>
          <Slider
            min={60}
            max={500}
            step={10}
            value={[entry.delayMs]}
            onValueChange={([value]) => setDelayMs(value)}
          />
        </div>

        <div className="rounded-md border border-white/10 p-3">
          <div className="flex justify-between">
            <span className="text-white/60">Frames across both slots</span>
            <span>{`${totalFrames} / 36`}</span>
          </div>
          {entry.name && <p className="mt-1 text-xs text-white/40">{entry.name}</p>}
          {compressed && entry.info && (
            <p className="mt-1 text-xs text-sky-300">
              {`Compressed from ${entry.info.sourceFrames} to ${entry.info.frames} frames to fit the budget.`}
            </p>
          )}
          {problem && <p className="mt-2 text-xs text-amber-300">{problem}</p>}
        </div>

        <UploadControls />

        <p className="text-xs text-white/40">
          Each slot keeps its own image or GIF. Both display slots are sent together, so the untouched
          slot is preserved across restarts.
        </p>
      </div>
    </div>
  );
}
