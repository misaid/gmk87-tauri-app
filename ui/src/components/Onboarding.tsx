import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";
import { useDialogFocusTrap } from "@/lib/useDialog";

const STEPS = [
  {
    title: "Welcome to your GMK87",
    body: "Everything you tweak appears instantly in the board picture here. Nothing is written to the board until you say so — try dragging the knob.",
    bullets: ["One mental model: Draft → Write to board", "Every change can be undone"],
  },
  {
    title: "Edit safely",
    body: "Display images live as a draft until Write image to board. Lighting edits live as a draft until Write to board. The board status always shows what is on the board vs what is staged.",
    bullets: ["Prepare images offline; upload once connected", "Lighting stages offline too — it waits until you connect"],
  },
  {
    title: "You're ready",
    body: "Four tabs only: Device, Display, Lighting, Profiles. Head to Device to connect, or keep editing — nothing can break the board from a draft.",
    bullets: ["Press Go to Device to connect, or start editing right away"],
  },
] as const;

export function OnboardingWizard() {
  const show = useAppStore((s) => s.showOnboarding);
  const setShow = useAppStore((s) => s.setShowOnboarding);
  const setOnboarded = useAppStore((s) => s.setOnboarded);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(panelRef, show);

  // Replay always starts at the beginning, not where you left off.
  useEffect(() => {
    if (show) setStep(0);
  }, [show]);

  // Esc closes without marking the tour complete.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, setShow]);

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function finish(gotoDevices = false) {
    setOnboarded(true);
    setShow(false);
    if (gotoDevices) setActiveTab("device");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        ref={panelRef}
        className="dialog-panel w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/50">GMK87 · first run</p>
            <h2 id="onboarding-title" className="mt-1 text-lg font-medium text-white">
              {current.title}
            </h2>
          </div>
          <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/70">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            className="h-full rounded-full bg-white transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-white/80">{current.body}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-white/70">
          {current.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => finish()}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {!isLast ? (
              <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={() => finish(true)}>
                Go to Device
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const GLOSSARY: ReadonlyArray<{ term: string; def: string }> = [
  {
    term: "Underglow",
    def: "The light that spills from beneath the key plate. Effects 0–18 on the board — waves, rainbows, breathing — are all underglow.",
  },
  {
    term: "Side LEDs",
    def: "The two strip lights on the left and right edges of the board. They have their own mode, saturation, colour and rainbow flag, separate from underglow.",
  },
  {
    term: "Slot",
    def: "One of two image slots (Slot 0 / Slot 1) for the display. Each holds one animated image. Both slots are resent on every upload.",
  },
  {
    term: "Frame budget",
    def: "The board stores 36 animation frames total across both slots. A 40-frame GIF is compressed down to fit — frames are dropped and the app says so.",
  },
  {
    term: "Frame delay",
    def: "How long each frame shows, in milliseconds. Lower delay = faster animation, but it can push you over the frame budget.",
  },
  {
    term: "Draft",
    def: "Lighting edits that only change the picture in the app. Nothing is written to the board until you press Write to board. Discard throws the draft away.",
  },
  {
    term: "Preset",
    def: "A named bundle of lighting settings (e.g. gaming, matrix). Choosing one makes a draft — Write to board puts it on the board. You can undo it.",
  },
  {
    term: "VIA",
    def: "A standard for remapping QMK keyboards. When detected, key remapping becomes available in a future version.",
  },
  {
    term: "Win Lock",
    def: "Disables the Windows key so a stray press doesn't open the Start menu mid-game.",
  },
  {
    term: "Read-back",
    def: "Asking the board what it currently holds. The GMK87 can't be read back — the app keeps the last settings it wrote instead.",
  },
] as const;

export function GlossaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="dialog-panel max-h-[80vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 id="glossary-title" className="text-lg font-medium text-white">
            Glossary &amp; help
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="mt-1 text-xs text-white/70">Plain-language meanings for every term in the app.</p>
        <div className="mt-3 rounded-lg border border-white/10 p-3 text-xs text-white/70">
          <p className="font-medium text-white">Shortcuts — this is a keyboard product</p>
          <p className="mt-1">1 / 2 / 3 switch tabs · ? opens this help · p pauses animation · ⌘Z undoes the last write · ⌘K opens the command palette.</p>
        </div>
        <dl className="mt-4 flex flex-col gap-3">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="rounded-lg border border-white/10 p-3">
              <dt className="text-sm font-medium text-white">{g.term}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-white/70">{g.def}</dd>
            </div>
          ))}
        </dl>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            onClose();
            setShowOnboarding(true);
          }}
        >
          Replay the first-run tour
        </Button>
      </div>
    </div>
  );
}
