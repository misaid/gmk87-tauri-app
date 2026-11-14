import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
      className="fixed z-50 flex flex-col gap-3.5 rounded-[16px] border border-white/10 bg-[rgba(14,16,22,0.88)] p-4 text-[13px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[var(--text)]">Side light bar</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-md px-1.5 text-[16px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
          ×
        </button>
      </div>
      <span
        aria-hidden
        className="block h-1.5 w-full rounded-full ring-1 ring-white/10"
        style={{ background: LED_COLOR_SWATCHES[led.color], opacity: led.color === 8 ? 0.25 : 1 }}
      />
      <div className="grid grid-cols-2 gap-1.5">
        {LED_MODES.map((mode, i) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={led.mode === mode.value}
            onClick={() => stage({ ledMode: mode.value })}
            className={
              (i === LED_MODES.length - 1 && LED_MODES.length % 2 === 1 ? "col-span-2 " : "") +
              (led.mode === mode.value
                ? "h-8 rounded-[7px] bg-[var(--accent)]/20 px-2.5 text-xs font-medium text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent-ambient)]"
                : "h-8 rounded-[7px] bg-[var(--panel-2)] px-2.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]")
            }
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
            onClick={() => stage({ ledColor: color.value })}
            className={
              led.color === color.value
                ? "size-6 rounded-full ring-2 ring-white ring-offset-2 ring-offset-[#10131a]"
                : "size-6 rounded-full ring-1 ring-white/20 transition-transform duration-150 hover:scale-110"
            }
            style={{ background: LED_COLOR_SWATCHES[color.value] }}
          />
        ))}
      </div>
      <div>
        <Label htmlFor="lighting-saturation" className="text-[13px] text-[var(--muted)]">
          Saturation <b className="ml-1 font-semibold text-[var(--text)]">{led.saturation}/9</b>
        </Label>
        <Slider
          id="lighting-saturation"
          aria-label="Saturation"
          className="mt-1"
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
