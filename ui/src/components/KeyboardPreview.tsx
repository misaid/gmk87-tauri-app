import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
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
import { ambientFrom, ledBarSample } from "./lighting";
import { CapOverlay } from "@/lib/capOverlay";
import { SeamLayer, createGlow, type GlowRenderer } from "@/lib/glowRender";
import { sampleFrame } from "@/lib/lightingFrame";
import {
  AdaptiveQuality,
  FRAME_STRIDE,
  chooseRenderer,
  getLightingMode,
  quantise,
  rateGate,
  subscribeLightingMode,
  webgl2Available,
} from "@/lib/lightingPerf";
import { ledSample, type LedLighting } from "@/lib/ledField";
import { cn } from "@/lib/utils";
import { LightBarPopover, OPEN_LIGHT_BAR_EVENT } from "@/components/LightBarPopover";
import { UNDERGLOW_EFFECTS } from "@/lib/effects";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** Canvas spill margins around the case: the underglow lives outside it too. */
const SPILL_X = 42;
const SPILL_TOP = 30;
const SPILL_BOTTOM = 64;
/** The effect canvases cover the case plus the spill margins; explicit size so a high-DPI backing store is not shown at its pixel size. */
const SPILL_BOX: CSSProperties = {
  left: -SPILL_X,
  top: -SPILL_TOP,
  width: `calc(100% + ${SPILL_X * 2}px)`,
  height: `calc(100% + ${SPILL_TOP + SPILL_BOTTOM}px)`,
};
/** How much vertical knob drag equals one brightness step. */
const KNOB_STEP_PX = 18;

/** Width in px of the hero board, so panels under it can match it exactly. */
export function heroBoardWidth(): number {
  const size = caseLayout().size;
  return Math.round(400 * (size[0] / size[1]));
}

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
  index,
  register,
}: {
  refSize: [number, number];
  keyBox: LabeledKey;
  interactive: boolean;
  index: number;
  register: (index: number, el: HTMLSpanElement | null) => void;
}) {
  const rect = toPercentRect(refSize, keyBox.position, keyBox.size);
  const widthU = keyBox.size[0] / PITCH_U;
  const keyStyle: CSSProperties = {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
  // Static white cap. The LED glow under it, the faint wash of LED colour on its lower
  // third and the unlit-cap shading are painted per frame on the canvases around the caps.
  const capStyle: CSSProperties = {
    position: "relative",
    zIndex: 2,
    width: "100%",
    height: "100%",
    backgroundImage: "linear-gradient(180deg, #fbfbfc 0%, #eceef2 60%, #dcdfe6 100%)",
    // Corner radius from the key's own height, so wide keys (space, shift)
    // keep the same corners as a 1u key instead of turning into pills.
    borderRadius: `${(16 * (refSize[1] * rect.height)) / (refSize[0] * rect.width)}% / 16%`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 0.1em 0.16em rgba(0,0,0,0.6)",
  };

  return (
    <div
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
            ref={(el) => register(index, el)}
            className="whitespace-nowrap font-semibold leading-none"
            style={{
              // Sized from the key's width in 1u so every legend shares one scale.
              fontSize: `clamp(3px, ${(keyBox.label.length <= 1 ? 29 : 25) / widthU}cqw, 20px)`,
              color: "#3a3f4b",
              ...(widthU >= 1.5
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

const MemoKeycap = memo(Keycap);

export function KeyboardPreview({ className, interactive = true, hero = false, overlay }: { className?: string; interactive?: boolean; hero?: boolean; overlay?: ReactNode }) {
  const effective = useAppStore(selectEffectiveState);
  const state = effective ?? OFFLINE_STATE;
  const previewUrl = useAppStore((s) => s.previewUrl);
  const paused = useAppStore((s) => s.animationsPaused);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const autoApply = useAppStore((s) => s.autoApply);
  const connectedNow = useAppStore((s) => s.connected);
  // A thin amber rim marks edits that are held back (Draft mode or offline).
  const draftRim = draftDirty && (!autoApply || !connectedNow);
  const previewEffect = useAppStore((s) => s.previewEffect);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
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
      effect: previewEffect ?? state.underglow.effect,
      brightness: state.underglow.brightness,
      speed: state.underglow.speed,
      orientation: state.underglow.orientation,
      rainbow: state.underglow.rainbow,
      color: state.underglow.color,
    }),
    [state, previewEffect],
  );

  const led = state.led;
  const barRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const caseRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const seamRef = useRef<HTMLCanvasElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const mode = useSyncExternalStore(subscribeLightingMode, getLightingMode);
  const glAvailable = useMemo(() => webgl2Available(), []);
  const [glFailed, setGlFailed] = useState(false);
  const renderer = chooseRenderer(mode, glAvailable && !glFailed);
  const glowKind: "gl" | "2d" = renderer === "gl" ? "gl" : "2d";
  const activeTabNow = useAppStore((s) => s.activeTab);
  const live = useRef({ lighting, led, activeTab: activeTabNow, still: motionPaused || renderer === "static" });
  live.current = { lighting, led, activeTab: activeTabNow, still: motionPaused || renderer === "static" };
  const wake = useRef<() => void>(() => {});
  const legends = useRef<Array<HTMLSpanElement | null>>([]);
  const registerLegend = useRef((i: number, el: HTMLSpanElement | null) => {
    legends.current[i] = el;
  }).current;

  const nudgeBrightness = (delta: number) => {
    if (!interactive) return;
    const base = effective ?? OFFLINE_STATE;
    const next = Math.min(9, Math.max(0, base.underglow.brightness + delta));
    if (next !== base.underglow.brightness) setLightingDraft({ underglowBrightness: next });
  };

  // The case is sized by the board's aspect ratio; the canvas is the case plus
  // spill margins so the underglow can be drawn outside the board's footprint.
  const boardMaxWidth = Math.round((hero ? 400 : 300) * (board.size[0] / board.size[1]));

  useEffect(() => {
    const canvas = canvasRef.current;
    const glowCanvas = glowRef.current;
    const overlayCanvas = overlayRef.current;
    const seamCanvas = seamRef.current;
    const caseEl = caseRef.current;
    if (!canvas || !glowCanvas || !overlayCanvas || !seamCanvas || !caseEl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let glow: GlowRenderer;
    let overlay: CapOverlay;
    let seam: SeamLayer;
    try {
      glow = createGlow(glowKind, glowCanvas, () => setGlFailed(true));
      overlay = new CapOverlay(overlayCanvas);
      seam = new SeamLayer(seamCanvas);
    } catch {
      // WebGL2 refused to start on this canvas: remount it as a 2D canvas.
      setGlFailed(true);
      return;
    }

    const frame = new Float32Array(coords.length * FRAME_STRIDE);
    const keyRects = keys.map((k) => toPercentRect(board.size, k.position, k.size));
    let caseW = 0;
    let caseH = 0;
    let spillScale = 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const layout = () => {
      const rect = caseEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      caseW = rect.width;
      caseH = rect.height;
      const cssW = caseW + SPILL_X * 2;
      const cssH = caseH + SPILL_TOP + SPILL_BOTTOM;
      spillScale = 1;
      canvas.width = Math.max(1, Math.round(cssW * spillScale));
      canvas.height = Math.max(1, Math.round(cssH * spillScale));
      const rects = keyRects.map((r) => ({
        x: SPILL_X + (r.left / 100) * caseW,
        y: SPILL_TOP + (r.top / 100) * caseH,
        w: (r.width / 100) * caseW,
        h: (r.height / 100) * caseH,
      }));
      glow.resize(cssW, cssH, rects, Math.min(dpr, 1.5));
      overlay.resize(cssW, cssH, rects, dpr);
      seam.resize(cssW, cssH, rects, Math.min(dpr, 1.5));
    };
    layout();

    const gateAmbient = rateGate(10);
    const lastVars = { ambient: "", rim: "", bar: "" };
    const lastLegend: string[] = [];

    const draw = (t: number) => {
      const { lighting: l, led: ledNow } = live.current;
      const timeMs = t;
      const bar = barRef.current;
      if (bar) {
        const s = ledBarSample(ledNow, timeMs);
        const v = `${s.r} ${s.g} ${s.b}|${s.a.toFixed(2)}`;
        if (v !== lastVars.bar) {
          lastVars.bar = v;
          bar.style.setProperty("--lc", `${s.r} ${s.g} ${s.b}`);
          bar.style.setProperty("--la", s.a.toFixed(3));
        }
      }
      if (caseW <= 0 || caseH <= 0) return;

      // One LED sample per key per frame feeds the glow, cap tint, spill, rim and ambient light.
      const avg = sampleFrame(l, coords, timeMs, frame);
      glow.draw(frame);
      seam.draw(frame);
      overlay.draw(frame);

      // Outside-the-case spill: a soft animated band below and around the case.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      const cw = caseW * spillScale;
      const ch = caseH * spillScale;
      const originX = SPILL_X * spillScale;
      const originY = SPILL_TOP * spillScale;
      const spillY = originY + ch + 6 * spillScale;
      for (let i = 0; i < 8; i++) {
        const fx = (i + 0.5) / 8;
        const s = ledSample(l, fx, 0.98, i * 11, timeMs);
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

      let rimVal = "139 92 246|0";
      let ambient = ambientFrom(null, 0);
      if (avg.weight > 0) {
        const avgR = Math.round(avg.r);
        const avgG = Math.round(avg.g);
        const avgB = Math.round(avg.b);
        // Live average brightness drives the rim and the case spill.
        const k = Math.min(1, avg.weight / coords.length);
        rimVal = `${quantise(avgR, 4)} ${quantise(avgG, 4)} ${quantise(avgB, 4)}|${(Math.round(Math.min(1, k * 1.8) * 40) / 40).toFixed(3)}`;
        ambient = ambientFrom({ r: avgR, g: avgG, b: avgB }, Math.min(1, k * 1.6));
        const r = cw * 0.55;
        ctx.save();
        ctx.translate(originX + cw / 2, spillY);
        ctx.scale(1, 0.22);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, `rgba(${avgR}, ${avgG}, ${avgB}, ${0.5 * k})`);
        g.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";

      // Style writes are the expensive part of a frame: only when the quantised value changes,
      // at most 10 times a second, and on leaf elements so the key subtree is not invalidated.
      if (gateAmbient(t)) {
        // Legends pick up the LED colour (up to 17%) like the cap's wash; leaf `color` writes, only on change.
        for (let k = 0; k < coords.length; k++) {
          const el = legends.current[k];
          if (!el) continue;
          const o = k * FRAME_STRIDE;
          const tt = frame[o + 4];
          const mix = (c: number, base: number) => Math.round((base + (c - base) * tt) / 4) * 4;
          const col = tt > 0.002 ? `rgb(${mix(frame[o], 58)},${mix(frame[o + 1], 63)},${mix(frame[o + 2], 75)})` : "rgb(58,63,75)";
          if (lastLegend[k] !== col) {
            lastLegend[k] = col;
            el.style.color = col;
          }
        }
        const rimEl = rimRef.current;
        if (rimEl && rimVal !== lastVars.rim) {
          lastVars.rim = rimVal;
          const [rgb, kk] = rimVal.split("|");
          rimEl.style.setProperty("--rim", rgb);
          rimEl.style.setProperty("--rimk", kk);
        }
        const amb = `${ambient.rgb}|${ambient.k}`;
        if (amb !== lastVars.ambient) {
          lastVars.ambient = amb;
          const root = document.documentElement.style;
          root.setProperty("--board-rgb", ambient.rgb);
          root.setProperty("--board-k", ambient.k);
        }
      }
    };

    // Pacing: adaptive fps tier, sleeping when nobody can see the board.
    const quality = new AdaptiveQuality();
    let raf = 0;
    let lastDraw = -Infinity;
    let disposed = false;
    let onScreen = true;
    const awake = () => !document.hidden && document.hasFocus() && onScreen;
    const targetFps = () => {
      const { activeTab: tab, still } = live.current;
      if (still) return 0;
      return tab === "lighting" ? quality.fps : 1;
    };
    const loop = (t: number) => {
      raf = 0;
      if (disposed || !awake()) return;
      const fps = targetFps();
      if (fps > 0) {
        const interval = 1000 / fps;
        if (t - lastDraw >= interval - 3) {
          const t0 = performance.now();
          draw(t);
          const cost = performance.now() - t0;
          // A late frame means the page (style, raster) is struggling even if our own JS is cheap.
          const late = lastDraw === -Infinity ? 0 : Math.max(0, t - lastDraw - interval * 1.5);
          lastDraw = t;
          if (live.current.activeTab === "lighting") quality.push(cost + late);
        }
        raf = requestAnimationFrame(loop);
      }
    };
    const start = () => {
      if (disposed || raf || !awake()) return;
      raf = requestAnimationFrame(loop);
    };
    // Redraw now (state changed or the window came back), then keep animating if allowed.
    const redraw = () => {
      if (disposed) return;
      draw(performance.now());
      lastDraw = -Infinity;
      start();
    };
    wake.current = redraw;
    redraw();

    const onVis = () => (awake() ? redraw() : undefined);
    // Focus can change without an event (embedded webviews), so a slow watchdog restarts a sleeping loop.
    const watchdog = window.setInterval(() => {
      if (!raf && !disposed && awake() && targetFps() > 0) redraw();
    }, 1000);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        const was = onScreen;
        onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
        if (onScreen && !was) redraw();
      });
      io.observe(caseEl);
    }
    let resizeTimer = 0;
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          layout();
          redraw();
        }, 120);
      });
      ro.observe(caseEl);
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      io?.disconnect();
      ro?.disconnect();
      glow.dispose();
      wake.current = () => {};
    };
  }, [coords, keys, board, glowKind]);

  // Lighting edits and screen changes repaint immediately without rebuilding any renderer.
  useEffect(() => {
    wake.current();
  }, [lighting, led, activeTabNow, motionPaused, renderer]);

  const recessRect = toPercentRect(board.size, recess.position, recess.size);
  const plateRect = toPercentRect(board.size, plate.position, plate.size);
  const moduleRect = toPercentRect(board.size, module.position, module.size);
  const screenRecessRect = toPercentRect(board.size, screenRecess.position, screenRecess.size);
  const displayRect = toPercentRect(board.size, display.position, display.size);
  const knobRect = toPercentRect(board.size, knob.position, [knob.radius * 2, knob.radius * 2]);
  const ledRecessRect = toPercentRect(board.size, ledRecess.position, ledRecess.size);
  const ledBarRect = toPercentRect(board.size, ledBar.position, ledBar.size);

  const barBtnRef = useRef<HTMLButtonElement>(null);
  const [barOpen, setBarOpen] = useState(false);
  const activeTab = useAppStore((s) => s.activeTab);
  useEffect(() => {
    const open = () => setBarOpen(true);
    window.addEventListener(OPEN_LIGHT_BAR_EVENT, open);
    return () => window.removeEventListener(OPEN_LIGHT_BAR_EVENT, open);
  }, []);

  const dragStart = useRef<number | null>(null);
  const dragStage = useRef(0);

  const showPreview = Boolean(previewUrl);
  const clock = effective ? effective.time : OFFLINE_STATE.time;
  const clockLabel = `${String(clock[4]).padStart(2, "0")}:${String(clock[5]).padStart(2, "0")}`;
  const dateLabel = `${new Date(clock[0], Math.max(0, clock[1] - 1), clock[2]).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
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
      className={cn("relative w-full p-2", hero && "overflow-hidden", className)}
    >
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
              borderRadius: "10px",
              backgroundImage: "linear-gradient(180deg, #22252c 0%, #101217 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.08), 0 34px 54px -18px rgba(0,0,0,0.8), 0 2px 0 rgba(255,255,255,0.02)",
            }}
          />

          {/* Rim glow: 1px inner edge in the average LED colour */}
          <div
            ref={rimRef}
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              borderRadius: "10px",
              boxShadow:
                `inset 0 0 12px rgb(var(--rim, 139 92 246) / calc(var(--rimk, 0) * 0.5)), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 26px -6px rgb(var(--rim, 139 92 246) / calc(var(--rimk, 0) * 0.45))${draftRim ? ", 0 0 0 1px rgba(255,176,32,0.7), 0 0 14px 0 rgba(255,176,32,0.25)" : ""}`,
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

          {/* Outside-the-case underglow spill. */}
          <canvas
            ref={canvasRef}
            aria-hidden
            className="pointer-events-none absolute"
            style={{ ...SPILL_BOX }}
          />

          {/* Light under every cap: halo, gap light, row bleed and seam, one canvas for all keys */}
          <canvas
            key={`glow-${glowKind}`}
            ref={glowRef}
            aria-hidden
            data-renderer={glowKind}
            className="pointer-events-none absolute"
            style={{ ...SPILL_BOX, mixBlendMode: "screen" }}
          />

          {/* The hot seam line under each cap (blended normally, not screened) */}
          <canvas
            ref={seamRef}
            aria-hidden
            className="pointer-events-none absolute"
            style={{ ...SPILL_BOX }}
          />

          {/* Static keycaps */}
          {keys.map((key, index) => (
            <MemoKeycap key={`cap-${index}`} refSize={board.size} keyBox={key} interactive={interactive} index={index} register={registerLegend} />
          ))}

          {/* Cap-level light: the faint wash of LED colour and the unlit-cap shading */}
          <canvas
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute"
            style={{ ...SPILL_BOX, zIndex: 3 }}
          />

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
                className="flex h-full w-full flex-col items-center justify-center gap-[3%] bg-[radial-gradient(ellipse_at_50%_40%,rgba(90,150,255,0.22),transparent_75%)]"
                style={{ color: "#e6f1ff" }}
              >
                <span
                  className="font-semibold leading-none"
                  style={{ fontSize: "clamp(8px, 26cqw, 40px)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", textShadow: "0 0 14px rgba(120,180,255,0.65)" }}
                >
                  {clockLabel}
                </span>
                {hero && (
                  <span className="leading-none opacity-80" style={{ fontSize: "clamp(9px, 9cqw, 13px)" }}>
                    {dateLabel}
                  </span>
                )}
              </span>
            )}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(120deg, rgba(255,255,255,0.08), transparent 30%)",
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
          {interactive && activeTab !== "display" && (
            <button
              type="button"
              aria-label="Open display settings"
              title="Open display settings"
              onClick={() => setActiveTab("display")}
              className="absolute cursor-pointer rounded-[2%]"
              style={{
                left: `${displayRect.left}%`,
                top: `${displayRect.top}%`,
                width: `${displayRect.width}%`,
                height: `${displayRect.height}%`,
              }}
            />
          )}
          {interactive && (
            <button
              ref={barBtnRef}
              type="button"
              aria-label="Edit side light bar"
              aria-haspopup="dialog"
              aria-expanded={barOpen}
              title="Edit side light bar"
              onClick={() => setBarOpen((o) => !o)}
              className="absolute cursor-pointer rounded-full"
              style={{
                left: `calc(${ledBarRect.left}% - 8px)`,
                top: `calc(${ledBarRect.top}% - 8px)`,
                width: `calc(${ledBarRect.width}% + 16px)`,
                height: `calc(${ledBarRect.height}% + 16px)`,
              }}
            />
          )}
          {overlay}
        </div>
      </div>

      {barOpen && <LightBarPopover anchor={barBtnRef} onClose={() => setBarOpen(false)} />}

      {previewEffect !== null && previewEffect !== (effective ?? OFFLINE_STATE).underglow.effect && (
        <span
          role="status"
          className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/20 bg-black/65 px-3 py-1 text-[11px] font-medium text-white backdrop-blur"
        >
          Previewing {UNDERGLOW_EFFECTS.find((e) => e.value === previewEffect)?.name ?? "effect"} — click to stage
        </span>
      )}
    </div>
  );
}
