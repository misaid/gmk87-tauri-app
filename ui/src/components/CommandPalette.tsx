import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { EFFECT_FIRMWARE_NAMES, LED_COLORS, LED_COLOR_SWATCHES, PRESET_VALUES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { useAppStore } from "@/store";
import { useDialogFocusTrap } from "@/lib/useDialog";

/**
 * Cmd+K command palette — the power-user path the shell was missing.
 * Searches effects (by name + number), presets, and app actions.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const committed = useAppStore((s) => s.state);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const presets = useAppStore((s) => s.presets);
  const undoLighting = useAppStore((s) => s.undoLighting);
  const setAnimationsPaused = useAppStore((s) => s.setAnimationsPaused);
  const paused = useAppStore((s) => s.animationsPaused);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const effects = UNDERGLOW_EFFECTS.filter(
      (e) => !needle || e.name.toLowerCase().includes(needle) || EFFECT_FIRMWARE_NAMES[e.value]?.toLowerCase().includes(needle) || String(e.value) === needle,
    ).map((e) => ({
      id: `effect-${e.value}`,
      label: `${e.name} (#${e.value})`,
      hint: "Draft",
      group: "Effects" as const,
      run: () => {
        setLightingDraft?.({ underglowEffect: e.value });
        setActiveTab("lighting");
      },
    }));
    const presetItems = presets
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => ({
        id: `preset-${p.name}`,
        label: p.name.replace(/-/g, " "),
        hint: "Draft",
        group: "Presets" as const,
        run: () => {
          const v = PRESET_VALUES[p.name];
          if (!v) return;
          setLightingDraft?.({
            underglowEffect: v.effect,
            underglowBrightness: v.brightness,
            underglowSpeed: v.speed,
            underglowOrientation: v.orientation,
            underglowRainbow: v.rainbow,
            underglowColor: v.color,
            ledMode: v.ledMode,
            ledSaturation: v.ledSaturation,
            ledRainbow: v.ledRainbow,
            ledColor: v.ledColor,
          });
          setActiveTab("lighting");
        },
      }));
    const actions = [
      { id: "go-device", label: "Go to Device & clock", hint: "Connect + sync", group: "Actions" as const, run: () => setActiveTab("device") },
      { id: "go-display", label: "Go to Display", hint: "Image & upload", group: "Actions" as const, run: () => setActiveTab("display") },
      { id: "go-lighting", label: "Go to Lighting", hint: "Underglow & LEDs", group: "Actions" as const, run: () => setActiveTab("lighting") },
      { id: "bright-0", label: "Brightness: Off", hint: "Draft", group: "Actions" as const, run: () => setLightingDraft?.({ underglowBrightness: 0 }) },
      { id: "bright-5", label: "Brightness: Medium (5)", hint: "Draft", group: "Actions" as const, run: () => setLightingDraft?.({ underglowBrightness: 5 }) },
      { id: "bright-9", label: "Brightness: Vivid (9)", hint: "Draft", group: "Actions" as const, run: () => setLightingDraft?.({ underglowBrightness: 9 }) },
      { id: "winlock-on", label: "Windows key lock: On", hint: "Draft", group: "Actions" as const, run: () => setLightingDraft?.({ winLock: true }) },
      { id: "winlock-off", label: "Windows key lock: Off", hint: "Draft", group: "Actions" as const, run: () => setLightingDraft?.({ winLock: false }) },
      ...(committed ? [{ id: "write-board", label: "Write draft to board", hint: "Commit", group: "Actions" as const, run: () => useAppStore.getState().setShowWriteConfirm?.(true) }] : []),
      { id: "sync-clock", label: "Sync clock now", hint: "Device", group: "Actions" as const, run: () => { setActiveTab("device"); void useAppStore.getState().syncClock?.(); } },
      { id: "undo", label: "Undo last lighting write", hint: "⌘Z", group: "Actions" as const, run: () => void undoLighting?.() },
      { id: "undo-display", label: "Undo last display upload", hint: "Display", group: "Actions" as const, run: () => void useAppStore.getState().undoDisplayUpload?.() },
      {
        id: "pause",
        label: paused ? "Play animations" : "Pause animations",
        hint: "P",
        group: "Actions" as const,
        run: () => setAnimationsPaused(!paused),
      },
    ].filter((a) => !needle || a.label.toLowerCase().includes(needle));
    return [...effects, ...presetItems, ...actions];
  }, [q, presets, committed, setActiveTab, setLightingDraft, undoLighting, setAnimationsPaused, paused]);

  if (!open) return null;

  function choose(i: number) {
    const item = items[i];
    if (!item) return;
    onClose();
    item.run();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div ref={panelRef} className="dialog-panel w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          type="search"
          placeholder="Effects, presets, actions…  (⌘K)"
          aria-label="Search commands"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(items.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(cursor);
            }
          }}
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-white placeholder:text-white/70"
        />
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Results">
          {items.map((item, i) => (
            <Fragment key={item.id}>
              {(i === 0 || items[i - 1].group !== item.group) && (
                <li aria-hidden className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-white/50">{item.group}</li>
              )}
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(i)}
                  className={
                    i === cursor
                      ? "flex w-full items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-left text-sm text-black"
                      : "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                  }
                >
                  <span className="font-medium">{item.label}</span>
                  <span className={i === cursor ? "text-xs text-black/70" : "text-xs text-white/70"}>{item.hint}</span>
                </button>
              </li>
            </Fragment>
          ))}
          {items.length === 0 && <li className="px-3 py-4 text-sm text-white/70">No matches</li>}
        </ul>
        <p className="border-t border-white/10 px-4 py-2 text-xs text-white/70">↑↓ navigate · Enter run · Esc close</p>
      </div>
    </div>
  );
}

// Re-export for tests that import the palette directly.
export const LED_COLORS_UNCHANGED = LED_COLORS;
export const LED_COLOR_SWATCHES_UNCHANGED = LED_COLOR_SWATCHES;
