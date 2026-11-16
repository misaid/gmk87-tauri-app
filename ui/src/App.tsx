import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { MotionConfig, useReducedMotion } from "framer-motion";
import { CircleHelp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { isLinux } from "@/components/PermissionCard";
import { KeyboardPreview, heroBoardWidth } from "@/components/KeyboardPreview";
import { cn } from "@/lib/utils";
import { openLightBar } from "@/components/LightBarPopover";
import { HelpDialog } from "@/components/HelpDialog";
import { Toast } from "@/components/Toast";
import { useDeviceEvents } from "@/lib/useDeviceEvents";
import { useLiveApply } from "@/lib/useLiveApply";
import { SyncBar } from "@/components/SyncBar";
import DeviceScreen, { DevicePins } from "@/screens/DeviceScreen";
import DisplayScreen from "@/screens/DisplayScreen";
import { EffectsPanel, LightingPanels } from "@/screens/LightingScreen";
import ProfilesScreen from "@/screens/ProfilesScreen";
import { LED_MODES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { selectEffectiveState, useAppStore } from "@/store";

const NAV_ITEMS = [
  { value: "device", label: "Device" },
  { value: "lighting", label: "Lighting" },
  { value: "display", label: "Display" },
  { value: "profiles", label: "Profiles" },
] as const;

type Tab = (typeof NAV_ITEMS)[number]["value"];

const SCREENS: Record<Exclude<Tab, "lighting">, ComponentType> = {
  device: DeviceScreen,
  display: DisplayScreen,
  profiles: ProfilesScreen,
};

/** Number keys follow the tab order in the nav. */
const TAB_KEYS: Record<string, Tab> = Object.fromEntries(NAV_ITEMS.map((item, i) => [String(i + 1), item.value]));
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

export default function App() {
  useDeviceEvents();
  const tab = useAppStore((s) => s.activeTab);
  const setTab = useAppStore((s) => s.setActiveTab);
  const effective = useAppStore(selectEffectiveState);
  const connected = useAppStore((s) => s.connected);
  const connectingPath = useAppStore((s) => s.connectingPath ?? null);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const commitDraft = useAppStore((s) => s.commitDraft);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const applying = useAppStore((s) => s.applying);
  const undoDisplayUpload = useAppStore((s) => s.undoDisplayUpload);
  const togglePaused = useAppStore((s) => s.setAnimationsPaused);
  const paused = useAppStore((s) => s.animationsPaused);
  const autoConnect = useAppStore((s) => s.autoConnect);
  const loadStoredDisplay = useAppStore((s) => s.loadStoredDisplay);
  const connectedPath = useAppStore((s) => s.connectedPath);
  const devices = useAppStore((s) => s.devices);
  const linkKind = devices.find((d) => d.path === connectedPath)?.transport === "wireless24g" ? "2.4 GHZ" : "WIRED";
  const reduceMotion = useReducedMotion();
  const [helpOpen, setHelpOpen] = useState(false);

  useLiveApply();

  // Pairing first: scan on launch and connect without a click. While there is no link the
  // scan repeats, so a board plugged in later is picked up too.
  useEffect(() => {
    void autoConnect();
  }, [autoConnect]);

  useEffect(() => {
    if (connected || connectingPath !== null) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void autoConnect();
    }, 1500);
    return () => window.clearInterval(id);
  }, [connected, connectingPath, autoConnect]);

  // Both display slots come back with the last image and crop that were written to them.
  useEffect(() => {
    void loadStoredDisplay();
  }, [loadStoredDisplay]);

  // Shortcuts: 1–4 tabs, ? help, p pause, Cmd/Ctrl+Z undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (connected && draftDirty) void commitDraft();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if ((e.target as HTMLElement | null)?.closest("input[type='text'], textarea")) return;
        e.preventDefault();
        if (tab === "display") void undoDisplayUpload();
        else if (e.shiftKey) void redo();
        else void undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key.toLowerCase() === "p") {
        if (target?.closest("button, select")) return;
        togglePaused(!paused);
        useAppStore.getState().setNotice(paused ? "Animations on" : "Animations paused");
        return;
      }
      // Digits and ? also work while a button has focus; sliders keep their own keys.
      if (target?.closest("[role='slider'], [role='dialog']")) return;
      const next = TAB_KEYS[e.key];
      if (next) {
        if (connected || next === "device") setTab(next);
      } else if (e.key === "?") setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab, tab, undo, redo, undoDisplayUpload, togglePaused, paused, connected, draftDirty, commitDraft]);

  const Screen = tab === "lighting" ? null : SCREENS[tab];
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
      window.setTimeout(go, 200);
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
  const errorKind = useAppStore((s) => s.errorKind);
  // The tall udev card sits under the Connect row on Device, so Connect stays above the fold.
  const lowBanner = tab === "device" && errorKind === "permission_denied" && isLinux();

  const link = connectingPath
    ? { text: "OPENING…", dot: "bg-[var(--warn)] animate-pulse", tone: "text-[var(--warn)]", glyph: "◐" }
    : applying
      ? { text: "WRITING…", dot: "bg-[var(--warn)] animate-pulse", tone: "text-[var(--warn)]", glyph: "●" }
      : connected
        ? { text: `LINK  ${linkKind}`, dot: "bg-[var(--success)]", tone: "text-[var(--success)]", glyph: "●" }
        : { text: "NO LINK", dot: "bg-transparent border border-[var(--dim)]", tone: "text-[var(--dim)]", glyph: "○" };

  const wide = tab === "lighting";
  const hero = tab === "device" || tab === "lighting";
  const compactReadout = "inline-flex items-baseline gap-1.5";
  const jumpBtn = "readout -mx-1 rounded-[var(--r-ctl)] px-1 text-[11px] text-[var(--dim)] transition-colors hover:bg-[var(--bg-raise-2)] hover:text-[var(--text)]";
  const LockedHint = "nav-locked-hint";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]">
          <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <span className="display text-[15px] text-[var(--text)]" style={{ fontStretch: "125%" }}>GMK87</span>
              <span className="readout truncate text-[10.5px] tracking-[0.14em] text-[var(--dim)]">CONFIGURATOR</span>
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList>
                {NAV_ITEMS.map((item, i) => {
                  const locked = !connected && item.value !== "device";
                  return (
                    <span key={item.value} title={locked ? "Connect a keyboard first" : undefined} className="inline-flex">
                      <TabsTrigger value={item.value} disabled={locked} aria-describedby={locked ? LockedHint : undefined}>
                        <span aria-hidden className="readout absolute left-1.5 top-[3px] text-[8.5px] leading-none opacity-55">{i + 1}</span>
                        {item.label}
                      </TabsTrigger>
                    </span>
                  );
                })}
              </TabsList>
            </Tabs>
            <span id={LockedHint} className="sr-only">
              {connected ? "" : "Locked until a keyboard is connected."}
            </span>
            <div className="flex items-center justify-end gap-2">
              <span role="status" className={cn("readout flex items-center gap-2 text-[11px] tracking-[0.08em]", link.tone)}>
                <span aria-hidden className={cn("size-1.5 rounded-full", link.dot)} />
                <span className="sr-only">{link.glyph}</span>
                {link.text}
              </span>
              <button
                type="button"
                aria-label="Help"
                onClick={() => setHelpOpen(true)}
                className="flex size-8 items-center justify-center rounded-[var(--r-ctl)] text-[var(--muted)] transition-colors duration-150 hover:bg-[var(--bg-raise-2)] hover:text-[var(--text)]"
              >
                <CircleHelp className="size-[17px]" aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {error && !lowBanner && (
          <div className="px-6 pt-3">
            <div className="mx-auto w-full max-w-[1180px]">
              <ErrorBanner />
            </div>
          </div>
        )}

        <main className="relative flex-1 overflow-x-clip">
          <div aria-hidden className="stage-dots pointer-events-none absolute inset-x-0 top-0 h-[440px]" />
          <div
            className={cn(
              "relative mx-auto grid w-full gap-4 px-6 pb-6 pt-8",
              wide ? "max-w-[1560px] min-[1120px]:grid-cols-[minmax(0,1fr)_400px] min-[1120px]:items-start min-[1120px]:gap-6" : "max-w-[1180px]",
            )}
          >
            <div className="flex min-w-0 flex-col gap-3">
              <section aria-label="Keyboard preview" className="relative z-10">
                <KeyboardPreview className="w-full" size={hero ? "hero" : "compact"} overlay={tab === "device" && connected ? <DevicePins /> : undefined} />
              </section>

              {!hero && (
                <div className="readout -mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-[var(--dim)]">
                  <span className={compactReadout}>
                    UNDERGLOW <span className="text-[var(--text)]">{effectName}</span>
                  </span>
                  <span aria-hidden>·</span>
                  <button type="button" onClick={() => jumpTo("#lighting-brightness [role='slider']")} className={jumpBtn}>
                    BRIGHT <span className="text-[var(--text)]">{effective ? `${effective.underglow.brightness}/9` : "—"}</span>
                  </button>
                  <span aria-hidden>·</span>
                  <button type="button" onClick={openLightBar} className={jumpBtn}>
                    BAR <span className="text-[var(--text)]">{sideLedName}</span>
                  </button>
                  {draftQueuedOffline && <span className="text-[var(--warn)]">QUEUED</span>}
                </div>
              )}

              <div key={tab} role="tabpanel" aria-label={NAV_ITEMS.find((n) => n.value === tab)?.label} className="tab-in flex min-w-0 flex-col gap-3">
                {tab === "lighting" ? (
                  <>
                    <div className="panel relative z-20 mx-auto w-full px-4 py-2.5" style={{ maxWidth: heroBoardWidth() }}>
                      <SyncBar />
                    </div>
                    <LightingPanels />
                  </>
                ) : (
                  Screen ? <Screen /> : null
                )}
                {error && lowBanner && (
                  <div className="mx-auto w-full max-w-[600px]">
                    <ErrorBanner />
                  </div>
                )}
              </div>
            </div>
            {wide && (
              <div aria-label="Lighting controls" className="min-w-0 min-[1120px]:sticky min-[1120px]:top-[64px] min-[1120px]:max-h-[calc(100vh-80px)] min-[1120px]:overflow-y-auto min-[1120px]:pr-1">
                <EffectsPanel />
              </div>
            )}
          </div>
        </main>
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} version={APP_VERSION} />
      <Toast />
    </MotionConfig>
  );
}
