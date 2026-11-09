import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useDialogFocusTrap } from "@/lib/useDialog";
import { useAppStore } from "@/store";
import { LED_COLORS, LED_MODES, UNDERGLOW_EFFECTS } from "@/lib/effects";

function effectName(v: number) {
  return UNDERGLOW_EFFECTS.find((e) => e.value === v)?.name ?? `${v}`;
}
function ledModeName(v: number) {
  return LED_MODES.find((m) => m.value === v)?.name ?? `${v}`;
}
function ledColorName(v: number) {
  return LED_COLORS.find((c) => c.value === v)?.name ?? `${v}`;
}

export function WriteConfirm() {
  const open = useAppStore((s) => s.showWriteConfirm);
  const setOpen = useAppStore((s) => s.setShowWriteConfirm);
  const commitDraft = useAppStore((s) => s.commitDraft);
  const committed = useAppStore((s) => s.state);
  const draft = useAppStore((s) => s.draft);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open || !draftDirty || !committed || !draft) return null;
  const changes = [
    ["Effect", effectName(committed.underglow.effect), effectName(draft.underglow.effect)],
    ["Colour", `rgb(${committed.underglow.color.join(",")})`, `rgb(${draft.underglow.color.join(",")})`],
    ["Brightness", `${committed.underglow.brightness}/9`, `${draft.underglow.brightness}/9`],
    ["Speed", `${committed.underglow.speed}/9`, `${draft.underglow.speed}/9`],
    ["Direction", committed.underglow.orientation ? "Right to left" : "Left to right", draft.underglow.orientation ? "Right to left" : "Left to right"],
    ["Rainbow glow", committed.underglow.rainbow ? "On" : "Off", draft.underglow.rainbow ? "On" : "Off"],
    ["LEDs", ledModeName(committed.led.mode), ledModeName(draft.led.mode)],
    ["LED colour", ledColorName(committed.led.color), ledColorName(draft.led.color)],
    ["LED sat.", `${committed.led.saturation}/9`, `${draft.led.saturation}/9`],
    ["LED rainbow", committed.led.rainbow ? "On" : "Off", draft.led.rainbow ? "On" : "Off"],
    ["Win lock", committed.winLock ? "On" : "Off", draft.winLock ? "On" : "Off"],
  ].filter(([, a, b]) => a !== b);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="write-confirm-title"
      onClick={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        className="dialog-panel w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="write-confirm-title" className="text-base font-medium text-white">
          Write this draft to the board?
        </h3>

        <div className="mt-4 max-h-64 overflow-y-auto pr-1">
          <dl className="space-y-1.5 text-sm">
            {changes.map(([label, from, to]) => (
              <div key={label} className="flex items-center justify-between gap-3 border-b border-white/10 pb-1.5">
                <dt className="text-white/70">{label}</dt>
                <dd className="flex items-center gap-2 text-right"><span className="text-white/60">{label === "Colour" ? <span className="inline-block size-3.5 rounded-full border border-white/20" style={{ background: from }} aria-hidden /> : from}</span> <span aria-hidden>→</span> <span className="font-semibold text-sky-300">{label === "Colour" ? <span className="inline-block size-3.5 rounded-full border border-white/20" style={{ background: to }} aria-hidden /> : to}</span></dd>
              </div>
            ))}
          </dl>
        </div>

        <details className="mt-3 rounded-lg border border-white/10 p-3">
          <summary className="cursor-pointer text-xs font-medium text-white/80">Everything else stays the same</summary>
          <p className="mt-2 text-xs text-white/70">Only the fields listed above change. All other board settings keep their current values.</p>
        </details>

        <p className="mt-3 text-xs text-white/70">
          This overwrites the board — undo history is kept.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              void commitDraft();
            }}
          >
            Write to board
          </Button>
        </div>
      </div>
    </div>
  );
}
