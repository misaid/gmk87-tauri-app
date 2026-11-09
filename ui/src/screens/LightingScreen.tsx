import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useDialogFocusTrap } from "@/lib/useDialog";
import { EFFECT_DESCRIPTIONS, LED_COLORS, LED_COLOR_SWATCHES, LED_MODE_DESCRIPTIONS, LED_MODES, PRESET_VALUES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { EffectGallery } from "@/components/EffectGallery";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

function brightnessWord(v: number): string {
  if (v === 0) return "Off";
  if (v <= 3) return "Dim";
  if (v <= 6) return "Medium";
  if (v <= 8) return "Bright";
  return "Vivid";
}

function speedWord(v: number): string {
  if (v <= 2) return "Fast";
  if (v <= 5) return "Medium";
  if (v <= 7) return "Slow";
  return "Slowest";
}

const SUB_TABS = ["pick", "tune", "leds", "history"] as const;
type SubTab = (typeof SUB_TABS)[number];
const SUB_LABELS: Record<SubTab, string> = {
  pick: "Pick",
  tune: "Fine tune",
  leds: "Side LEDs",
  history: "History",
};

export default function LightingScreen() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const history = useAppStore((s) => s.lightingHistory);
  const presets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const applyLighting = useAppStore((s) => s.applyLighting);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const undoLighting = useAppStore((s) => s.undoLighting);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [pendingRestore, setPendingRestore] = useState<number | null>(null);
  const [sub, setSub] = useState<SubTab>("pick");
  const restoreRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(restoreRef, pendingRestore !== null);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  function stage(patch: Parameters<typeof setLightingDraft>[0]) {
    if (typeof setLightingDraft === "function") setLightingDraft(patch);
    else void applyLighting(patch);
  }

  const offline = !committed;
  const current = effective ?? committed ?? OFFLINE_STATE;
  const { underglow, led } = current;
  const hex = `#${underglow.color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const [hexError, setHexError] = useState(false);
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  function commitHex(value: string) {
    const v = value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) { setHexError(true); return; }
    setHexError(false);
    setHexDraft(null);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      stage({
        underglowColor: [
          parseInt(v.slice(1, 3), 16),
          parseInt(v.slice(3, 5), 16),
          parseInt(v.slice(5, 7), 16),
        ],
      });
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-[var(--space-section)] pt-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[var(--text-h1)] font-semibold text-white">Lighting</h1>
          <p className="mt-1 text-sm text-white/80">
            {draftDirty ? "You have a draft — Write to board below when you're ready." : "Changes become a draft first, then Write to board."}
          </p>
        </div>
        {history && history.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void undoLighting()}>
            Undo last write{history.length > 1 ? ` (${history.length})` : ""}
          </Button>
        )}
      </div>

      {offline && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-white/80" role="note">
          <span>You're offline — stage lighting here; it waits as a draft until you connect, then Write to board.</span>
          <Button variant="outline" size="sm" onClick={() => setActiveTab("device")}>
            Go to Device
          </Button>
        </div>
      )}
      <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/95 p-2" aria-label="Lighting sections">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            type="button"
            aria-current={sub === t ? "true" : undefined}
            onClick={() => {
              setSub(t);
              document.getElementById(`lighting-${t}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={
              sub === t
                ? "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                : "rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40 hover:text-white"
            }
          >
            {SUB_LABELS[t]}{t === "history" && history?.length ? ` (${history.length})` : ""}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/80" role="status">
          {draftDirty ? "Draft — not on board" : "On board"}
        </span>
      </nav>

      <section id="lighting-pick" className="flex flex-col gap-[var(--space-card)] rounded-lg border border-white/10 p-4" aria-labelledby="underglow-heading">
          <h2 id="underglow-heading" className="text-[var(--text-h2)] font-medium text-white">Pick an effect</h2>
          <div className="flex flex-wrap gap-1.5" aria-label="Lighting presets">
            {presets.map((preset) => {
              const v = PRESET_VALUES[preset.name];
              return (
              <Button
                key={preset.name}
                variant="outline"
                size="sm"
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
              >
                {v && <span className="size-2.5 shrink-0 rounded-full border border-white/20" style={{ background: `rgb(${v.color.join(",")})` }} aria-hidden />}
                {preset.name.replace(/-/g, " ")}
                {v && <span className="text-white/50">· {UNDERGLOW_EFFECTS.find((e) => e.value === v.effect)?.name} {v.brightness}/9</span>}
              </Button>
              );
            })}
          </div>
          <EffectGallery value={underglow.effect} base={underglow} onSelect={(v) => stage({ underglowEffect: v })} />
          <p className="text-xs text-white/70">{EFFECT_DESCRIPTIONS[underglow.effect]}</p>
        </section>

        <section id="lighting-tune" className="flex flex-col gap-[var(--space-card)] rounded-lg border border-white/10 p-4" aria-labelledby="tune-heading">
          <h2 id="tune-heading" className="text-[var(--text-h2)] font-medium text-white">Fine tune</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="lighting-brightness">Brightness: {brightnessWord(underglow.brightness)} ({underglow.brightness}/9)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Slider
                  id="lighting-brightness"
                  min={0}
                  max={9}
                  step={1}
                  value={[underglow.brightness]}
                  onValueChange={([v]) => stage({ underglowBrightness: v })}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0}
                  max={9}
                  aria-label="Brightness number"
                  className="w-14 rounded-md border border-white/15 bg-neutral-900 px-2 py-1 text-sm text-white"
                  value={underglow.brightness}
                  onChange={(e) => stage({ underglowBrightness: Math.min(9, Math.max(0, Number(e.target.value))) })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="lighting-speed">Speed: {speedWord(underglow.speed)} ({underglow.speed}/9)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Slider
                  id="lighting-speed"
                  min={0}
                  max={9}
                  step={1}
                  value={[underglow.speed]}
                  onValueChange={([v]) => stage({ underglowSpeed: v })}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0}
                  max={9}
                  aria-label="Speed number"
                  className="w-14 rounded-md border border-white/15 bg-neutral-900 px-2 py-1 text-sm text-white"
                  value={underglow.speed}
                  onChange={(e) => stage({ underglowSpeed: Math.min(9, Math.max(0, Number(e.target.value))) })}
                />
              </div>
              <p className="mt-1 flex justify-between text-xs text-white/70"><span>Fast</span><span>0 is fastest, 9 is slowest</span><span>Slowest</span></p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3">
            <span className="text-sm text-white/80">Colour</span>
            <span className="size-8 rounded-full border border-white/20" style={{ background: hex }} aria-hidden />
            <input
              type="color"
              aria-label="Underglow colour"
              className="h-9 w-14 cursor-pointer rounded-md border border-white/15 bg-neutral-900 p-1"
              value={hex}
              onChange={(e) => commitHex(e.target.value)}
            />
            <input
              type="text"
              aria-label="Underglow hex"
              value={hexDraft ?? hex}
              aria-describedby="hex-help"
              placeholder="#rrggbb"
              className="h-9 w-28 rounded-md border border-white/15 bg-neutral-900 px-2 font-mono text-xs text-white"
              onChange={(e) => { setHexDraft(e.target.value); setHexError(false); }}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
                if (e.key === "Escape") { setHexDraft(null); setHexError(false); (e.target as HTMLInputElement).blur(); }
              }}
            />
            <span id="hex-help" className="text-xs text-white/60">Like #8e4ec6</span>
            {hexError && <span role="alert" className="text-xs text-amber-300">Use 6 hex digits, like #ff8800</span>}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2">
              <Switch
                checked={underglow.rainbow === 1}
                onCheckedChange={(checked) => stage({ underglowRainbow: checked ? 1 : 0 })}
              />
              Rainbow — cycles hues
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={underglow.orientation === 1}
                onCheckedChange={(checked) => stage({ underglowOrientation: checked ? 1 : 0 })}
              />
              Right to left — flips waves
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3">
            <label className="flex items-center gap-2 text-sm text-white/80">
              <Switch checked={current.winLock} onCheckedChange={(checked) => stage({ winLock: checked })} />
              Lock Windows key — stops it opening Start mid-game
            </label>
            <span className="text-xs text-white/70">Device shows its state — this is the only switch.</span>
          </div>
        </section>

        <section id="lighting-leds" className="flex flex-col gap-[var(--space-card)] rounded-lg border border-white/10 p-4" aria-labelledby="led-heading">
          <h2 id="led-heading" className="text-[var(--text-h2)] font-medium text-white">Side LEDs</h2>
          <div>
            <p className="text-xs font-medium text-white/80" id="led-mode-label">Mode</p>
            <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="led-mode-label">
              {LED_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={led.mode === mode.value}
                  onClick={() => stage({ ledMode: mode.value })}
                  className={
                    led.mode === mode.value
                      ? "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                      : "rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40"
                  }
                >
                  {mode.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-white/70">{LED_MODE_DESCRIPTIONS[led.mode]}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-white/80" id="led-color-label">Colour</p>
            <div className="mt-1 flex flex-wrap items-center gap-2" role="group" aria-labelledby="led-color-label">
              {LED_COLORS.map((color) => (
                <button
                  key={color.value}
                  aria-label={color.name}
                  aria-pressed={led.color === color.value}
                  title={color.name}
                  className={
                    led.color === color.value
                      ? "size-10 rounded-full ring-2 ring-white ring-offset-2 ring-offset-black"
                      : "size-10 rounded-full ring-1 ring-white/30"
                  }
                  style={{ background: LED_COLOR_SWATCHES[color.value] }}
                  onClick={() => stage({ ledColor: color.value })}
                />
              ))}
              <span className="text-xs text-white/70">{LED_COLORS.find((c) => c.value === led.color)?.name}</span>
            </div>
          </div>
          <div>
            <Label htmlFor="lighting-saturation">Saturation: {led.saturation}/9 — {led.saturation === 0 ? "washed out" : led.saturation >= 8 ? "fully vivid" : "vividness"}</Label>
            <div className="mt-1 flex items-center gap-2">
              <Slider
                id="lighting-saturation"
                min={0}
                max={9}
                step={1}
                value={[led.saturation]}
                onValueChange={([v]) => stage({ ledSaturation: v })}
                className="flex-1"
              />
              <input
                type="number"
                min={0}
                max={9}
                aria-label="Saturation number"
                className="w-14 rounded-md border border-white/15 bg-neutral-900 px-2 py-1 text-sm text-white"
                value={led.saturation}
                onChange={(e) => stage({ ledSaturation: Math.min(9, Math.max(0, Number(e.target.value))) })}
              />
            </div>
          </div>
        </section>

        <section id="lighting-history" className="flex flex-col gap-3 rounded-lg border border-white/10 p-4" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-[var(--text-h2)] font-medium text-white">History</h2>
          {history && history.length > 0 ? (
            <>
              <ol className="flex flex-col gap-1">
                {[...history].reverse().map((entry, i) => {
                  const h = (entry as { state?: unknown }).state ?? entry;
                  const hs = h as NonNullable<typeof committed>;
                  const name = UNDERGLOW_EFFECTS.find((e) => e.value === hs.underglow.effect)?.name ?? `${hs.underglow.effect}`;
                  const at = (entry as { at?: number }).at;
                  const when = at ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at)) : "";
                  const idx = history.length - 1 - i;
                  return (
                    <li key={`${hs.underglow.effect}-${hs.underglow.brightness}-${idx}`}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded bg-white/5 px-2 py-1.5 text-left text-xs text-white/80 hover:bg-white/10"
                        onClick={() => setPendingRestore(idx)}
                      >
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: `rgb(${hs.underglow.color[0]}, ${hs.underglow.color[1]}, ${hs.underglow.color[2]})` }} aria-hidden />
                        <span className="font-medium text-white">{name}</span>
                        <span>· {hs.underglow.brightness}/9 · {LED_MODES.find((m) => m.value === hs.led.mode)?.name}</span>
                        {when && <span className="ml-auto text-white/70">{when}</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <Button variant="ghost" size="sm" className="self-start" onClick={() => void undoLighting()}>
                Undo last write
              </Button>
            </>
          ) : (
            <p className="text-xs text-white/70">No writes yet — the first Write to board starts history. You can undo any write.</p>
          )}
        </section>

      {draftDirty && (
        <div className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/30 bg-neutral-950/95 p-3 shadow-2xl" role="status">
          <span className="flex-1 text-xs text-white/80">{offline ? "Draft staged offline — connect to write." : "Draft — not on board. Write when the look is right."}</span>
          <Button size="sm" disabled={offline} title={offline ? "Connect to write" : undefined} onClick={() => useAppStore.getState().setShowWriteConfirm(true)}>Write to board</Button>
          <Button variant="outline" size="sm" onClick={() => useAppStore.getState().discardDraft()}>Discard</Button>
        </div>
      )}

      {pendingRestore !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-confirm-title"
          onClick={() => setPendingRestore(null)}
        >
          <div ref={restoreRef} className="dialog-panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 id="restore-confirm-title" className="text-base font-medium text-white">Bring back that look?</h3>
            <p className="mt-2 text-sm text-white/80">
              Loads it as your draft — nothing writes until you choose Write to board. {(history?.length ?? 0) - 1 - pendingRestore > 0 && `${(history?.length ?? 0) - 1 - pendingRestore} newer write(s) stay in history.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingRestore(null)}>Cancel</Button>
              <Button onClick={() => { const idx = pendingRestore; setPendingRestore(null); const h = history?.[idx]; if (h) { const hs = (h as { state?: unknown }).state ?? h; stage({ underglowEffect: (hs as NonNullable<typeof committed>).underglow.effect, underglowBrightness: (hs as NonNullable<typeof committed>).underglow.brightness, underglowSpeed: (hs as NonNullable<typeof committed>).underglow.speed, underglowOrientation: (hs as NonNullable<typeof committed>).underglow.orientation, underglowRainbow: (hs as NonNullable<typeof committed>).underglow.rainbow, underglowColor: (hs as NonNullable<typeof committed>).underglow.color, ledMode: (hs as NonNullable<typeof committed>).led.mode, ledSaturation: (hs as NonNullable<typeof committed>).led.saturation, ledRainbow: (hs as NonNullable<typeof committed>).led.rainbow, ledColor: (hs as NonNullable<typeof committed>).led.color }); } }}>Use as draft</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
