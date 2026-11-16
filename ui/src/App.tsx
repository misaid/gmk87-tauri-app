import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { MotionConfig, useReducedMotion } from "framer-motion";
import { CircleHelp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { isLinux } from "@/components/PermissionCard";
import { KeyboardPreview, caseMaxWidthCss } from "@/components/KeyboardPreview";
import { Rail } from "@/components/Rail";
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
  const connectedTransport = useAppStore((s) => s.connectedTransport);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const lastUploaded = useAppStore((s) => s.lastUploaded);
  const productId = useAppStore((s) => s.devices.find((d) => d.path === connectedPath)?.productId);
  const linkKind = connectedTransport === "wireless24g" ? "2.4 GHZ" : "WIRED";
  const reduceMotion = useReducedMotion();
  const [helpOpen, setHelpOpen] = useState(false);

  useLiveApply();

  // One pulse along the rail per successful write: lighting/clock writes bump lastSyncedAt, display writes replace lastUploaded.
  const [pulseKey, setPulseKey] = useState(0);
  const seenWrite = useRef({ synced: lastSyncedAt, uploaded: lastUploaded });
  useEffect(() => {
    const seen = seenWrite.current;
    if (seen.synced === lastSyncedAt && seen.uploaded === lastUploaded) return;
    const real = (lastSyncedAt !== null && lastSyncedAt !== seen.synced) || (lastUploaded !== null && lastUploaded !== seen.uploaded);
    seenWrite.current = { synced: lastSyncedAt, uploaded: lastUploaded };
    if (real) setPulseKey((k) => k + 1);
  }, [lastSyncedAt, lastUploaded]);

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
    ? { text: "OPENING…", dot: "bg-[var(--warn)] animate-pulse" }
    : applying
      ? { text: "WRITING…", dot: "bg-[var(--warn)] animate-pulse" }
      : connected
        ? { text: `LINK  ${linkKind}`, dot: "bg-[var(--success)]" }
        : { text: "NO LINK", dot: "bg-transparent border border-[var(--dim)]" };

  const wide = tab === "lighting";
  // The board is large where it is the subject: Lighting, and Device once there is a link to point at.
  const hero = tab === "lighting" || (tab === "device" && connected);
  const stageWidth = caseMaxWidthCss(hero ? "hero" : "compact");
  const jumpBtn = "readout -mx-1 rounded-[var(--r-ctl)] px-1 text-[11px] text-[var(--dim)] transition-colors hover:bg-[var(--bg-raise-2)] hover:text-[var(--text)]";
  const LockedHint = "nav-locked-hint";
  const title = NAV_ITEMS.find((n) => n.value === tab)?.label ?? "";

  const railReadout =
    tab === "device" ? (
      connected && connectedPath ? (
        <span>
          PORT <span className="text-[var(--text)]">{connectedPath}</span>
          {productId !== undefined && (
            <>
              {" · "}
              <span className="text-[var(--text)]">0x{productId.toString(16).padStart(4, "0")}</span>
            </>
          )}
        </span>
      ) : (
        <span className="text-[var(--text)]">NO LINK</span>
      )
    ) : tab === "lighting" ? (
      <SyncBar />
    ) : (
      <>
        <span className="inline-flex items-baseline gap-1.5">
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
      </>
    );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]">
          <div className="grid h-[52px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <span className="display text-[17px] text-[var(--text)]" style={{ fontStretch: "125%" }}>GMK87</span>
              <span className="readout truncate text-[10.5px] tracking-[0.14em] text-[var(--dim)] max-[999px]:hidden">CONFIGURATOR</span>
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList>
                {NAV_ITEMS.map((item, i) => {
                  const locked = !connected && item.value !== "device";
                  return (
                    <span key={item.value} title={locked ? "Connect a keyboard first" : undefined} className="inline-flex">
                      <TabsTrigger value={item.value} disabled={locked} aria-describedby={locked ? LockedHint : undefined}>
                        <span aria-hidden className="readout absolute left-[7px] top-[5px] text-[9.5px] leading-none opacity-55">{i + 1}</span>
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
              <span role="status" className="readout flex items-center gap-2 whitespace-nowrap text-[11px] tracking-[0.08em] text-[var(--text)]">
                <span key={connected ? "on" : "off"} aria-hidden className={cn("size-1.5 rounded-full", link.dot, connected && !connectingPath && !applying && "dot-pulse")} />
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
          <div className="relative px-6 pt-3">
            <div className="mx-auto w-full max-w-[1180px]">
              <ErrorBanner />
            </div>
          </div>
        )}

        <main className="relative flex-1 overflow-x-clip">
          <div aria-hidden className="stage-dots pointer-events-none absolute inset-x-0 top-0 h-[440px]" />
          <div
            className={cn(
              "relative mx-auto grid w-full gap-4 px-6 pb-6",
              tab === "device" && connected ? "pt-8" : "pt-6",
              tab === "device" && !connected && "!pb-3",
              wide ? "max-w-[1560px] min-[1120px]:grid-cols-[minmax(0,1fr)_400px] min-[1120px]:items-start min-[1120px]:gap-6" : "max-w-[1180px]",
            )}
          >
            <div className="flex min-w-0 flex-col gap-3">
              <section aria-label="Keyboard preview" className="relative z-10">
                <KeyboardPreview className="w-full" size={hero ? "hero" : "compact"} overlay={tab === "device" && connected ? <DevicePins /> : undefined} />
                <div aria-hidden className="stage-floor" />
              </section>

              <div className={cn("relative z-20 -mt-1", tab === "device" && connected && "mt-3")}>
                <Rail title={title} maxWidth={stageWidth} pulseKey={pulseKey}>
                  {railReadout}
                </Rail>
              </div>

              <div
                key={tab}
                role="tabpanel"
                aria-label={title}
                className="tab-in relative z-20 mx-auto flex w-full min-w-0 flex-col gap-3 px-2"
                style={{ maxWidth: `calc(${stageWidth} + 16px)` }}
              >
                {tab === "lighting" ? <LightingPanels /> : Screen ? <Screen /> : null}
                {error && lowBanner && (
                  <div className="mx-auto w-full max-w-[600px]">
                    <ErrorBanner />
                  </div>
                )}
              </div>
            </div>
            {wide && (
              <aside aria-label="Effects" className="min-w-0 min-[1120px]:sticky min-[1120px]:top-[68px] min-[1120px]:max-h-[calc(100vh-84px)] min-[1120px]:overflow-y-auto min-[1120px]:pr-1 min-[1120px]:pt-2">
                <EffectsPanel />
              </aside>
            )}
          </div>
        </main>
      </div>

      {tab === "device" && !connected && APP_VERSION && (
        <span className="readout pointer-events-none fixed bottom-3 left-4 text-[11px] text-[var(--dim)]">v{APP_VERSION}</span>
      )}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} version={APP_VERSION} />
      <Toast />
    </MotionConfig>
  );
}
