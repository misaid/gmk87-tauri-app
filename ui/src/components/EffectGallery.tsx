import { useEffect, useState, type KeyboardEvent } from "react";
import { EFFECT_DESCRIPTIONS, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { ledStops, type LedLighting } from "@/lib/ledField";

/** A canonical base so static thumbnails differ visibly per effect. */
const THUMB_BASE: LedLighting = {
  effect: 0,
  brightness: 6,
  speed: 3,
  orientation: 0,
  rainbow: 0,
  color: [139, 92, 246],
};
const THUMB_TIME_MS = 1600;

const thumbCache = new Map<string, string[]>();
/** Thumbnails use the board's live colour so the picker previews what you will get. */
function thumbStops(effect: number, color: [number, number, number], rainbow: number): string[] {
  const k = `${effect}|${color.join(",")}|${rainbow}`;
  let stops = thumbCache.get(k);
  if (!stops) {
    stops = ledStops({ ...THUMB_BASE, effect, color, rainbow }, THUMB_TIME_MS);
    thumbCache.set(k, stops);
  }
  return stops;
}

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

  useEffect(() => {
    setFocused(value);
  }, [value]);

  const moveFocus = (e: KeyboardEvent, nextIndex: number) => {
    e.preventDefault();
    const group = e.currentTarget.closest('[role="radiogroup"]');
    const options = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]')] : [];
    const next = options[nextIndex];
    if (!next) return;
    next.focus();
    setFocused(UNDERGLOW_EFFECTS[nextIndex]?.value ?? value);
  };

  return (
    <div role="radiogroup" aria-label="Underglow effect" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {UNDERGLOW_EFFECTS.map((effect, i) => {
        const selected = effect.value === value;
        return (
          <button
            key={effect.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={effect.value === focused ? 0 : -1}
            aria-label={`${effect.name} — ${EFFECT_DESCRIPTIONS[effect.value] ?? ""}`}
            onClick={() => {
              setFocused(effect.value);
              onSelect(effect.value);
            }}
            onKeyDown={(e) => {
              switch (e.key) {
                case "ArrowRight":
                  moveFocus(e, Math.min(UNDERGLOW_EFFECTS.length - 1, i + 1));
                  break;
                case "ArrowLeft":
                  moveFocus(e, Math.max(0, i - 1));
                  break;
                case "ArrowDown":
                  moveFocus(e, Math.min(UNDERGLOW_EFFECTS.length - 1, i + 4));
                  break;
                case "ArrowUp":
                  moveFocus(e, Math.max(0, i - 4));
                  break;
                case "Home":
                  moveFocus(e, 0);
                  break;
                case "End":
                  moveFocus(e, UNDERGLOW_EFFECTS.length - 1);
                  break;
              }
            }}
            onFocus={() => setFocused(effect.value)}
            className={
              selected
                ? "flex flex-col gap-2 rounded-[10px] border border-[var(--accent)] bg-[var(--accent)]/12 p-2.5 text-left shadow-[0_0_0_1px_var(--accent)]"
                : "flex flex-col gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--panel-2)] p-2.5 text-left transition-colors duration-150 hover:border-[var(--line-strong)]"
            }
          >
            <span aria-hidden className="flex h-2 overflow-hidden rounded-full bg-black/40">
              {thumbStops(effect.value, color, rainbow).map((stop, j) => (
                <span key={j} className="h-full flex-1" style={{ background: stop }} />
              ))}
            </span>
            <span className="text-[12px] font-medium leading-tight text-[var(--text)]">{effect.name}</span>
          </button>
        );
      })}
    </div>
  );
}
