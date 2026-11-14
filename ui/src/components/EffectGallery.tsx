import { useEffect, useState, type KeyboardEvent } from "react";
import { Activity, ArrowRight, CircleDot, Lightbulb, Orbit, Rainbow, Radio, Sparkles, Waves, Wind, CloudRain, type LucideIcon } from "lucide-react";
import { EFFECT_DESCRIPTIONS } from "@/lib/effects";
import { EFFECT_FILTERS, filterEffects, type EffectFilter } from "@/lib/lightingSync";
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
  const rgb = `rgb(${color.map((c) => Math.round(c)).join(",")})`;

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

  return (
    <div className="@container flex flex-col gap-2.5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--dim)]">Effects</span>
      <div role="tablist" aria-label="Effect category" className="order-last flex w-full gap-1 rounded-full border border-[var(--line)] bg-[var(--panel-2)] p-0.5 @[560px]:order-none @[560px]:w-auto">
        {EFFECT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`h-6 flex-1 rounded-full px-2 text-[12px] font-medium @[560px]:flex-none @[560px]:px-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${filter === f.id ? "bg-[var(--pill)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span className="ml-auto text-[11px] text-[var(--dim)]">{list.length} effects</span>
    </div>
    <div role="radiogroup" aria-label="Underglow effect" className="grid grid-cols-2 gap-2 @[600px]:grid-cols-3 @[880px]:grid-cols-4">
      {list.map((effect, i) => {
        const selected = effect.value === value;
        const Icon = EFFECT_ICON[effect.value];
        const span = "";
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
            style={selected ? { borderColor: rgb, boxShadow: `0 0 14px -2px ${rgb}`, opacity: previewingOther ? 0.55 : 1 } : undefined}
            className={
              selected
                ? "relative flex flex-col justify-between gap-1.5 rounded-[10px] border-2 bg-[var(--panel-2)] p-2 text-left " + span
                : "relative flex flex-col justify-between gap-1.5 rounded-[10px] border-2 border-[var(--line)] bg-[var(--panel-2)] p-2 text-left transition-colors duration-150 hover:border-[var(--line-strong)] " + span
            }
          >
            <BoardThumb
              lighting={{ ...THUMB_BASE, effect: effect.value, color, rainbow }}
              live={selected || hover === effect.value || focused === effect.value}
            />
            <span className="flex items-center justify-between gap-1">
              <span className="text-[12px] font-medium leading-tight text-[var(--text)]">{effect.name}</span>
              {Icon && effect.name !== "Off" && <Icon aria-hidden className="size-3.5 shrink-0 text-white/70" />}
            </span>
          </button>
        );
      })}
    </div>
    </div>
  );
}
