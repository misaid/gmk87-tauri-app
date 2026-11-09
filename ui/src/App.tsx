import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { Image as ImageIcon, Lightbulb, Plug, User } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { BoardStatus } from "@/components/BoardStatus";
import { KeyboardPreview } from "@/components/KeyboardPreview";
import { useDeviceEvents } from "@/lib/useDeviceEvents";
import DeviceScreen from "@/screens/DeviceScreen";
import DisplayScreen from "@/screens/DisplayScreen";
import LightingScreen from "@/screens/LightingScreen";
import ProfilesScreen from "@/screens/ProfilesScreen";
import { GlossaryDialog, OnboardingWizard } from "@/components/Onboarding";
import { Toast } from "@/components/Toast";
import { WriteConfirm } from "@/components/WriteConfirm";
import { CommandPalette } from "@/components/CommandPalette";
import { selectEffectiveState, useAppStore } from "@/store";
import { UNDERGLOW_EFFECTS } from "@/lib/effects";

const NAV_ITEMS = [
  { value: "device", label: "Device", icon: Plug },
  { value: "display", label: "Display", icon: ImageIcon },
  { value: "lighting", label: "Lighting", icon: Lightbulb },
  { value: "profiles", label: "Profiles", icon: User },
] as const;

type Tab = (typeof NAV_ITEMS)[number]["value"];

const SCREENS: Record<Tab, React.ComponentType> = {
  device: DeviceScreen,
  display: DisplayScreen,
  lighting: LightingScreen,
  profiles: ProfilesScreen,
};

// Stable product accent — chrome does not follow underglow (preview carries the colour).
const ACCENT = "#8b5cf6";

export default function App() {
  useDeviceEvents();
  const loadStoredDisplay = useAppStore((s) => s.loadStoredDisplay);
  const tab = useAppStore((s) => s.activeTab);
  const setTab = useAppStore((s) => s.setActiveTab);
  const effective = useAppStore(selectEffectiveState);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const reduceMotion = useReducedMotion();
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const discardDraft = useAppStore((s) => s.discardDraft);
  const lastDiscardedDraft = useAppStore((s) => s.lastDiscardedDraft);
  const restoreDraft = useAppStore((s) => s.restoreDraft);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const undoLighting = useAppStore((s) => s.undoLighting);
  const undoDisplayUpload = useAppStore((s) => s.undoDisplayUpload);
  const togglePaused = useAppStore((s) => s.setAnimationsPaused);
  const paused = useAppStore((s) => s.animationsPaused);
  const connected = useAppStore((s) => s.connected);
  const connectingPath = useAppStore((s) => s.connectingPath ?? null);

  // Tab shortcuts: 1-3, ? = help, p = pause, Cmd/Ctrl+Z = undo, Cmd/Ctrl+K = palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
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
      // `p` pauses from anywhere except buttons (so a focused button keeps its own keys).
      if (e.key.toLowerCase() === "p") {
        if (target?.closest("button, select")) return;
        togglePaused(!paused); useAppStore.getState().setNotice(paused ? "Animations playing — press p to pause" : "Animations paused — press p to resume"); return;
      }
      if (inControl) return;
      const map: Record<string, Tab> = { "1": "device", "2": "display", "3": "lighting", "4": "profiles" };
      if (map[e.key]) setTab(map[e.key]);
      else if (e.key === "?") setGlossaryOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab, tab, undoLighting, undoDisplayUpload, togglePaused, paused]);

  useEffect(() => {
    void loadStoredDisplay();
  }, [loadStoredDisplay]);

  const Screen = SCREENS[tab];

  const rootStyle = {
    "--accent": ACCENT,
    "--accent-safe": ACCENT,
    "--focus": ACCENT,
  } as CSSProperties;

  const committed = useAppStore((s) => s.state);
  const entries = useAppStore((s) => s.entries);
  const slot = useAppStore((s) => s.slot);
  const lastUploaded = useAppStore((s) => s.lastUploaded);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const draft = useAppStore((s) => s.draft);
  const boardEffect = committed
    ? UNDERGLOW_EFFECTS.find((e) => e.value === committed.underglow.effect)?.name ?? "Off"
    : "—";
  const draftEffect = draft
    ? UNDERGLOW_EFFECTS.find((e) => e.value === draft.underglow.effect)?.name ?? "Off"
    : null;
  const since = lastSyncedAt ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lastSyncedAt)) : null;
  const draftChangeCount = draft && committed
    ? [
        draft.underglow.effect !== committed.underglow.effect,
        draft.underglow.brightness !== committed.underglow.brightness,
        draft.underglow.speed !== committed.underglow.speed,
        draft.underglow.orientation !== committed.underglow.orientation,
        draft.underglow.rainbow !== committed.underglow.rainbow,
        draft.underglow.color.join(",") !== committed.underglow.color.join(","),
        draft.led.mode !== committed.led.mode,
        draft.led.saturation !== committed.led.saturation,
        draft.led.rainbow !== committed.led.rainbow,
        draft.led.color !== committed.led.color,
        draft.winLock !== committed.winLock,
      ].filter(Boolean).length
    : 0;
  const displayStaged = entries[slot].source != null && (lastUploaded == null || lastUploaded[slot].name !== entries[slot].name);

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-full flex-col" style={rootStyle}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-white"><span className={connectingPath ? "size-2.5 animate-pulse rounded-full bg-amber-400" : connected ? "size-2.5 rounded-full bg-emerald-400" : "size-2.5 rounded-full bg-red-400"} aria-hidden />GMK87<span className="text-xs font-normal text-white/70">{connectingPath ? "Connecting…" : connected ? "Connected" : "Disconnected"}</span></span>
        <span className="ml-auto flex items-center gap-3 text-xs text-white/80">
          <button type="button" className="rounded-md border border-white/15 px-2 py-1 hover:bg-white/10" onClick={() => setPaletteOpen(true)}>
            ⌘K — commands
          </button>
          <button type="button" className="rounded-md border border-white/15 px-2 py-1 hover:bg-white/10" onClick={() => setGlossaryOpen(true)}>
            Help
          </button>
        </span>
      </header>
      <div className="px-4 pt-3">
        <ErrorBanner />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1">
        <TabsList className="h-auto w-[200px] shrink-0 flex-col items-stretch justify-start gap-1 rounded-none bg-transparent p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="relative justify-start rounded-md px-3 py-2 text-left data-[state=active]:bg-transparent"
            >
              {tab === item.value && (
                <motion.span
                  layoutId="nav-highlight"
                  className="absolute inset-0 rounded-md"
                  style={{ background: `${ACCENT}26`, boxShadow: `inset 0 0 0 1px ${ACCENT}66` }}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
                {item.value === "lighting" && draftDirty && (
                  <span role="status" className="ml-auto size-2 rounded-full bg-sky-400" title="Unsaved draft" />
                )}
              </span>
            </TabsTrigger>
            );
          })}
          <div className="mt-auto px-3 pt-6 text-xs leading-relaxed text-white/70">
            <p>⌘K commands · ? help · p pause · ⌘Z undo · 1–4 tabs</p>
          </div>
        </TabsList>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
          <div className="mx-auto w-full max-w-2xl">
            <div className="mb-3 rounded-lg border border-white/10 bg-neutral-950/70 px-3 py-2 text-xs leading-relaxed text-white/80 xl:hidden" role="status">
              <BoardStatus committed={committed} boardEffect={boardEffect} draft={draft} draftDirty={draftDirty} draftChangeCount={draftChangeCount} draftEffect={draftEffect} since={since} tab={tab} displayStaged={displayStaged} displayName={entries[slot].name || "image"} />
            </div>
            <div className="sticky top-0 z-10 mb-4 xl:hidden">
              <KeyboardPreview zoomed={tab === "display"} className="h-[180px] w-full" />
            </div>
            {lastDiscardedDraft && !draftDirty ? (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-xs text-white/80" role="status">
                <span className="flex-1">Draft discarded. It is saved here until you make a new edit.</span>
                <Button size="sm" onClick={restoreDraft}>Restore draft</Button>
              </div>
            ) : null}
            <AnimatePresence mode="wait">
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
        </div>

          <aside className="hidden w-[420px] shrink-0 border-l border-white/10 p-4 xl:block">
            <div className="sticky top-0 flex flex-col gap-3">
              <KeyboardPreview zoomed={tab === "display"} className="h-[300px] w-full" />
              <p className="text-xs text-white/80">
                Knob: drag up/down to change brightness{effective ? ` — now ${effective.underglow.brightness}/9` : ""}. Arrows work too.
              </p>
              <div className="rounded-lg border border-white/10 p-3 text-xs leading-relaxed text-white/80" role="status">
                <BoardStatus committed={committed} boardEffect={boardEffect} draft={draft} draftDirty={draftDirty} draftChangeCount={draftChangeCount} draftEffect={draftEffect} since={since} tab={tab} displayStaged={displayStaged} displayName={entries[slot].name || "image"} />
                {draftDirty && draft && committed ? (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => useAppStore.getState().setShowWriteConfirm(true)}>Write to board</Button>
                    <Button variant="outline" size="sm" onClick={() => discardDraft()}>Discard</Button>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
      </Tabs>

      <OnboardingWizard />
      <GlossaryDialog open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      <Toast />
      <WriteConfirm />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* Mobile: draft Write lives under the picture stack */}
      {draftDirty && (
        <div className="fixed bottom-4 left-4 right-4 z-40 flex gap-2 rounded-lg border border-white/10 bg-neutral-900/95 p-3 xl:hidden" role="status">
          <span className="flex-1 text-xs text-white/80">Draft · {draftChangeCount} — {draftEffect ?? ""} → board {boardEffect} {committed ? `${committed.underglow.brightness}/9` : ""}</span>
          <Button size="sm" onClick={() => useAppStore.getState().setShowWriteConfirm(true)}>Write to board</Button>
          <Button variant="outline" size="sm" onClick={() => discardDraft()}>Discard</Button>
        </div>
      )}
    </div>
    </MotionConfig>
  );
}
