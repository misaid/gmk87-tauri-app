import type { DeviceState } from "@/lib/ipc";
import { LED_COLORS, LED_MODES, PRESET_VALUES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { underglowCategory } from "@/components/lighting";
import type { ProfileLighting } from "@/lib/profiles";

export type SyncStatus = "synced" | "draft" | "applying" | "offline" | "error";

/** One honest status for the sync bar, derived from store facts. */
export function deriveSyncStatus(f: { connected: boolean; draftDirty: boolean; applying: boolean; applyFailed?: boolean }): SyncStatus {
  if (f.applying) return "applying";
  if (!f.connected) return "offline";
  if (f.applyFailed && f.draftDirty) return "error";
  return f.draftDirty ? "draft" : "synced";
}

const effectName = (v: number) => UNDERGLOW_EFFECTS.find((e) => e.value === v)?.name ?? String(v);
const modeName = (v: number) => LED_MODES.find((m) => m.value === v)?.name ?? String(v);
const ledColorName = (v: number) => LED_COLORS.find((c) => c.value === v)?.name ?? String(v);
const rgbText = (c: readonly number[]) => `rgb(${c.map((n) => Math.round(n)).join(", ")})`;
const onOff = (v: number | boolean) => (v ? "On" : "Off");

/** Human-readable changes from `base` (what the board has) to `next` (the draft). */
export function diffSummary(base: DeviceState, next: DeviceState): string[] {
  const out: string[] = [];
  const a = base.underglow;
  const b = next.underglow;
  if (a.effect !== b.effect) out.push(`Effect: ${effectName(a.effect)} → ${effectName(b.effect)}`);
  if (a.brightness !== b.brightness) out.push(`Brightness ${a.brightness} → ${b.brightness}`);
  if (a.speed !== b.speed) out.push(`Speed ${9 - a.speed} → ${9 - b.speed}`);
  if (a.rainbow !== b.rainbow) out.push(`Rainbow ${onOff(a.rainbow)} → ${onOff(b.rainbow)}`);
  if (a.color.join() !== b.color.join()) out.push(`Colour ${rgbText(a.color)} → ${rgbText(b.color)}`);
  if (a.orientation !== b.orientation) out.push(`Direction ${a.orientation ? "Reverse" : "Forward"} → ${b.orientation ? "Reverse" : "Forward"}`);
  if (base.led.mode !== next.led.mode) out.push(`Light bar: ${modeName(base.led.mode)} → ${modeName(next.led.mode)}`);
  if (base.led.color !== next.led.color) out.push(`Light bar colour: ${ledColorName(base.led.color)} → ${ledColorName(next.led.color)}`);
  if (base.led.saturation !== next.led.saturation) out.push(`Saturation ${base.led.saturation} → ${next.led.saturation}`);
  if (base.led.rainbow !== next.led.rainbow) out.push(`Light bar rainbow ${onOff(base.led.rainbow)} → ${onOff(next.led.rainbow)}`);
  if (base.winLock !== next.winLock) out.push(`Win lock ${onOff(base.winLock)} → ${onOff(next.winLock)}`);
  return out;
}

/** Whether the lighting in `s` equals a profile's saved lighting. */
export function profileMatches(p: ProfileLighting, s: DeviceState): boolean {
  return (
    JSON.stringify([p.underglow.effect, p.underglow.brightness, p.underglow.speed, p.underglow.orientation, p.underglow.rainbow, p.underglow.color, p.led.mode, p.led.saturation, p.led.rainbow, p.led.color]) ===
    JSON.stringify([s.underglow.effect, s.underglow.brightness, s.underglow.speed, s.underglow.orientation, s.underglow.rainbow, s.underglow.color, s.led.mode, s.led.saturation, s.led.rainbow, s.led.color])
  );
}

/** Name of the built-in Look whose values equal the state, if any. */
export function matchingLook(s: DeviceState): string | null {
  for (const [name, v] of Object.entries(PRESET_VALUES)) {
    if (
      v.effect === s.underglow.effect && v.brightness === s.underglow.brightness && v.speed === s.underglow.speed &&
      v.rainbow === s.underglow.rainbow && v.ledMode === s.led.mode && v.ledColor === s.led.color &&
      (v.effect === 0 || v.color.join() === s.underglow.color.join())
    ) return name;
  }
  return null;
}

export type EffectFilter = "all" | "static" | "wave" | "reactive" | "rainbow";
export const EFFECT_FILTERS: ReadonlyArray<{ id: EffectFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "static", label: "Static" },
  { id: "wave", label: "Wave" },
  { id: "reactive", label: "Reactive" },
  { id: "rainbow", label: "Rainbow" },
];

/** Effects shown for a filter. Off lives under All and Static; breathing counts as Static. */
export function filterEffects(filter: EffectFilter): typeof UNDERGLOW_EFFECTS {
  if (filter === "all") return UNDERGLOW_EFFECTS;
  return UNDERGLOW_EFFECTS.filter((e) => {
    const c = underglowCategory(e.value);
    return filter === "static" ? c === "static" || c === "breathing" || c === "off" : c === filter;
  });
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
