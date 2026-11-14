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
function thumbStops(effect: number, color: [number, number, number], rainbow: number, t: number): string[] {
  const k = `${effect}|${color.join(",")}|${rainbow}|${t}`;
  let stops = thumbCache.get(k);
  if (!stops) {
    stops = ledStops({ ...THUMB_BASE, effect, color, rainbow }, t);
    if (thumbCache.size > 3000) thumbCache.clear();
    thumbCache.set(k, stops);
  }
  return stops;
}

/** Two bars sampled at different moments; animates only while `live`. */
function Thumb({
  effect,
  off,
  color,
  rainbow,
  live,
}: {
  effect: number;
  off: boolean;
  color: [number, number, number];
  rainbow: number;
  live: boolean;
}) {
  const [t, setT] = useState(THUMB_TIME_MS);
  useEffect(() => {
    if (!live || off) {
      setT(THUMB_TIME_MS);
      return;
    }
    const id = window.setInterval(() => setT((v) => v + 90), 90);
    return () => window.clearInterval(id);
  }, [live, off]);
  if (off) {
    return <span aria-hidden className="block h-[18px] rounded-md border border-dashed border-white/15" />;
  }
  return (
    <span aria-hidden className="flex flex-col gap-[3px]">
      {[0, 700].map((dt) => (
        <span key={dt} className="flex h-[7px] overflow-hidden rounded-full bg-white/[0.04]">
          {thumbStops(effect, color, rainbow, t + dt).map((stop, j) => (
            <span key={j} className="h-full flex-1" style={{ background: stop }} />
          ))}
        </span>
      ))}
    </span>
  );
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
  const [hover, setHover] = useState<number | null>(null);
  const rgb = `rgb(${color.map((c) => Math.round(c)).join(",")})`;

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
    <div role="radiogroup" aria-label="Underglow effect" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            onMouseEnter={() => setHover(effect.value)}
            onMouseLeave={() => setHover(null)}
            style={selected ? { borderColor: rgb, boxShadow: `0 0 14px -2px ${rgb}` } : undefined}
            className={
              selected
                ? "flex min-h-[52px] flex-col justify-between gap-1.5 rounded-[10px] border-2 bg-[var(--panel-2)] p-2 text-left"
                : "flex min-h-[52px] flex-col justify-between gap-1.5 rounded-[10px] border-2 border-[var(--line)] bg-[var(--panel-2)] p-2 text-left transition-colors duration-150 hover:border-[var(--line-strong)]"
            }
          >
            <Thumb
              effect={effect.value}
              off={effect.name === "Off"}
              color={color}
              rainbow={rainbow}
              live={selected || hover === effect.value || focused === effect.value}
            />
            <span className="text-[11px] font-medium leading-tight text-[var(--text)]">{effect.name}</span>
          </button>
        );
      })}
    </div>
  );
}
