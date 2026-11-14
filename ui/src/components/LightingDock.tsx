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

const RING_OFFSET = "ring-offset-[#10131a]";

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
  const tint = `rgb(${underglow.color.map((c) => Math.round(c)).join(",")})`;
  const moving = !["static", "off"].includes(underglowCategory(underglow.effect));

  function stage(patch: Parameters<typeof setLightingDraft>[0]) {
    if (typeof setLightingDraft === "function") setLightingDraft(patch);
  }

  const label = "whitespace-nowrap text-[12px] text-[var(--muted)]";
  const value = "font-semibold text-[var(--text)]";

  return (
    <div
      role="group"
      aria-label="Underglow controls"
      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2.5"
    >
      <div className={`flex items-center gap-2 ${rainbowActive ? "opacity-40" : ""}`}>
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
              className={
                selected
                  ? `size-7 rounded-full ring-2 ring-white ring-offset-2 ${RING_OFFSET}`
                  : "size-7 rounded-full ring-1 ring-white/25 transition-transform duration-150 hover:scale-110"
              }
              style={{ background: `rgb(${c.rgb.join(",")})` }}
            />
          );
        })}
        <label
          title="Custom colour"
          data-active={customActive || undefined}
          className={`relative grid size-7 place-items-center rounded-full focus-within:ring-2 focus-within:ring-white ${customActive ? `ring-2 ring-white ring-offset-2 ${RING_OFFSET}` : "ring-1 ring-white/30"} ${rainbowActive ? "pointer-events-none" : "cursor-pointer"}`}
          style={{ background: "conic-gradient(#ff3b30, #ffcc00, #30d158, #40c8e0, #0a84ff, #8b5cf6, #ff3b30)" }}
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

      <div className="flex items-center gap-2.5">
        <label htmlFor="lighting-brightness" className={label}>
          Bright · <span className={value}>{underglow.brightness}/9</span>
        </label>
        <Slider
          id="lighting-brightness"
          aria-label="Brightness"
          className="w-[104px]"
          rangeColor={tint}
          min={0}
          max={9}
          step={1}
          value={[underglow.brightness]}
          onValueChange={([v]) => stage({ underglowBrightness: v })}
        />
      </div>

      <div className={`flex items-center gap-2.5 transition-opacity ${moving ? "" : "opacity-40"}`} title={moving ? undefined : "This effect has no motion"}>
        <label htmlFor="lighting-speed" className={label}>
          Speed · <span className={value}>{displayedSpeed}/9</span>
        </label>
        <Slider
          id="lighting-speed"
          aria-label="Speed"
          className="w-[104px]"
          rangeColor={tint}
          disabled={!moving}
          min={0}
          max={9}
          step={1}
          value={[displayedSpeed]}
          onValueChange={([v]) => stage({ underglowSpeed: 9 - v })}
        />
      </div>

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
  );
}

