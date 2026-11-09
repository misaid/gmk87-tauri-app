import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EFFECT_DESCRIPTIONS, EFFECT_FIRMWARE_NAMES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { perKeyUnderglow, underglowCategory, type GlowCategory, type UnderglowState } from "./lighting";
import { useAppStore } from "@/store";

const GALLERY_KEYS = [
  { x: 0.08, y: 0.5, index: 0 },
  { x: 0.25, y: 0.5, index: 1 },
  { x: 0.42, y: 0.5, index: 2 },
  { x: 0.58, y: 0.5, index: 3 },
  { x: 0.74, y: 0.5, index: 4 },
  { x: 0.91, y: 0.5, index: 5 },
];

const FILTERS: ReadonlyArray<{ label: string; value: "all" | GlowCategory }> = [
  { label: "All", value: "all" },
  { label: "Waves", value: "wave" },
  { label: "Rainbow", value: "rainbow" },
  { label: "Breathing", value: "breathing" },
  { label: "Reactive", value: "reactive" },
  { label: "Static", value: "static" },
  { label: "Off", value: "off" },
];

export function EffectThumb({
  effect,
  base,
  frozen = false,
}: {
  effect: number;
  base: UnderglowState;
  frozen?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const paused = useAppStore((s) => s.animationsPaused);
  const u: UnderglowState = useMemo(() => ({ ...base, effect, brightness: Math.max(base.brightness, 5) }), [base, effect]);
  const glows = useMemo(() => GALLERY_KEYS.map((k) => perKeyUnderglow(u, k)), [u]);

  if (frozen) {
    return (
      <div className="flex items-center gap-1" aria-hidden>
        {glows.map((glow, i) => (
          <span
            key={i}
            className="block size-2.5 rounded-[2px]"
            style={{ background: glow.colors[0] ?? "transparent", opacity: Math.max(...glow.opacity.map((o) => o * 0.35), 0.25) }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {glows.map((glow, i) => (
        <motion.span
          key={i}
          className="block size-2.5 rounded-[2px]"
          animate={{ backgroundColor: glow.colors, opacity: glow.opacity.map((o) => o * 0.35) }}
          transition={{
            duration: glow.durationSec,
            repeat: reduceMotion || paused ? 0 : glow.loop ? Infinity : 0,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

const CURATED = [0, 5, 6, 11, 15];

export function EffectGallery({
  value,
  base,
  onSelect,
}: {
  value: number;
  base: UnderglowState;
  onSelect: (effect: number) => void;
}) {
  const paused = useAppStore((s) => s.animationsPaused);
  const setPaused = useAppStore((s) => s.setAnimationsPaused);
  const currentCategory = underglowCategory(value);
  const [filter, setFilter] = useState<"all" | GlowCategory>(currentCategory);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [focusedValue, setFocusedValue] = useState(value);

  useEffect(() => {
    setFocusedValue(value);
  }, [value]);

  // Palette stages an effect from another family — make sure it stays visible.
  useEffect(() => {
    if (!showAll && !CURATED.includes(value)) setShowAll(true);
    if (showAll && filter !== "all" && underglowCategory(value) !== filter) setFilter(underglowCategory(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const curated = UNDERGLOW_EFFECTS.filter((e) => CURATED.includes(e.value));
  const visibleAll = UNDERGLOW_EFFECTS.filter(
    (e) =>
      (filter === "all" || underglowCategory(e.value) === filter) &&
      (query.trim() === "" || e.name.toLowerCase().includes(query.trim().toLowerCase()) || EFFECT_FIRMWARE_NAMES[e.value]?.toLowerCase().includes(query.trim().toLowerCase()) || String(e.value) === query.trim()),
  );
  const visible = showAll ? visibleAll : curated;

  return (
    <div className="flex flex-col gap-3">
      {!showAll && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-white/70">Start here — 5 favourites{base.brightness < 5 ? " (shown at 5/9 so you can see them)" : ""}. Open the full set for more.</p>
          <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)} className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40">
            {paused ? "Play" : "Pause"}
          </button>
        </div>
      )}
      {showAll && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="search"
              placeholder="Search 19 effects…"
              aria-label="Search effects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full min-w-40 flex-1 rounded-md border border-white/15 bg-neutral-900 px-3 py-1.5 text-sm text-white placeholder:text-white/50"
            />
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40"
            >
              {paused ? "Play" : "Pause"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter effects by type">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={
                  filter === f.value
                    ? "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                    : "rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40 hover:text-white"
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Underglow effect"
      >
        {visible.map((effect) => {
          const selected = effect.value === value;
          return (
            <button
              key={effect.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={effect.value === focusedValue ? 0 : -1}
              aria-label={`${effect.name} (${EFFECT_FIRMWARE_NAMES[effect.value]}, #${effect.value}): ${(EFFECT_DESCRIPTIONS[effect.value] ?? "")}`}
              title={EFFECT_FIRMWARE_NAMES[effect.value] ?? ""}
              onClick={() => onSelect(effect.value)}
              onKeyDown={(e) => {
                const move = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key);
                if (!move) return;
                e.preventDefault();
                const group = e.currentTarget.closest('[role="radiogroup"]');
                const options = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]')] : [];
                const i = options.indexOf(e.currentTarget);
                let next = i;
                if (e.key === "ArrowRight") next = Math.min(options.length - 1, i + 1);
                if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
                if (e.key === "ArrowDown") next = Math.min(options.length - 1, i + 3);
                if (e.key === "ArrowUp") next = Math.max(0, i - 3);
                if (e.key === "Home") next = 0;
                if (e.key === "End") next = options.length - 1;
                const n = visible[next];
                if (!n) return;
                options[next]?.focus();
                setFocusedValue(n.value);
              }}
              onFocus={() => setFocusedValue(effect.value)}
              className={
                selected
                  ? "flex flex-col gap-2 rounded-lg border border-white bg-white/10 p-2.5 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"
                  : "flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-left hover:border-white/30 hover:bg-white/[0.06]"
              }
            >
              <EffectThumb effect={effect.value} base={base} />
              <span className="text-xs font-medium leading-tight text-white">{effect.name}</span>
              <span className="line-clamp-2 text-xs leading-snug text-white/70">{EFFECT_DESCRIPTIONS[effect.value]}</span>
              <span className="text-xs uppercase tracking-wide text-white/60">#{effect.value} · {underglowCategory(effect.value)}</span>
            </button>
          );
        })}
      </div>
      {!showAll ? (
        <button
          type="button"
          aria-label="Show all 19 effects"
          onClick={() => { setShowAll(true); setFilter("all"); }}
          className="self-start rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:border-white/40"
        >
          All 19 effects
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="self-start rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:border-white/40"
        >
          Show favourites only
        </button>
      )}
      <p className="text-xs text-white/70">
        Thumbnails animate with your current speed, colour and direction{base.brightness < 5 ? " — shown at 5/9 brightness so effects stay visible" : ""}.
      </p>
    </div>
  );
}
