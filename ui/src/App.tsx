import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { CircleHelp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { KeyboardPreview } from "@/components/KeyboardPreview";
import { LightingDock } from "@/components/LightingDock";
import { HelpDialog } from "@/components/HelpDialog";
import { Toast } from "@/components/Toast";
import { useDeviceEvents } from "@/lib/useDeviceEvents";
import DeviceScreen from "@/screens/DeviceScreen";
import DisplayScreen from "@/screens/DisplayScreen";
import LightingScreen from "@/screens/LightingScreen";
import ProfilesScreen from "@/screens/ProfilesScreen";
import { LED_MODES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { brightnessLabel } from "@/components/lighting";
import { selectEffectiveState, useAppStore } from "@/store";

const NAV_ITEMS = [
  { value: "lighting", label: "Lighting" },
  { value: "display", label: "Display" },
  { value: "device", label: "Device" },
  { value: "profiles", label: "Profiles" },
] as const;

type Tab = (typeof NAV_ITEMS)[number]["value"];

const SCREENS: Record<Tab, ComponentType> = {
  device: DeviceScreen,
  display: DisplayScreen,
  lighting: LightingScreen,
  profiles: ProfilesScreen,
};

export default function App() {
  useDeviceEvents();
  const tab = useAppStore((s) => s.activeTab);
  const setTab = useAppStore((s) => s.setActiveTab);
  const effective = useAppStore(selectEffectiveState);
  const connected = useAppStore((s) => s.connected);
  const connectingPath = useAppStore((s) => s.connectingPath ?? null);
  const draft = useAppStore((s) => s.draft);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const commitDraft = useAppStore((s) => s.commitDraft);
  const undoLighting = useAppStore((s) => s.undoLighting);
  const undoDisplayUpload = useAppStore((s) => s.undoDisplayUpload);
  const togglePaused = useAppStore((s) => s.setAnimationsPaused);
  const paused = useAppStore((s) => s.animationsPaused);
  const reduceMotion = useReducedMotion();
  const [helpOpen, setHelpOpen] = useState(false);

  // Auto-apply: a staged draft is written to the board shortly after the last
  // edit. The draft signature is the debounce key, so each distinct edit
  // restarts the timer. A failed write is not retried for the same signature —
  // a new edit or a reconnect clears that memory and tries again.
  const draftSignature = useMemo(() => (draft ? JSON.stringify(draft) : ""), [draft]);
  const lastAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!connected) lastAttemptedRef.current = null;
  }, [connected]);

  useEffect(() => {
    if (!connected || !draftDirty || !draftSignature) return;
    if (lastAttemptedRef.current === draftSignature) return;
    const id = window.setTimeout(() => {
      lastAttemptedRef.current = draftSignature;
      void commitDraft();
    }, 650);
    return () => window.clearTimeout(id);
  }, [connected, draftDirty, draftSignature, commitDraft]);

  // Shortcuts: 1–4 tabs, ? help, p pause, Cmd/Ctrl+Z undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (tab === "display") void undoDisplayUpload();
        else void undoLighting();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const inControl = target?.closest("button, [role='slider']");
      if (e.key.toLowerCase() === "p") {
        if (target?.closest("button, select")) return;
        togglePaused(!paused);
        useAppStore.getState().setNotice(paused ? "Animations playing — press p to pause" : "Animations paused — press p to resume");
        return;
      }
      if (inControl) return;
      const map: Record<string, Tab> = { "1": "device", "2": "display", "3": "lighting", "4": "profiles" };
      if (map[e.key]) setTab(map[e.key]);
      else if (e.key === "?") setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab, tab, undoLighting, undoDisplayUpload, togglePaused, paused]);

  const Screen = SCREENS[tab];

  const chipBtn =
    "inline-flex h-6 items-center rounded-full border border-[var(--line-strong)] px-2.5 text-[12px] text-[var(--text)] transition-colors hover:border-white/40 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  /** Switch to Lighting if needed, then scroll to and focus the matching control. */
  function jumpTo(selector: string) {
    const go = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
    };
    if (tab !== "lighting") {
      setTab("lighting");
      window.setTimeout(go, 450);
    } else go();
  }

  const effectName = effective
    ? UNDERGLOW_EFFECTS.find((e) => e.value === effective.underglow.effect)?.name ?? "Off"
    : "—";
  const sideLedName = effective
    ? LED_MODES.find((m) => m.value === effective.led.mode)?.name ?? "—"
    : "—";
  const draftQueuedOffline = draftDirty && !connected;
  const error = useAppStore((s) => s.error);

  const chip = connectingPath
    ? { label: "Connecting…", dot: "bg-[var(--warn)] animate-pulse" }
    : draftDirty && connected
      ? { label: "Applying…", dot: "bg-[var(--accent)] animate-pulse" }
      : connected
        ? { label: "Connected", dot: "bg-[var(--success)]" }
        : { label: "Not connected", dot: "bg-[var(--dim)]" };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-[8px]">
          <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
            <div className="flex items-center gap-2.5 leading-tight">
              <span className="relative flex size-2">
                <span aria-hidden className="absolute inset-0 rounded-full bg-[var(--accent)] blur-[3px]" />
                <span className="relative size-2 rounded-full bg-[var(--accent)]" />
              </span>
              <span>
                <span className="block text-[13px] font-semibold tracking-[0.02em] text-[var(--text)]">GMK87</span>
                <span className="block text-[11px] leading-none text-[var(--muted)]">Configurator</span>
              </span>
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList className="rounded-full border border-[var(--line)] bg-[var(--panel)] p-1">
                {NAV_ITEMS.map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="rounded-full px-3.5 py-1 text-[13px] font-medium text-[var(--muted)] transition-colors duration-150 hover:text-[var(--text)] data-[state=active]:bg-[var(--pill)] data-[state=active]:text-[var(--text)]"
                  >
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center justify-end gap-2.5">
              <span className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--text)]">
                <span aria-hidden className={`size-2 rounded-full ${chip.dot}`} />
                {chip.label}
              </span>
              <button
                type="button"
                aria-label="Help"
                onClick={() => setHelpOpen(true)}
                className="flex size-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors duration-150 hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
              >
                <CircleHelp className="size-[18px]" aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="px-6 pt-3">
            <div className="mx-auto w-full max-w-[1180px]">
              <ErrorBanner />
            </div>
          </div>
        )}

        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[560px]"
            style={{ background: "radial-gradient(70% 65% at 50% 44%, var(--board-glow), transparent 78%)" }}
          />
          <section aria-label="Keyboard preview" className="relative mx-auto flex w-full max-w-[1320px] flex-col gap-2 px-6 pt-5">
            <div className={tab === "lighting" ? "w-full" : "mx-auto w-full max-w-[600px]"}>
              <KeyboardPreview className="w-full" hero={tab === "lighting"} />
            </div>
            {tab === "lighting" && <LightingDock />}
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {tab !== "lighting" && <span className="inline-flex h-6 items-center rounded-full border border-[var(--line-strong)] px-2.5 text-[12px] font-medium text-[var(--text)]">{effectName}</span>}
              <button type="button" onClick={() => jumpTo("#lighting-brightness [role='slider']")} className={chipBtn}>
                {effective ? brightnessLabel(effective.underglow.brightness) : "—"}
              </button>
              <button type="button" onClick={() => jumpTo("#side-light-bar")} className={chipBtn}>
                {sideLedName}
              </button>
              {draftQueuedOffline && (
                <span className="inline-flex h-6 items-center rounded-full border border-[var(--accent)]/40 px-2.5 text-[12px] font-medium text-[var(--accent)]">Will apply when connected</span>
              )}
            </div>
          </section>
        </div>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-5 pt-4">
          <div className="flex flex-col gap-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                role="tabpanel"
                initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <Screen />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toast />
    </MotionConfig>
  );
}
