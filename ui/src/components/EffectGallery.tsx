import { useEffect, useState, type KeyboardEvent } from "react";
import { Activity, ArrowRight, CircleDot, Lightbulb, Orbit, Rainbow, Radio, Sparkles, Waves, Wind, CloudRain, type LucideIcon } from "lucide-react";
import { EFFECT_DESCRIPTIONS } from "@/lib/effects";
import { EFFECT_FILTERS, filterEffects, type EffectFilter } from "@/lib/lightingSync";
import { underglowCategory } from "@/components/lighting";
import { UNDERGLOW_EFFECTS } from "@/lib/effects";
import { type LedLighting } from "@/lib/ledField";
import { BoardThumb } from "@/components/BoardThumb";
import { useAppStore } from "@/store";

/** Thumbnails use the board's live colour so the picker previews what you will get. */
const THUMB_BASE: LedLighting = { effect: 0, brightness: 9, speed: 3, orientation: 0, rainbow: 0, color: [139, 92, 246] };
/** Per-family motion cue shown in each tile's corner. */
const EFFECT_ICON: Record<number, LucideIcon> = {
  1: ArrowRight, 2: Activity, 3: CloudRain, 4: Rainbow, 5: Activity, 6: Lightbulb, 7: Sparkles, 8: Radio,
  9: ArrowRight, 10: Sparkles, 11: Rainbow, 12: Wind, 13: CircleDot, 14: Orbit, 15: CloudRain, 16: Waves,
  17: Rainbow, 18: Rainbow,
};

export function EffectGallery({
  value,
  color,
  rainbow,
  onSelect,
}: {
  value: number;
  color: [number, number, number];
  rainbow: number;
  onSelect: (effect: number) => void;
}) {
  const [focused, setFocused] = useState(value);
  const [hover, setHover] = useState<number | null>(null);
  const [filter, setFilter] = useState<EffectFilter>("all");
  const previewEffect = useAppStore((st) => st.previewEffect);
  const previewingOther = previewEffect !== null && previewEffect !== value;
  const list = filterEffects(filter);
  const setPreviewEffect = useAppStore((st) => st.setPreviewEffect) ?? (() => {});
  useEffect(() => () => setPreviewEffect(null), [setPreviewEffect]);

  useEffect(() => {
    setFocused(value);
  }, [value]);

  /** Columns the grid currently renders (it is container-responsive). */
  const columnsOf = (e: KeyboardEvent) => {
    const group = e.currentTarget.closest('[role="radiogroup"]');
    const n = group ? getComputedStyle(group).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    return n > 0 ? n : 4;
  };

  const moveFocus = (e: KeyboardEvent, nextIndex: number) => {
    e.preventDefault();
    const group = e.currentTarget.closest('[role="radiogroup"]');
    const options = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]')] : [];
    const next = options[nextIndex];
    if (!next) return;
    next.focus();
    setFocused(list[nextIndex]?.value ?? value);
  };

  const shown = UNDERGLOW_EFFECTS.find((e) => e.value === (previewEffect ?? value));
  const shownCategory = underglowCategory(shown?.value ?? value);
  const categoryLabel = shownCategory === "off" || shownCategory === "breathing" ? "static" : shownCategory;
  const idx = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="@container flex flex-col gap-3">
      {/* Now playing: the effect index, its family as a silkscreen label, and its name in the display face. */}
      <div className="border-b border-[var(--line)] pb-3" aria-live="off">
        <div className="flex items-baseline justify-between">
          <span className="readout text-[12px] text-[var(--dim)]">{idx(shown?.value ?? value)}</span>
          <span className="silk !text-[10px]">{categoryLabel}</span>
        </div>
        <div
          className={`display mt-0.5 truncate text-[20px] uppercase ${previewingOther ? "text-[var(--muted)]" : "text-[var(--text)]"}`}
          style={{ transition: "color var(--t-move) var(--ease)" }}
        >
          {shown?.name ?? "—"}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="tablist" aria-label="Effect category" className="flex flex-wrap gap-1">
          {EFFECT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className="keycap-dark h-7 px-3 text-[12px]"
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="readout ml-auto text-[11px] text-[var(--dim)]">{list.length} effects</span>
      </div>
      <div role="radiogroup" aria-label="Underglow effect" className="grid grid-cols-2 gap-2.5 @[600px]:grid-cols-3 @[880px]:grid-cols-4">
        {list.map((effect, i) => {
          const selected = effect.value === value;
          const Icon = EFFECT_ICON[effect.value];
          return (
            <button
              key={effect.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={effect.value === focused ? 0 : -1}
              aria-label={`${effect.name} — ${EFFECT_DESCRIPTIONS[effect.value] ?? ""}`}
              title={EFFECT_DESCRIPTIONS[effect.value] ? `${effect.name}: ${EFFECT_DESCRIPTIONS[effect.value]}` : effect.name}
              onClick={() => {
                setFocused(effect.value);
                onSelect(effect.value);
              }}
              onKeyDown={(e) => {
                switch (e.key) {
                  case "ArrowRight":
                    moveFocus(e, Math.min(list.length - 1, i + 1));
                    break;
                  case "ArrowLeft":
                    moveFocus(e, Math.max(0, i - 1));
                    break;
                  case "ArrowDown":
                    moveFocus(e, Math.min(list.length - 1, i + columnsOf(e)));
                    break;
                  case "ArrowUp":
                    moveFocus(e, Math.max(0, i - columnsOf(e)));
                    break;
                  case "Home":
                    moveFocus(e, 0);
                    break;
                  case "End":
                    moveFocus(e, list.length - 1);
                    break;
                }
              }}
              onFocus={() => {
                setFocused(effect.value);
                setPreviewEffect(effect.value);
              }}
              onBlur={() => setPreviewEffect(null)}
              onMouseEnter={() => {
                setHover(effect.value);
                setPreviewEffect(effect.value);
              }}
              onMouseLeave={() => {
                setHover(null);
                setPreviewEffect(null);
              }}
              className="tile flex flex-col gap-2 p-2 text-left"
              style={selected && previewingOther ? { opacity: 0.6 } : undefined}
            >
              <span className="tile-well block">
                <BoardThumb
                  lighting={{ ...THUMB_BASE, effect: effect.value, color, rainbow }}
                  live={selected || hover === effect.value || focused === effect.value}
                />
                <span aria-hidden className="tile-led" />
              </span>
              <span className="flex items-center gap-2 px-0.5">
                <span aria-hidden className="readout text-[11px] text-[var(--dim)]">{idx(effect.value)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-[550] leading-tight text-[var(--text)]">{effect.name}</span>
                {Icon && effect.name !== "Off" && <Icon aria-hidden className="size-3.5 shrink-0 text-[var(--dim)]" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
