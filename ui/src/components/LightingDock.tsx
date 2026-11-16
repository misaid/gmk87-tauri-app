import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { underglowCategory } from "@/components/lighting";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

const GLOW_COLORS: ReadonlyArray<{ name: string; rgb: [number, number, number] }> = [
  { name: "Red", rgb: [255, 59, 48] },
  { name: "Orange", rgb: [255, 149, 0] },
  { name: "Amber", rgb: [255, 204, 0] },
  { name: "Green", rgb: [48, 209, 88] },
  { name: "Teal", rgb: [64, 200, 224] },
  { name: "Sky", rgb: [10, 132, 255] },
  { name: "Violet", rgb: [139, 92, 246] },
  { name: "White", rgb: [255, 255, 255] },
];


/** Index of the preset swatch matching the live colour, or -1 for a custom colour. */
export function activeSwatchIndex(color: readonly number[], rainbow: number): number {
  if (rainbow === 1) return -1;
  return GLOW_COLORS.findIndex((c) => c.rgb[0] === color[0] && c.rgb[1] === color[1] && c.rgb[2] === color[2]);
}

/** Underglow controls: the header row of the single control panel under the board. */
export function LightingDock() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const { underglow } = effective ?? committed ?? OFFLINE_STATE;
  const rainbowActive = underglow.rainbow === 1;
  const canReverse = ["wave", "rainbow"].includes(underglowCategory(underglow.effect));
  const hex = `#${underglow.color.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  const displayedSpeed = 9 - underglow.speed;
  const activeIdx = activeSwatchIndex(underglow.color, underglow.rainbow);
  const customActive = !rainbowActive && activeIdx === -1;
  const customFill = `rgb(${underglow.color.map((c) => Math.round(c)).join(",")})`;
  const moving = !["static", "off"].includes(underglowCategory(underglow.effect));

  function stage(patch: Parameters<typeof setLightingDraft>[0]) {
    if (typeof setLightingDraft === "function") setLightingDraft(patch);
  }

  return (
    <div className="@container w-full">
      <div role="group" aria-label="Underglow controls" className="flex w-full flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {GLOW_COLORS.map((c, i) => {
              const selected = i === activeIdx;
              return (
                <button
                  key={c.name}
                  type="button"
                  aria-label={c.name}
                  aria-pressed={selected}
                  disabled={rainbowActive}
                  title={c.name}
                  onClick={() => stage({ underglowColor: c.rgb })}
                  className={`swatch ${selected ? "swatch-on" : ""} ${rainbowActive ? "opacity-40" : ""}`}
                  style={{ background: `rgb(${c.rgb.join(",")})`, "--sw": `rgb(${c.rgb.join(",")})` } as CSSProperties}
                />
              );
            })}
            <label
              title={rainbowActive ? "Rainbow is on" : "Custom colour"}
              data-active={customActive || undefined}
              className={`swatch relative grid place-items-center focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--text)] ${customActive || rainbowActive ? "swatch-on" : ""} ${rainbowActive ? "pointer-events-none" : "cursor-pointer"}`}
              style={{ background: customActive ? customFill : "conic-gradient(#ff3b30, #ffcc00, #30d158, #40c8e0, #0a84ff, #8b5cf6, #ff3b30)", "--sw": customActive ? customFill : "#8b5cf6" } as CSSProperties}
            >
              <Plus className="size-3.5 text-white drop-shadow" aria-hidden />
              <input
                type="color"
                aria-label="Custom underglow colour"
                disabled={rainbowActive}
                className="sr-only"
                value={hex}
                onChange={(e) => {
                  const v = e.target.value;
                  stage({ underglowColor: [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)] });
                }}
              />
            </label>
          </div>
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-[12px] text-[var(--text)]">
              <Switch checked={rainbowActive} onCheckedChange={(checked) => stage({ underglowRainbow: checked ? 1 : 0 })} />
              Rainbow
            </label>
            <label className={`flex items-center gap-2 text-[12px] ${canReverse ? "text-[var(--text)]" : "opacity-40"}`} title={canReverse ? undefined : "This effect has no direction"}>
              <Switch
                checked={underglow.orientation === 1}
                disabled={!canReverse}
                onCheckedChange={(checked) => stage({ underglowOrientation: checked ? 1 : 0 })}
              />
              Reverse
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 @[460px]:grid-cols-2">
          <Meter id="lighting-brightness" label="Brightness" aria="Brightness" value={underglow.brightness} onChange={(v) => stage({ underglowBrightness: v })} />
          <div className={`transition-opacity ${moving ? "" : "opacity-40"}`} title={moving ? undefined : "This effect has no motion"}>
            <Meter id="lighting-speed" label="Speed" aria="Speed" value={displayedSpeed} disabled={!moving} onChange={(v) => stage({ underglowSpeed: 9 - v })} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Silkscreen label above; the value as a big mono numeral beside a detent slider. */
function Meter({ id, label, aria, value, disabled, onChange }: { id: string; label: string; aria: string; value: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <div id={id} className="flex flex-col gap-1">
      <span className="silk">{label}</span>
      <div className="flex items-center gap-3">
        <span className="sr-only">{value}/9</span>
        <span aria-hidden className="flex w-[34px] shrink-0 items-baseline justify-end">
          <span className="readout text-[20px] leading-none text-[var(--text)]">{value}</span>
          <span className="readout text-[11px] text-[var(--dim)]">/9</span>
        </span>
        <Slider aria-label={aria} className="min-w-0 flex-1" ticks={10} disabled={disabled} min={0} max={9} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
      </div>
    </div>
  );
}
