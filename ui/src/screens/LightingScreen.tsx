import { useEffect, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EffectGallery } from "@/components/EffectGallery";
import { underglowCategory } from "@/components/lighting";
import { LED_COLORS, LED_COLOR_SWATCHES, LED_MODES, PRESET_VALUES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4 ${className ?? ""}`}>
      <h2 className="mb-3 text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">{title}</h2>
      {children}
    </section>
  );
}

function brightnessWord(v: number): string {
  if (v === 0) return "Off";
  if (v <= 3) return "Dim";
  if (v <= 6) return "Medium";
  if (v <= 8) return "Bright";
  return "Vivid";
}

/** Displayed speed runs slow→fast; the device's 0 is fastest, so invert. */
function speedWord(displayed: number): string {
  if (displayed === 0) return "Slowest";
  if (displayed <= 3) return "Slow";
  if (displayed <= 6) return "Medium";
  if (displayed <= 8) return "Fast";
  return "Fastest";
}

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

export default function LightingScreen() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const history = useAppStore((s) => s.lightingHistory);
  const presets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const undoLighting = useAppStore((s) => s.undoLighting);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const current = effective ?? committed ?? OFFLINE_STATE;
  const { underglow, led } = current;
  const rainbowActive = underglow.rainbow === 1;
  const category = underglowCategory(underglow.effect);
  const canReverse = category === "wave" || category === "rainbow";
  const hex = `#${underglow.color.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  const displayedSpeed = 9 - underglow.speed;

  function stage(patch: Parameters<typeof setLightingDraft>[0]) {
    if (typeof setLightingDraft === "function") setLightingDraft(patch);
  }

  return (
    <div className="grid gap-5 text-[13px] lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      {history.length > 0 && (
        <div className="flex justify-end lg:col-span-2">
          <button
            type="button"
            onClick={() => void undoLighting()}
            className="text-xs text-[var(--muted)] underline-offset-4 transition-colors hover:text-[var(--text)] hover:underline"
          >
            Undo last change
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-5">
      <Panel title="Looks">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {presets.map((preset) => {
            const v = PRESET_VALUES[preset.name];
            return (
              <button
                key={preset.name}
                type="button"
                title={preset.description}
                onClick={() => {
                  if (!v) return;
                  stage({
                    underglowEffect: v.effect,
                    underglowBrightness: v.brightness,
                    underglowSpeed: v.speed,
                    underglowOrientation: v.orientation,
                    underglowRainbow: v.rainbow,
                    underglowColor: v.color,
                    ledMode: v.ledMode,
                    ledSaturation: v.ledSaturation,
                    ledRainbow: v.ledRainbow,
                    ledColor: v.ledColor,
                  });
                }}
                className="flex items-center gap-2.5 rounded-[10px] border border-[var(--line)] bg-[var(--panel-2)] p-2.5 text-left transition-colors duration-150 hover:border-[var(--line-strong)]"
              >
                {v && (
                  <span
                    className="size-3 shrink-0 rounded-full border border-white/20"
                    style={{ background: `rgb(${v.color.join(",")})` }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium capitalize text-[var(--text)]">
                    {preset.name.replace(/-/g, " ")}
                  </span>
                  {v && (
                    <span className="block truncate text-[11px] text-[var(--muted)]">
                      {UNDERGLOW_EFFECTS.find((e) => e.value === v.effect)?.name} · {v.brightness}/9
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Effect">
        <EffectGallery value={underglow.effect} color={underglow.color} rainbow={underglow.rainbow} onSelect={(v) => stage({ underglowEffect: v })} />
      </Panel>

      </div>

      <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4">
      <Panel title="Brightness & speed">
        <div className="grid grid-cols-1 gap-5">
          <div>
            <Label htmlFor="lighting-brightness" className="text-[var(--muted)]">
              Brightness — <span className="text-[var(--text)]">{brightnessWord(underglow.brightness)}</span>
            </Label>
            <Slider
              id="lighting-brightness"
              className="mt-1.5"
              min={0}
              max={9}
              step={1}
              value={[underglow.brightness]}
              onValueChange={([v]) => stage({ underglowBrightness: v })}
            />
          </div>
          <div>
            <Label htmlFor="lighting-speed" className="text-[var(--muted)]">
              Speed — <span className="text-[var(--text)]">{speedWord(displayedSpeed)}</span>
            </Label>
            <Slider
              id="lighting-speed"
              className="mt-1.5"
              min={0}
              max={9}
              step={1}
              value={[displayedSpeed]}
              onValueChange={([v]) => stage({ underglowSpeed: 9 - v })}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Colour">
        <div className={rainbowActive ? "flex flex-wrap items-center gap-2.5 opacity-40" : "flex flex-wrap items-center gap-2.5"}>
          {GLOW_COLORS.map((c) => {
            const selected =
              !rainbowActive &&
              underglow.color[0] === c.rgb[0] &&
              underglow.color[1] === c.rgb[1] &&
              underglow.color[2] === c.rgb[2];
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
                    ? "size-8 rounded-full ring-2 ring-white ring-offset-2 ring-offset-[#0c0e13]"
                    : "size-8 rounded-full ring-1 ring-white/20 transition-transform duration-150 hover:scale-110"
                }
                style={{ background: `rgb(${c.rgb.join(",")})` }}
              />
            );
          })}
          <input
            type="color"
            aria-label="Custom underglow colour"
            disabled={rainbowActive}
            className="size-8 cursor-pointer rounded-full border border-white/20 bg-transparent p-0.5"
            value={hex}
            onChange={(e) => {
              const v = e.target.value;
              stage({
                underglowColor: [
                  parseInt(v.slice(1, 3), 16),
                  parseInt(v.slice(3, 5), 16),
                  parseInt(v.slice(5, 7), 16),
                ],
              });
            }}
          />
        </div>
      </Panel>

      <Panel title="Options">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <label className="flex items-center gap-2.5 text-[var(--text)]">
            <Switch checked={underglow.rainbow === 1} onCheckedChange={(checked) => stage({ underglowRainbow: checked ? 1 : 0 })} />
            Rainbow
          </label>
          <label className={`flex items-center gap-2.5 ${canReverse ? "text-[var(--text)]" : "opacity-40"}`}>
            <Switch
              disabled={!canReverse}
              checked={underglow.orientation === 1}
              onCheckedChange={(checked) => stage({ underglowOrientation: checked ? 1 : 0 })}
            />
            Reverse direction
          </label>
        </div>
      </Panel>

      <details className="group rounded-[18px] border border-[var(--line)] bg-[var(--panel)]">
        <summary className="cursor-pointer list-none px-4 py-3.5 text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
          Side LED bar
        </summary>
        <div className="flex flex-col gap-4 border-t border-[var(--line)] px-4 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {LED_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={led.mode === mode.value}
                onClick={() => stage({ ledMode: mode.value })}
                className={
                  led.mode === mode.value
                    ? "rounded-[7px] bg-[var(--accent)]/20 px-2.5 py-1 text-xs font-medium text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent)]"
                    : "rounded-[7px] bg-[var(--panel-2)] px-2.5 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
                }
              >
                {mode.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {LED_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                aria-label={color.name}
                aria-pressed={led.color === color.value}
                title={color.name}
                onClick={() => stage({ ledColor: color.value })}
                className={
                  led.color === color.value
                    ? "size-7 rounded-full ring-2 ring-white ring-offset-2 ring-offset-[#0c0e13]"
                    : "size-7 rounded-full ring-1 ring-white/20 transition-transform duration-150 hover:scale-110"
                }
                style={{ background: LED_COLOR_SWATCHES[color.value] }}
              />
            ))}
          </div>
          <div>
            <Label htmlFor="lighting-saturation" className="text-[var(--muted)]">
              Saturation — <span className="text-[var(--text)]">{led.saturation}/9</span>
            </Label>
            <Slider
              id="lighting-saturation"
              className="mt-1.5"
              min={0}
              max={9}
              step={1}
              value={[led.saturation]}
              onValueChange={([v]) => stage({ ledSaturation: v })}
            />
          </div>
        </div>
      </details>
      </div>
    </div>
  );
}
