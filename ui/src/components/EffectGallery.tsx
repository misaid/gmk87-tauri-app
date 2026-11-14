import { useEffect, useState, type KeyboardEvent } from "react";
import { Activity, ArrowRight, Ban, CircleDot, Lightbulb, Orbit, Rainbow, Radio, Sparkles, Waves, Wind, CloudRain, type LucideIcon } from "lucide-react";
import { EFFECT_DESCRIPTIONS, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { ledGrid, type LedLighting } from "@/lib/ledField";
import { thumbIntensity } from "@/lib/thumbPattern";
import { useAppStore } from "@/store";

/** A canonical base so static thumbnails differ visibly per effect. */
const THUMB_BASE: LedLighting = {
  effect: 0,
  brightness: 9,
  speed: 3,
  orientation: 0,
  rainbow: 0,
  color: [139, 92, 246],
};
const ROWS = 4;
const COLS = 14;
const GRID_COLS = 4;
const UNLIT = "#1e2733";
/** Idle cells sit at ~15% of the lit colour over near-black. */
const IDLE = "#0a0c10";
/** Per-family motion cue shown in each tile's corner. */
const EFFECT_ICON: Record<number, LucideIcon> = {
  1: ArrowRight, 2: Activity, 3: CloudRain, 4: Rainbow, 5: Activity, 6: Lightbulb, 7: Sparkles, 8: Radio,
  9: ArrowRight, 10: Sparkles, 11: Rainbow, 12: Wind, 13: CircleDot, 14: Orbit, 15: CloudRain, 16: Waves,
  17: Rainbow, 18: Rainbow,
};
/** Resting frame per effect, as a phase (speed 3 runs 1.25 cycles/s): lands on a visible peak. */
const THUMB_PHASE: Record<number, number> = {
  1: 0.3, 2: 0.42, 3: 0.2, 5: 0.25, 7: 0.2, 8: 0.35, 9: 0.38, 10: 0.5,
  12: 0.1, 13: 0.3, 14: 0.3, 15: 0.5, 16: 0.15, 17: 0.5, 18: 0.2,
};
const thumbTime = (effect: number) => Math.round((THUMB_PHASE[effect] ?? 0.35) * 800);

const thumbCache = new Map<string, string[][]>();
/** Thumbnails use the board's live colour so the picker previews what you will get. */
function thumbGrid(effect: number, color: [number, number, number], rainbow: number, t: number): string[][] {
  const k = `${effect}|${color.join(",")}|${rainbow}|${t}`;
  let grid = thumbCache.get(k);
  if (!grid) {
    grid = ledGrid({ ...THUMB_BASE, effect, color, rainbow }, t, ROWS, COLS);
    if (thumbCache.size > 3000) thumbCache.clear();
    thumbCache.set(k, grid);
  }
  return grid;
}

/** A 4 x 14 cell strip at the effect's characteristic frame; animates only while `live`. */
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
  const base = thumbTime(effect);
  const [t, setT] = useState(base);
  useEffect(() => {
    if (!live || off) {
      setT(base);
      return;
    }
    const id = window.setInterval(() => setT((v) => v + 90), 90);
    return () => window.clearInterval(id);
  }, [live, off, base]);
  if (off) {
    return (
      <span
        aria-hidden
        className="flex h-[26px] items-center justify-center rounded-[4px] text-white/45"
        style={{ background: UNLIT }}
      >
        <Ban className="size-3.5" />
      </span>
    );
  }
  const pattern = thumbIntensity(effect, 0, 0, ROWS, COLS) !== null;
  const rgb = `rgb(${color.map((c) => Math.round(c)).join(",")})`;
  const grid = pattern ? null : thumbGrid(effect, color, rainbow, t);
  return (
    <span aria-hidden className="flex flex-col gap-[2px]">
      {Array.from({ length: ROWS }, (_, i) => (
        <span
          key={i}
          className="flex h-[5px] gap-px overflow-hidden rounded-[2px]"
          style={grid ? { filter: "saturate(1.35) brightness(1.3) contrast(1.15)" } : undefined}
        >
          {Array.from({ length: COLS }, (_, j) => {
            if (grid) {
              const stop = grid[i][j];
              return <span key={j} className="h-full flex-1" style={{ backgroundColor: UNLIT, backgroundImage: `linear-gradient(${stop}, ${stop})` }} />;
            }
            // Hand-drawn frames drift one column per tick while live.
            const v = thumbIntensity(effect, i, (j + Math.floor((t - base) / 90)) % COLS, ROWS, COLS) ?? 0;
            const mix = Math.round(15 + 85 * v);
            return <span key={j} className="h-full flex-1" style={{ backgroundColor: `color-mix(in srgb, ${rgb} ${mix}%, ${IDLE})` }} />;
          })}
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
  const setPreviewEffect = useAppStore((st) => st.setPreviewEffect) ?? (() => {});
  useEffect(() => () => setPreviewEffect(null), [setPreviewEffect]);
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
        const Icon = EFFECT_ICON[effect.value];
        const span = effect.value === 0 ? "col-span-2" : "";
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
                  moveFocus(e, Math.min(UNDERGLOW_EFFECTS.length - 1, i + GRID_COLS));
                  break;
                case "ArrowUp":
                  moveFocus(e, Math.max(0, i - GRID_COLS));
                  break;
                case "Home":
                  moveFocus(e, 0);
                  break;
                case "End":
                  moveFocus(e, UNDERGLOW_EFFECTS.length - 1);
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
            style={selected ? { borderColor: rgb, boxShadow: `0 0 14px -2px ${rgb}` } : undefined}
            className={
              selected
                ? "relative flex min-h-[52px] flex-col justify-between gap-1.5 rounded-[10px] border-2 bg-[var(--panel-2)] p-2 text-left " + span
                : "relative flex min-h-[52px] flex-col justify-between gap-1.5 rounded-[10px] border-2 border-[var(--line)] bg-[var(--panel-2)] p-2 text-left transition-colors duration-150 hover:border-[var(--line-strong)] " + span
            }
          >
            <Thumb
              effect={effect.value}
              off={effect.name === "Off"}
              color={color}
              rainbow={rainbow}
              live={selected || hover === effect.value || focused === effect.value}
            />
            <span className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-medium leading-tight text-[var(--text)]">{effect.name}</span>
              {Icon && effect.name !== "Off" && <Icon aria-hidden className="size-3.5 shrink-0 text-white/70" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
