import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useReducedMotion } from "framer-motion";
import {
  caseLayout,
  displayLayout,
  displayPlateLayout,
  displayRecessLayout,
  fieldSize,
  knobLayout,
  ledBarLayout,
  ledBarRecessLayout,
  labeledKeys,
  plateLayout,
  recessLayout,
  type LabeledKey,
} from "./keyboard";
import { ledBarSample } from "./lighting";
import { ledSample, type LedLighting } from "@/lib/ledField";
import { cn } from "@/lib/utils";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** Canvas spill margins around the case: the underglow lives outside it too. */
const SPILL_X = 42;
const SPILL_TOP = 30;
const SPILL_BOTTOM = 64;
/** How much vertical knob drag equals one brightness step. */
const KNOB_STEP_PX = 18;

/** Converts a board-space box into a percentage rect relative to a reference box. */
function toPercentRect(refSize: [number, number], position: [number, number], size: [number, number]) {
  const [refW, refH] = refSize;
  return {
    left: (((position[0] - size[0] / 2) + refW / 2) / refW) * 100,
    top: (((position[1] - size[1] / 2) + refH / 2) / refH) * 100,
    width: (size[0] / refW) * 100,
    height: (size[1] / refH) * 100,
  };
}

const PITCH_U = 0.21;

/** Mixed-case legend like the printed caps ("Caps Lock", not "CAPS"). */
function legendText(label: string): string {
  const fixed: Record<string, string> = { CAPS: "Caps Lock", PRINT: "PrtSc", CTRL: "Ctrl", WIN: "Win", PGUP: "PgUp", PGDN: "PgDn" };
  if (fixed[label]) return fixed[label];
  if (label.length <= 1 || /^F\d+$/.test(label)) return label;
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function Keycap({
  refSize,
  keyBox,
  interactive,
  layer,
  setKeyRef,
}: {
  refSize: [number, number];
  keyBox: LabeledKey;
  interactive: boolean;
  /** Glows paint in one layer under every cap, so no row's cap covers another's light. */
  layer: "glow" | "cap";
  setKeyRef: (el: HTMLDivElement | null) => void;
}) {
  const rect = toPercentRect(refSize, keyBox.position, keyBox.size);
  const widthU = keyBox.size[0] / PITCH_U;
  const keyStyle: CSSProperties = {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
  const capStyle: CSSProperties = {
    position: "relative",
    zIndex: 2,
    width: "100%",
    height: "100%",
    backgroundImage: "linear-gradient(180deg, #fbfbfc 0%, #eceef2 60%, #dcdfe6 100%)",
    // Corner radius from the key's own height, so wide keys (space, shift)
    // keep the same corners as a 1u key instead of turning into pills.
    borderRadius: `${(16 * (refSize[1] * rect.height)) / (refSize[0] * rect.width)}% / 16%`,
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -0.3em 0.4em -0.3em rgb(var(--c, 139 92 246) / calc(var(--i, 0) * 0.75)), 0 0.1em 0.16em rgba(0,0,0,0.6)",
  };

  if (layer === "glow") {
    return (
      <div ref={setKeyRef} aria-hidden className="pointer-events-none absolute [container-type:inline-size]" style={keyStyle}>
        {/* Soft pool of light on the black case below the key */}
        <div
          className="absolute"
          style={{
            left: "-8%",
            right: "-8%",
            bottom: "-30%",
            height: "70%",
            background:
              "radial-gradient(60% 70% at 50% 35%, rgb(var(--c, 139 92 246) / calc(var(--i, 0) * 1)) 0%, rgb(var(--c, 139 92 246) / 0) 75%)",
            filter: "blur(4px)",
            mixBlendMode: "screen",
          }}
        />
        {/* The LED seam: a crisp hot line right under the cap's bottom edge */}
        <div
          className="absolute"
          style={{
            left: "10%",
            right: "10%",
            bottom: "-9%",
            height: "10%",
            borderRadius: "50%",
            background: "color-mix(in srgb, rgb(var(--c, 139 92 246)) 85%, white)",
            opacity: "var(--i, 0)",
            boxShadow: "0 0 6px 2px rgb(var(--c, 139 92 246) / calc(var(--i, 0) * 1))",
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={setKeyRef}
      aria-hidden
      className={cn(
        "absolute [container-type:inline-size]",
        interactive && keyBox.label && "cursor-default transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-125",
      )}
      style={keyStyle}
    >
      <div className={cn("flex items-center justify-center", interactive && "transition-transform duration-150")} style={capStyle}>
        {keyBox.label ? (
          <span
            className="whitespace-nowrap font-semibold leading-none"
            style={{
              // Sized from the key's width in 1u so every legend shares one scale.
              fontSize: `clamp(3px, ${(keyBox.label.length <= 1 ? 29 : 25) / widthU}cqw, 20px)`,
              color: "#3a3f4b",
              ...(keyBox.label.length > 1 && widthU >= 1.5
                ? { position: "absolute", left: `${20 / widthU}%`, top: `${18 / widthU}%`, textAlign: "left" }
                : {}),
            }}
          >
            {legendText(keyBox.label)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function KeyboardPreview({ className, interactive = true }: { className?: string; interactive?: boolean }) {
  const effective = useAppStore(selectEffectiveState);
  const state = effective ?? OFFLINE_STATE;
  const previewUrl = useAppStore((s) => s.previewUrl);
  const paused = useAppStore((s) => s.animationsPaused);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const reduceMotion = useReducedMotion();
  const motionPaused = reduceMotion || paused;

  const board = useMemo(caseLayout, []);
  const recess = useMemo(recessLayout, []);
  const plate = useMemo(plateLayout, []);
  const keys = useMemo(labeledKeys, []);
  const field = useMemo(fieldSize, []);
  const module = useMemo(displayPlateLayout, []);
  const screenRecess = useMemo(displayRecessLayout, []);
  const display = useMemo(displayLayout, []);
  const knob = useMemo(knobLayout, []);
  const ledRecess = useMemo(ledBarRecessLayout, []);
  const ledBar = useMemo(ledBarLayout, []);

  // Normalised 0..1 key-field coordinates for the LED model.
  const coords = useMemo(() => {
    const [fieldW, fieldH] = field;
    const fieldCx = plate.position[0];
    const fieldCy = plate.position[1];
    return keys.map((key) => ({
      x: (key.position[0] - fieldCx + fieldW / 2) / fieldW,
      y: (key.position[1] - fieldCy + fieldH / 2) / fieldH,
    }));
  }, [keys, field, plate]);

  const lighting: LedLighting = useMemo(
    () => ({
      effect: state.underglow.effect,
      brightness: state.underglow.brightness,
      speed: state.underglow.speed,
      orientation: state.underglow.orientation,
      rainbow: state.underglow.rainbow,
      color: state.underglow.color,
    }),
    [state],
  );

  const led = state.led;
  const barRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const caseRef = useRef<HTMLDivElement>(null);
  const keyRefs = useRef<Array<HTMLDivElement | null>>([]);
  const capRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastKeyVars = useRef<string[]>([]);

  const nudgeBrightness = (delta: number) => {
    if (!interactive) return;
    const base = effective ?? OFFLINE_STATE;
    const next = Math.min(9, Math.max(0, base.underglow.brightness + delta));
    if (next !== base.underglow.brightness) setLightingDraft({ underglowBrightness: next });
  };

  // The case is sized by the board's aspect ratio; the canvas is the case plus
  // spill margins so the underglow can be drawn outside the board's footprint.
  const boardMaxWidth = Math.round(300 * (board.size[0] / board.size[1]));

  useEffect(() => {
    const canvas = canvasRef.current;
    const caseEl = caseRef.current;
    if (!canvas || !caseEl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let caseW = 0;
    let caseH = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = caseEl.getBoundingClientRect();
      caseW = rect.width;
      caseH = rect.height;
      canvas.width = Math.max(1, Math.round((caseW + SPILL_X * 2) * dpr));
      canvas.height = Math.max(1, Math.round((caseH + SPILL_TOP + SPILL_BOTTOM) * dpr));
    };
    resize();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(resize);
      ro.observe(caseEl);
    }

    const draw = (timeMs: number) => {
      const bar = barRef.current;
      if (bar) {
        const s = ledBarSample(led, timeMs);
        bar.style.setProperty("--lc", `${s.r} ${s.g} ${s.b}`);
        bar.style.setProperty("--la", s.a.toFixed(3));
      }
      const w = canvas.width;
      const h = canvas.height;
      const cw = caseW * dpr;
      const ch = caseH * dpr;
      ctx.clearRect(0, 0, w, h);
      if (cw <= 0 || ch <= 0) return;

      const originX = SPILL_X * dpr;
      const originY = SPILL_TOP * dpr;

      // Per-key CSS lighting: colour/intensity from ledSample(), written only when changed.
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const s = ledSample(lighting, c.x, c.y, i, timeMs);
        const rgb = `${Math.round(s.r)} ${Math.round(s.g)} ${Math.round(s.b)}`;
        const intensity = s.intensity.toFixed(3);
        const key = `${rgb}|${intensity}`;
        if (lastKeyVars.current[i] !== key) {
          lastKeyVars.current[i] = key;
          for (const el of [keyRefs.current[i], capRefs.current[i]]) {
            if (!el) continue;
            el.style.setProperty("--c", rgb);
            el.style.setProperty("--i", intensity);
          }
        }
      }

      // Outside-the-case spill: a soft animated band below and around the case.
      ctx.globalCompositeOperation = "lighter";
      const spillY = originY + ch + 6 * dpr;
      for (let i = 0; i < 8; i++) {
        const fx = (i + 0.5) / 8;
        const s = ledSample(lighting, fx, 0.98, i * 11, timeMs);
        if (s.intensity <= 0.004) continue;
        const cx = originX + fx * cw;
        const r = cw * 0.09;
        ctx.save();
        ctx.translate(cx, spillY);
        ctx.scale(1, 0.3);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, `rgba(${s.r}, ${s.g}, ${s.b}, ${0.4 * s.intensity})`);
        g.addColorStop(1, `rgba(${s.r}, ${s.g}, ${s.b}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      let ar = 0, ag = 0, ab = 0, aw = 0;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const s = ledSample(lighting, c.x, c.y, i, timeMs);
        if (s.intensity > 0) {
          ar += s.r * s.intensity;
          ag += s.g * s.intensity;
          ab += s.b * s.intensity;
          aw += s.intensity;
        }
      }
      if (aw > 0) {
        const avgR = Math.round(ar / aw);
        const avgG = Math.round(ag / aw);
        const avgB = Math.round(ab / aw);
        const k = Math.min(1, aw / coords.length);
        const r = cw * 0.55;
        ctx.save();
        ctx.translate(originX + cw / 2, spillY);
        ctx.scale(1, 0.22);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, `rgba(${avgR}, ${avgG}, ${avgB}, ${0.22 * k})`);
        g.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    let raf = 0;
    let last = 0;
    let disposed = false;
    const loop = (t: number) => {
      if (disposed) return;
      if (!document.hidden && t - last >= 33) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };
    // Static frame for reduced motion / paused animations.
    draw(0);
    if (!motionPaused) raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [lighting, led, coords, motionPaused]);

  const recessRect = toPercentRect(board.size, recess.position, recess.size);
  const plateRect = toPercentRect(board.size, plate.position, plate.size);
  const moduleRect = toPercentRect(board.size, module.position, module.size);
  const screenRecessRect = toPercentRect(board.size, screenRecess.position, screenRecess.size);
  const displayRect = toPercentRect(board.size, display.position, display.size);
  const knobRect = toPercentRect(board.size, knob.position, [knob.radius * 2, knob.radius * 2]);
  const ledRecessRect = toPercentRect(board.size, ledRecess.position, ledRecess.size);
  const ledBarRect = toPercentRect(board.size, ledBar.position, ledBar.size);

  const dragStart = useRef<number | null>(null);
  const dragStage = useRef(0);

  const showPreview = Boolean(effective && effective.show !== 0 && previewUrl);
  const clock = effective ? effective.time : OFFLINE_STATE.time;
  const clockLabel = `${clock[4]}:${String(clock[5]).padStart(2, "0")}:${String(clock[6]).padStart(2, "0")}`;
  const brightness = state.underglow.brightness;

  // Plain matte-black knob with one notch, like the real one.
  const knobFace = "radial-gradient(circle at 36% 28%, #3b3e46 0%, #1b1d22 55%, #0f1013 100%)";

  return (
    <div
      role="group"
      aria-label={
        effective
          ? `Keyboard preview: underglow effect ${effective.underglow.effect}, brightness ${effective.underglow.brightness} of 9${draftDirty ? ", draft not yet on board" : ""}. Knob controls brightness.`
          : "Keyboard preview: disconnected. Knob controls brightness."
      }
      className={cn("relative w-full overflow-hidden p-2", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 55% at 50% 42%, rgba(255,255,255,0.05), transparent 70%)" }}
      />

      <div className="relative flex justify-center">
        <div
          ref={caseRef}
          className="relative"
          style={{
            width: `min(100%, ${boardMaxWidth}px)`,
            aspectRatio: `${board.size[0]} / ${board.size[1]}`,
          }}
        >
          {/* 1) Case body */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              borderRadius: "2.5%",
              backgroundImage: "linear-gradient(180deg, #22252c 0%, #101217 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.08), 0 34px 54px -18px rgba(0,0,0,0.8), 0 2px 0 rgba(255,255,255,0.02)",
            }}
          />

          {/* 2) Recess (lip) */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: `${recessRect.left}%`,
              top: `${recessRect.top}%`,
              width: `${recessRect.width}%`,
              height: `${recessRect.height}%`,
              borderRadius: "2%",
              backgroundImage: "linear-gradient(180deg, #14171d 0%, #0c0e12 100%)",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7), inset 1px 1px 0 rgba(255,255,255,0.02)",
            }}
          />

          {/* 3) Plate (mounting surface) */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: `${plateRect.left}%`,
              top: `${plateRect.top}%`,
              width: `${plateRect.width}%`,
              height: `${plateRect.height}%`,
              borderRadius: "0.8%",
              backgroundImage: "linear-gradient(180deg, #0b0c10 0%, #08090c 100%)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03), inset 0 2px 6px rgba(0,0,0,0.85)",
            }}
          />

          {/* Outside-the-case underglow spill (per-key lighting lives on each key). */}
          <canvas
            ref={canvasRef}
            aria-hidden
            className="pointer-events-none absolute"
            style={{ left: -SPILL_X, right: -SPILL_X, top: -SPILL_TOP, bottom: -SPILL_BOTTOM }}
          />

          {/* Keycaps with per-key LED pool + seam + opaque cap */}
          {keys.map((key, index) => (
            <Keycap
              key={`glow-${index}`}
              layer="glow"
              refSize={board.size}
              keyBox={key}
              interactive={false}
              setKeyRef={(el) => {
                keyRefs.current[index] = el;
              }}
            />
          ))}
          {keys.map((key, index) => (
            <Keycap
              key={`cap-${index}`}
              layer="cap"
              refSize={board.size}
              keyBox={key}
              interactive={interactive}
              setKeyRef={(el) => {
                capRefs.current[index] = el;
              }}
            />
          ))}

          {/* Black module panel */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: `${moduleRect.left}%`,
              top: `${moduleRect.top}%`,
              width: `${moduleRect.width}%`,
              height: `${moduleRect.height}%`,
              borderRadius: "4%",
              backgroundImage:
                "linear-gradient(180deg, #1c1e24 0%, #121418 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), 0 2px 5px rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          />

          {/* Screen black recess inside module */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: `${screenRecessRect.left}%`,
              top: `${screenRecessRect.top}%`,
              width: `${screenRecessRect.width}%`,
              height: `${screenRecessRect.height}%`,
              borderRadius: "3%",
              background: "#050608",
              boxShadow: "inset 0 1px 3px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          />

          {/* Screen active area */}
          <div
            className="absolute overflow-hidden bg-black [container-type:inline-size]"
            style={{
              left: `${displayRect.left}%`,
              top: `${displayRect.top}%`,
              width: `${displayRect.width}%`,
              height: `${displayRect.height}%`,
              borderRadius: "2%",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            {showPreview && previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <span
                className="flex h-full w-full items-center justify-center font-mono font-semibold"
                style={{ color: "#d9ecff", fontSize: "clamp(9px, 2.1cqw, 12px)", letterSpacing: "-0.06em", textShadow: "0 0 10px rgba(150,200,255,0.4)" }}
              >
                {clockLabel}
              </span>
            )}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(120deg, rgba(255,255,255,0.08), transparent 30%), repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 3px)",
              }}
            />
          </div>

          {/* Rotary knob */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Brightness"
            aria-valuemin={0}
            aria-valuemax={9}
            aria-valuenow={brightness}
            aria-disabled={!interactive}
            className={cn("absolute rounded-full", interactive && "cursor-ns-resize")}
            style={{
              left: `${knobRect.left}%`,
              top: `${knobRect.top}%`,
              width: `${knobRect.width}%`,
              height: `${knobRect.height}%`,
              backgroundImage: knobFace,
              boxShadow: "inset 0 1px 1px rgba(255,255,255,0.14), 0 0 0 1px #2a2d34, 0 2px 4px rgba(0,0,0,0.6)",
            }}
            onPointerDown={(e) => {
              if (!interactive) return;
              dragStart.current = e.clientY;
              dragStage.current = 0;
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (dragStart.current === null) return;
              const stage = Math.trunc((dragStart.current - e.clientY) / KNOB_STEP_PX);
              if (stage !== dragStage.current) {
                nudgeBrightness(stage - dragStage.current);
                dragStage.current = stage;
              }
            }}
            onPointerUp={() => {
              dragStart.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") { e.preventDefault(); nudgeBrightness(1); }
              else if (e.key === "ArrowDown") { e.preventDefault(); nudgeBrightness(-1); }
            }}
          >
            {/* Notch: turns with brightness (0 = lower-left, 9 = lower-right) */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ transform: `rotate(${-135 + (brightness / 9) * 270}deg)` }}
            >
              <span className="absolute left-1/2 top-[10%] h-[24%] w-[7%] -translate-x-1/2 rounded-full bg-white/80" />
            </span>
          </div>

          {/* Light bar recess */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: `${ledRecessRect.left}%`,
              top: `${ledRecessRect.top}%`,
              width: `${ledRecessRect.width}%`,
              height: `${ledRecessRect.height}%`,
              borderRadius: "999px",
              background: "#0a0c10",
              boxShadow: "inset 0 1px 3px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.03)",
            }}
          />
          {/* Light bar capsule: frosted base + animated glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: `${ledBarRect.left}%`,
              top: `${ledBarRect.top}%`,
              width: `${ledBarRect.width}%`,
              height: `${ledBarRect.height}%`,
              borderRadius: "999px",
              background: "rgba(185,194,204,0.25)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
            }}
          />
          <div
            ref={barRef}
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: `${ledBarRect.left}%`,
              top: `${ledBarRect.top}%`,
              width: `${ledBarRect.width}%`,
              height: `${ledBarRect.height}%`,
              borderRadius: "999px",
              backgroundColor: "rgb(var(--lc, 0 0 0) / var(--la, 0))",
              boxShadow: "0 0 10px 2px rgb(var(--lc, 0 0 0) / calc(var(--la, 0) * 0.8))",
            }}
          />
        </div>
      </div>

      {draftDirty && (
        <span className="absolute bottom-3 left-4 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#c4b5fd]">
          Draft — not on board
        </span>
      )}
    </div>
  );
}
