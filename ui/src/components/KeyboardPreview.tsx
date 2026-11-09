import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  displayLayout,
  displayPlateLayout,
  fieldSize,
  ledBarLayout,
  KEY_GAP,
  knobLayout,
  labeledKeys,
  plateLayout,
  type LabeledKey,
} from "./keyboard";
import {
  ledAnimation,
  perKeyUnderglow,
  underglowAnimation,
  underglowCategory,
  type GlowAnimation,
  type KeyPos,
} from "./lighting";
import { cn } from "@/lib/utils";
import { selectEffectiveState, useAppStore } from "@/store";

const IDLE_UNDERGLOW: GlowAnimation = { colors: ["transparent"], opacity: [0], durationSec: 1, loop: false };
const IDLE_LED: GlowAnimation = { colors: ["transparent"], opacity: [0], durationSec: 1, loop: false };
const IDLE_KEY: GlowAnimation = { colors: ["transparent"], opacity: [0], durationSec: 1, loop: false };

/** Converts a board-space box into a percentage rect relative to the plate. */
function toPercentRect(plateSize: [number, number], position: [number, number], size: [number, number]) {
  const [plateW, plateH] = plateSize;
  return {
    left: (((position[0] - size[0] / 2) + plateW / 2) / plateW) * 100,
    top: (((position[1] - size[1] / 2) + plateH / 2) / plateH) * 100,
    width: (size[0] / plateW) * 100,
    height: (size[1] / plateH) * 100,
  };
}

/** A key's board-centred position as normalised 0..1 left→right / top→bottom coordinates. */
function keyPosOf(field: [number, number], keyBox: LabeledKey, index: number): KeyPos {
  const [fieldW, fieldH] = field;
  return {
    x: (keyBox.position[0] + fieldW / 2) / fieldW,
    y: (keyBox.position[1] + fieldH / 2) / fieldH,
    index,
  };
}

/** Font size as a percentage of the key's own width (container query units). */
function legendScale(label: string): number {
  if (label.length <= 1) return 42;
  if (label.length <= 4) return 24;
  return Math.max(11, 24 - (label.length - 4) * 2);
}

function Keycap({ plateSize, keyBox }: { plateSize: [number, number]; keyBox: LabeledKey }) {
  const rect = toPercentRect(plateSize, keyBox.position, keyBox.size);
  if (!keyBox.label) {
    // The space bar and other blank keys still occupy the grid, just unlabeled.
    return (
      <div
        className="absolute rounded-[0.35cqw] border border-white/15 bg-[#ece9df]"
        style={{
          left: `${rect.left}%`,
          top: `${rect.top}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
          backgroundImage: "linear-gradient(145deg, #f4f1e9 0%, #e6e2d9 55%, #d9d5cb 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.4)",
        }}
      />
    );
  }
  return (
    <div
      className="absolute flex items-center justify-center rounded-[14%] border border-white/15 text-[#252a32] [container-type:inline-size]"
      style={{
        left: `${rect.left}%`,
        top: `${rect.top}%`,
        width: `${rect.width}%`,
        height: `${rect.height}%`,
        backgroundImage: "linear-gradient(145deg, #f4f1e9 0%, #e6e2d9 55%, #d9d5cb 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.4)",
      }}
    >
      <span className="whitespace-nowrap text-center font-semibold leading-none" style={{ fontSize: `clamp(3px, ${legendScale(keyBox.label)}cqw, 20px)` }}>
        {keyBox.label}
      </span>
    </div>
  );
}

export function KeyboardPreview({ zoomed = false, className }: { zoomed?: boolean; className?: string }) {
  const state = useAppStore(selectEffectiveState);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const paused = useAppStore((s) => s.animationsPaused);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const reduceMotion = useReducedMotion();
  const motionPaused = reduceMotion || paused;

  const glow = useMemo(() => (state ? underglowAnimation(state.underglow) : IDLE_UNDERGLOW), [state]);
  const sideGlow = useMemo(() => (state ? ledAnimation(state.led) : IDLE_LED), [state]);
  const wave = state ? underglowCategory(state.underglow.effect) === "wave" && state.underglow.rainbow === 0 : false;
  const waveReversed = state?.underglow.orientation === 1;

  const plate = useMemo(plateLayout, []);
  const keys = useMemo(labeledKeys, []);
  const field = useMemo(fieldSize, []);
  const display = useMemo(displayLayout, []);
  const displayPlate = useMemo(displayPlateLayout, []);
  const knob = useMemo(knobLayout, []);
  const ledBar = useMemo(ledBarLayout, []);
  // Each key gets its own glow so waves/rainbows travel across the board
  // instead of washing the whole field in one colour.
  const perKeyGlows = useMemo(
    () =>
      keys.map((key, index) =>
        state ? perKeyUnderglow(state.underglow, keyPosOf(field, key, index)) : IDLE_KEY,
      ),
    [state, keys, field],
  );

  const displayRect = toPercentRect(plate.size, display.position, display.size);
  const displayPlateRect = toPercentRect(plate.size, displayPlate.position, displayPlate.size);
  const knobRect = toPercentRect(plate.size, knob.position, [knob.radius * 2, knob.radius * 2]);
  const ledBarRect = toPercentRect(plate.size, ledBar.position, ledBar.size);

  // The zoom target sits mostly on the display (what the Display screen
  // edits), with a slight pull toward the knob so both stay in frame.
  const zoomOrigin = useMemo(() => {
    const knobWeight = 0.3;
    const x = display.position[0] + (knob.position[0] - display.position[0]) * knobWeight;
    const y = display.position[1] + (knob.position[1] - display.position[1]) * knobWeight;
    return {
      xPct: ((x + plate.size[0] / 2) / plate.size[0]) * 100,
      yPct: ((y + plate.size[1] / 2) / plate.size[1]) * 100,
    };
  }, [display, knob, plate]);

  return (
    <div
      role="group"
      aria-label={
        state
          ? `Keyboard preview: underglow effect ${state.underglow.effect}, brightness ${state.underglow.brightness} of 9${draftDirty ? ", draft not yet on board" : ""}. Knob controls brightness.`
          : "Keyboard preview: disconnected. Knob controls brightness."
      }
      className={cn(
        "relative h-[320px] w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-neutral-950 to-black",
        className,
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <motion.div
          className="relative w-full max-w-full rounded-[4%] bg-[#17181c] shadow-[0_20px_45px_rgba(0,0,0,0.6)]"
          style={{
            aspectRatio: `${plate.size[0]} / ${plate.size[1]}`,
            transformOrigin: `${zoomOrigin.xPct}% ${zoomOrigin.yPct}%`,
          }}
          animate={{
            scale: zoomed ? 2.3 : 1,
            x: zoomed ? `${50 - zoomOrigin.xPct}%` : "0%",
            y: zoomed ? `${50 - zoomOrigin.yPct}%` : "0%",
          }}
          transition={{ type: "spring", stiffness: 160, damping: 22 }}
        >
          {/* Underglow: a soft radial glow hugging the bottom edge, not a solid bar — the
              gradient fades to transparent on its own, so no hard-edged shape to get wrong. */}
          <div className="pointer-events-none absolute inset-x-[12%] -bottom-[7%] h-[14%] overflow-visible">
            <motion.div
              className="absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(ellipse 60% 100% at center, currentColor 0%, transparent 75%)",
                filter: "blur(6px)",
              }}
              animate={{ color: glow.colors, opacity: glow.opacity }}
              transition={{ duration: glow.durationSec, repeat: motionPaused ? 0 : glow.loop ? Infinity : 0, ease: "easeInOut" }}
            />
            {wave && !motionPaused && (
              <motion.div
                className="absolute inset-y-0 w-1/4"
                style={{
                  backgroundImage: "radial-gradient(ellipse 60% 100% at center, white 0%, transparent 75%)",
                  filter: "blur(4px)",
                }}
                animate={{ x: waveReversed ? ["130%", "-130%"] : ["-130%", "130%"], opacity: [0, 0.8, 0] }}
                transition={{ duration: glow.durationSec, repeat: Infinity, ease: "linear" }}
              />
            )}
          </div>

          {/* Horizontal side LED strip directly below PgDn, matching the schematic. */}
          <motion.div
            className="pointer-events-none absolute rounded-full"
            style={{
              left: `${ledBarRect.left}%`,
              top: `${ledBarRect.top}%`,
              width: `${ledBarRect.width}%`,
              height: `${ledBarRect.height}%`,
              boxShadow: "0 0 10px 1px rgba(255,255,255,0.5)",
            }}
            animate={{ backgroundColor: sideGlow.colors, opacity: sideGlow.opacity }}
            transition={{ duration: sideGlow.durationSec, repeat: motionPaused ? 0 : sideGlow.loop ? Infinity : 0, ease: "easeInOut" }}
          />

          {/* Per-key under-key glow: one pitch cell behind each keycap, expanded
              by the inter-key gap so its colour bleeds into the gap around that
              key — like real backlighting through the switch plate. Neighbouring
              keys carry phase-shifted colours/brightness for spatial effects. */}
          {keys.map((key, index) => {
            const keyGlow = perKeyGlows[index];
            const cell = toPercentRect(plate.size, key.position, [
              key.size[0] + KEY_GAP,
              key.size[1] + KEY_GAP,
            ]);
            return (
              <motion.div
                key={`glow-${index}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${cell.left}%`,
                  top: `${cell.top}%`,
                  width: `${cell.width}%`,
                  height: `${cell.height}%`,
                }}
                animate={{ backgroundColor: keyGlow.colors, opacity: keyGlow.opacity.map((o) => o * 0.4) }}
                transition={{
                  duration: keyGlow.durationSec,
                  repeat: motionPaused ? 0 : keyGlow.loop ? Infinity : 0,
                  ease: "easeInOut",
                }}
              />
            );
          })}

          {keys.map((key, index) => (
            <Keycap key={index} plateSize={plate.size} keyBox={key} />
          ))}

          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[6%] border border-white/15 bg-[#05070a]"
            style={{
              left: `${displayPlateRect.left}%`,
              top: `${displayPlateRect.top}%`,
              width: `${displayPlateRect.width}%`,
              height: `${displayPlateRect.height}%`,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.5)",
            }}
          />

          <div
            className="absolute flex overflow-hidden rounded-[5%] border border-white/15 bg-[#05070a]"
            style={{
              left: `${displayRect.left}%`,
              top: `${displayRect.top}%`,
              width: `${displayRect.width}%`,
              height: `${displayRect.height}%`,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), 0 0 18px rgba(190,230,255,0.35)",
            }}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : state ? (
              <span className="flex h-full w-full items-center justify-center bg-[#eef8ff] font-semibold text-[#111827]" style={{ fontSize: "clamp(7px, 2.2cqw, 12px)", boxShadow: "inset 0 0 18px rgba(120,190,255,0.55)" }}>
                {(() => {
                  const t = state.time as unknown as [number, number, number, number, number, number, number];
                  return `${t[4]}:${String(t[5]).padStart(2, "0")}:${String(t[6]).padStart(2, "0")}`;
                })()}
              </span>
            ) : null}
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute rounded-full border border-black/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.35),0_2px_6px_rgba(0,0,0,0.6)]"
            style={{
              left: `${knobRect.left}%`,
              top: `${knobRect.top}%`,
              width: `${knobRect.width}%`,
              height: `${knobRect.height}%`,
              backgroundImage: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.75) 0 18%, transparent 42%), conic-gradient(from 20deg, #6b7280, #d1d5db, #4b5563, #e5e7eb, #374151, #9ca3af, #6b7280)",
            }}
          >
            {/* Tick marks on the knob — tactile affordance, not just a disc. */}
            <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[1px]" aria-hidden>
              <span className="text-[8px] leading-none text-white/50">▲</span>
              <span className="block h-[2px] w-[60%] bg-white/25" />
              <span className="text-[8px] leading-none text-white/50">▼</span>
            </span>
          </div>
        </motion.div>
      </div>
      {draftDirty && (
        <span className="absolute left-2 top-2 rounded bg-sky-400/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300">
          Draft — not on board
        </span>
      )}
    </div>
  );
}
