import { LightingDock } from "@/components/LightingDock";
import { heroBoardWidth } from "@/components/KeyboardPreview";
import { openLightBar } from "@/components/LightBarPopover";
import { ProfileGallery } from "@/components/ProfileGallery";
import { EffectGallery } from "@/components/EffectGallery";
import { LED_COLOR_SWATCHES, LED_MODES } from "@/lib/effects";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

const heading = "text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--dim)]";
const card =
  "rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] bg-[rgba(12,14,20,0.6)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_14px_40px_-16px_rgba(0,0,0,0.75)] backdrop-blur-xl";

/** Left column under the board: looks and profiles as one gallery, then colour and the light bar. */
export function LightingPanels() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const { led } = effective ?? committed ?? OFFLINE_STATE;
  const modeName = LED_MODES.find((m) => m.value === led.mode)?.name ?? "Side bar";
  return (
    <div className="mx-auto flex w-full flex-col gap-3 text-[13px]" style={{ maxWidth: heroBoardWidth() }}>
      <section className={card} aria-label="Looks and profiles">
        <h3 className={`${heading} mb-2`}>Looks and profiles</h3>
        <ProfileGallery compact />
      </section>
      <section className={card} aria-label="Colour, brightness and speed">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className={heading}>Colour</h3>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={openLightBar}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-2.5 text-[12px] text-[var(--text)] transition-colors hover:bg-white/[0.06]"
          >
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: LED_COLOR_SWATCHES[led.color] }} />
            Light bar
            <span className="text-[var(--muted)]">· {modeName}</span>
          </button>
        </div>
        <LightingDock />
      </section>
    </div>
  );
}

/** The inspector: just the live effect browser. */
export function EffectsPanel() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const { underglow } = effective ?? committed ?? OFFLINE_STATE;
  return (
    <section className={card} aria-label="Effects">
      <EffectGallery
        value={underglow.effect}
        color={underglow.color}
        rainbow={underglow.rainbow}
        onSelect={(v) => typeof setLightingDraft === "function" && setLightingDraft({ underglowEffect: v })}
      />
    </section>
  );
}

export default function LightingScreen() {
  return (
    <div aria-label="Lighting controls" role="region" className="flex w-full flex-col gap-3">
      <LightingPanels />
      <EffectsPanel />
    </div>
  );
}
