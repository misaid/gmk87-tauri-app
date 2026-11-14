import { useEffect } from "react";
import { LightingDock } from "@/components/LightingDock";
import { heroBoardWidth } from "@/components/KeyboardPreview";
import { openLightBar } from "@/components/LightBarPopover";
import { EffectGallery } from "@/components/EffectGallery";
import { LED_COLOR_SWATCHES, LED_MODES, PRESET_VALUES } from "@/lib/effects";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

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

  const modeName = LED_MODES.find((m) => m.value === led.mode)?.name ?? "Side bar";

  return (
    <div className="mx-auto w-full text-[13px]" style={{ maxWidth: heroBoardWidth() }}>
      {history.length > 0 && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => void undoLighting()}
            className="text-xs text-[var(--muted)] underline-offset-4 transition-colors hover:text-[var(--text)] hover:underline"
          >
            Undo last change
          </button>
        </div>
      )}
      <section
        aria-label="Lighting controls"
        className="flex flex-col gap-3 rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] bg-[rgba(12,14,20,0.6)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_14px_40px_-16px_rgba(0,0,0,0.75)] backdrop-blur-xl"
      >
        <LightingDock />
        <div className="h-px bg-white/[0.07]" />
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] font-semibold text-[var(--muted)]">Looks</span>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
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
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-2.5 transition-colors duration-150 hover:border-[var(--line-strong)]"
                >
                  {v && <LookDot name={preset.name} v={v} />}
                  <span className="text-[12px] font-medium capitalize text-[var(--text)]">{preset.name.replace(/-/g, " ")}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={openLightBar}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-2.5 text-[12px] text-[var(--text)] transition-colors hover:bg-white/[0.06]"
          >
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: LED_COLOR_SWATCHES[led.color] }} />
            Light bar · {modeName}
          </button>
        </div>
        <EffectGallery value={underglow.effect} color={underglow.color} rainbow={underglow.rainbow} onSelect={(v) => stage({ underglowEffect: v })} />
      </section>
    </div>
  );
}
