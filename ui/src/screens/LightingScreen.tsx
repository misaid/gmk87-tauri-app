import { LightingDock } from "@/components/LightingDock";
import { openLightBar } from "@/components/LightBarPopover";
import { PanelHead } from "@/components/PanelHead";
import { ProfileGallery } from "@/components/ProfileGallery";
import { EffectGallery } from "@/components/EffectGallery";
import { LED_COLOR_SWATCHES, LED_MODES } from "@/lib/effects";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** The side light bar as a key: the bar's own capsule drawn in its live colour, then the mode name. */
function LightBarKey() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const { led } = effective ?? committed ?? OFFLINE_STATE;
  const modeName = LED_MODES.find((m) => m.value === led.mode)?.name ?? "Side bar";
  const rainbow = led.rainbow === 1 || led.mode === 1;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openLightBar}
      className="keycap-dark flex h-8 shrink-0 items-center gap-2.5 px-2.5 text-[12px]"
    >
      <span
        aria-hidden
        className="block h-[6px] w-7 rounded-full"
        style={{
          background: rainbow ? "linear-gradient(90deg,#e5484d,#ffd60a,#46a758,#0091ff,#8e4ec6)" : LED_COLOR_SWATCHES[led.color],
          boxShadow: `0 0 8px -1px ${rainbow ? "#8e4ec6" : LED_COLOR_SWATCHES[led.color]}`,
        }}
      />
      <span className="sr-only">Light bar</span>
      <span aria-hidden className="silk !text-[10px]">Bar</span>
      <span className="readout text-[11px] text-[var(--muted)]">{modeName}</span>
    </button>
  );
}

/** Left column under the rail: colour, brightness and speed first, then looks and profiles. */
export function LightingPanels() {
  return (
    <div className="flex w-full flex-col gap-3 text-[13px]">
      <section className="panel p-4" aria-labelledby="lighting-colour">
        <PanelHead n={1} title="Colour" id="lighting-colour">
          <LightBarKey />
        </PanelHead>
        <LightingDock />
      </section>
      <section className="panel p-4" aria-labelledby="lighting-looks">
        <PanelHead n={2} title="Looks" id="lighting-looks" />
        <ProfileGallery compact />
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
    <section className="panel p-4" aria-label="Underglow effects">
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
