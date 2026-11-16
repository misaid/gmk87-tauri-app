import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { LED_COLORS, LED_COLOR_SWATCHES, LED_MODES } from "@/lib/effects";
import { useDialogFocusTrap } from "@/lib/useDialog";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** Dispatch on window to open the side light bar popover from anywhere. */
export const OPEN_LIGHT_BAR_EVENT = "gmk:open-light-bar";
export const openLightBar = () => window.dispatchEvent(new Event(OPEN_LIGHT_BAR_EVENT));

const WIDTH = 300;

/** Popover anchored to the board's light bar: 5 modes, 9 colours, saturation. */
export function LightBarPopover({ anchor, onClose }: { anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const { led } = effective ?? committed ?? OFFLINE_STATE;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useDialogFocusTrap(ref, true);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 330;
      if (!r) return;
      const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, r.right - WIDTH));
      const below = r.bottom + 10;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 10) : below;
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [anchor, onClose]);

  function stage(patch: Parameters<typeof setLightingDraft>[0]) {
    if (typeof setLightingDraft === "function") setLightingDraft(patch);
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Side light bar"
      className="panel fixed z-50 flex flex-col gap-4 p-4 text-[13px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      <div className="flex items-center justify-between">
        <h2 className="silk">Side light bar</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-[var(--r-ctl)] px-1.5 text-[16px] leading-none text-[var(--muted)] transition-colors hover:bg-[var(--bg-raise-2)] hover:text-[var(--text)]">
          ×
        </button>
      </div>
      <span
        aria-hidden
        className="block h-1.5 w-full rounded-full"
        style={{ background: LED_COLOR_SWATCHES[led.color], opacity: led.color === 8 ? 0.25 : 1, boxShadow: `0 0 12px -2px ${LED_COLOR_SWATCHES[led.color]}` }}
      />
      <div className="grid grid-cols-2 gap-1.5">
        {LED_MODES.map((mode, i) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={led.mode === mode.value}
            // Rainbow overrides the colour, so picking a colour or a non-rainbow mode clears it.
            onClick={() => stage(mode.value === 1 ? { ledMode: 1 } : { ledMode: mode.value, ledRainbow: 0 })}
            className={`keycap-dark h-8 px-2.5 text-xs ${i === LED_MODES.length - 1 && LED_MODES.length % 2 === 1 ? "col-span-2" : ""}`}
          >
            {mode.name}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        {LED_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            aria-label={color.name}
            aria-pressed={led.color === color.value}
            title={color.name}
            onClick={() => stage({ ledColor: color.value, ledRainbow: 0, ...(led.mode === 1 ? { ledMode: 3 } : {}) })}
            className={`swatch !size-6 ${led.color === color.value ? "swatch-on" : ""}`}
            style={{ background: LED_COLOR_SWATCHES[color.value], "--sw": LED_COLOR_SWATCHES[color.value] } as CSSProperties}
          />
        ))}
      </div>
      <div>
        <Label htmlFor="lighting-saturation" className="silk flex items-baseline gap-2">
          Saturation <b className="readout !text-[12px] font-medium normal-case tracking-normal text-[var(--text)]">{led.saturation}/9</b>
        </Label>
        <Slider
          id="lighting-saturation"
          aria-label="Saturation"
          className="mt-1"
          ticks={10}
          min={0}
          max={9}
          step={1}
          value={[led.saturation]}
          onValueChange={([v]) => stage({ ledSaturation: v })}
        />
      </div>
    </div>,
    document.body,
  );
}
