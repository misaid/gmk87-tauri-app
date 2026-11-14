import { useEffect, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { EffectGallery } from "@/components/EffectGallery";
import { LED_COLORS, LED_COLOR_SWATCHES, LED_MODES, PRESET_VALUES } from "@/lib/effects";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

function Panel({ title, children, className, id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className={`rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4 ${className ?? ""}`}>
      <h2 className="mb-3 text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">{title}</h2>
      {children}
    </section>
  );
}

const TINT: Record<string, string> = { gaming: "#ff9f0a", relaxed: "#0a84ff", minimal: "", productivity: "#40c8e0", "purple-wave": "#0a84ff", matrix: "#a7ffb0", sunset: "#ff3b30" };

function LookDot({ name, v }: { name: string; v: { color: number[]; rainbow: number } }) {
  const ring = "inset 0 0 0 1px rgba(255,255,255,0.2)";
  if (name === "minimal") {
    return (
      <span
        aria-hidden
        className="size-3.5 shrink-0 rounded-full"
        style={{ boxShadow: ring, background: "linear-gradient(135deg, transparent 45%, rgba(255,255,255,0.45) 46%, rgba(255,255,255,0.45) 54%, transparent 55%)" }}
      />
    );
  }
  const base = `rgb(${v.color.join(",")})`;
  const bg =
    v.rainbow === 1
      ? "conic-gradient(#ff3b30, #ffcc00, #30d158, #40c8e0, #0a84ff, #8b5cf6, #ff3b30)"
      : `linear-gradient(135deg, ${base}, ${TINT[name] || "#8b5cf6"})`;
  return <span aria-hidden className="size-3.5 shrink-0 rounded-full" style={{ background: bg, boxShadow: ring }} />;
}

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

  const { underglow, led } = effective ?? committed ?? OFFLINE_STATE;

  function stage(patch: Parameters<typeof setLightingDraft>[0]) {
    if (typeof setLightingDraft === "function") setLightingDraft(patch);
  }

  return (
    <div className="grid gap-4 text-[13px] lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
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

      <div className="flex min-w-0 flex-col gap-4">
      <Panel title="Effect">
        <EffectGallery value={underglow.effect} color={underglow.color} rainbow={underglow.rainbow} onSelect={(v) => stage({ underglowEffect: v })} />
      </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <Panel title="Looks">
        <div className="grid grid-cols-2 gap-1.5">
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
                className="flex h-9 items-center gap-2 rounded-[9px] border border-[var(--line)] bg-[var(--panel-2)] px-2 text-left transition-colors duration-150 hover:border-[var(--line-strong)]"
              >
                {v && (
                  <LookDot name={preset.name} v={v} />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium capitalize text-[var(--text)]">
                  {preset.name.replace(/-/g, " ")}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Side light bar" id="side-light-bar">
        <div className="flex flex-col gap-3.5">
          <span
            aria-hidden
            className="block h-1.5 w-full rounded-full ring-1 ring-white/10"
            style={{ background: LED_COLOR_SWATCHES[led.color], opacity: led.color === 8 ? 0.25 : 1 }}
          />
          <div className="grid grid-cols-2 gap-1.5">
            {LED_MODES.map((mode, i) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={led.mode === mode.value}
                onClick={() => stage({ ledMode: mode.value })}
                className={
                  (i === LED_MODES.length - 1 && LED_MODES.length % 2 === 1 ? "col-span-2 " : "") +
                  (led.mode === mode.value
                    ? "h-8 rounded-[7px] bg-[var(--accent)]/20 px-2.5 text-xs font-medium text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent-ambient)]"
                    : "h-8 rounded-[7px] bg-[var(--panel-2)] px-2.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]")
                }
              >
                {mode.name}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
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
            <Label htmlFor="lighting-saturation" className="text-[13px] text-[var(--muted)]">
              Saturation <b className="ml-1 font-semibold text-[var(--text)]">{led.saturation}/9</b>
            </Label>
            <Slider
              id="lighting-saturation"
              className="mt-1"
              min={0}
              max={9}
              step={1}
              value={[led.saturation]}
              onValueChange={([v]) => stage({ ledSaturation: v })}
            />
          </div>
        </div>
      </Panel>
      </div>
    </div>
  );
}
