import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Clipboard, Loader2 } from "lucide-react";
import { partAnchors, displayPlateLayout, caseLayout } from "@/components/keyboard";
import { isLinux } from "@/components/PermissionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PanelHead } from "@/components/PanelHead";
import * as ipc from "@/lib/ipc";
import { useAppStore } from "@/store";

type DeviceTime = [number, number, number, number, number, number, number];
function formatDeviceTime([, , , , hour, minute, second]: DeviceTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
function formatDeviceDate([year, month, day]: DeviceTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Which pin or panel is highlighted: hovering one lights its partner on the other side of the stage. */
let hotPart: number | null = null;
const hotListeners = new Set<() => void>();
function setHot(n: number | null) {
  if (hotPart === n) return;
  hotPart = n;
  for (const fn of [...hotListeners]) fn();
}
function useHot(): number | null {
  return useSyncExternalStore(
    (fn) => {
      hotListeners.add(fn);
      return () => {
        hotListeners.delete(fn);
      };
    },
    () => hotPart,
  );
}

/** A numbered pin on the board: a leader line to the part and a mono tag that jumps to its panel. */
function Pin({ n, label, tag, tx, ty }: { n: number; label: string; tag: { x: number; y: number }; tx: number; ty: number }) {
  const hot = useHot();
  const on = hot === n;
  const px = tag.x;
  const py = tag.y;
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1={px} y1={py} x2={tx} y2={ty} stroke={on ? "#ffffff" : "rgba(255,255,255,0.5)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        aria-hidden
        className={`pointer-events-none absolute z-10 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.55)] transition-transform duration-150 ${on ? "scale-150" : ""}`}
        style={{ left: `${tx}%`, top: `${ty}%` }}
      />
      <button
        type="button"
        aria-label={`${n}. ${label}`}
        aria-controls={`callout-${n}`}
        onMouseEnter={() => setHot(n)}
        onMouseLeave={() => setHot(null)}
        onFocus={() => setHot(n)}
        onBlur={() => setHot(null)}
        onClick={() => {
          const el = document.getElementById(`callout-${n}`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          el?.focus({ preventScroll: true });
        }}
        className={`readout absolute z-20 flex h-[18px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[3px] border text-[10.5px] transition-colors duration-150 ${on ? "border-white bg-white text-[var(--cap-ink)]" : "border-[var(--line-strong)] bg-[var(--bg)] text-[var(--text)]"}`}
        style={{ left: `${px}%`, top: `${py}%` }}
      >
        {String(n).padStart(2, "0")}
        <span
          aria-hidden
          className={`silk pointer-events-none absolute left-1/2 whitespace-nowrap rounded-[3px] bg-[var(--bg)] px-1.5 py-0.5 text-[9.5px] transition-opacity duration-150 ${py < 50 ? "bottom-full mb-1.5" : "top-full mt-1.5"} -translate-x-1/2 ${on ? "opacity-100" : "opacity-0"}`}
        >
          {label}
        </span>
      </button>
    </>
  );
}

/** The three leader pins drawn over the board on the Device tab (App passes them to the persistent preview). */
export function DevicePins() {
  const anchors = partAnchors();
  const [cw, ch] = caseLayout().size;
  // Pin 2 lands on the top edge of the black module panel, left of the digits, so its leader never crosses the clock.
  const module = displayPlateLayout();
  const screenX = ((module.position[0] - module.size[0] / 2 + module.size[0] * 0.22 + cw / 2) / cw) * 100;
  const screenTop = ((module.position[1] - module.size[1] / 2 + ch / 2) / ch) * 100;
  return (
    <>
      <Pin n={1} label="USB connection" tag={{ x: 50, y: -8 }} tx={50} ty={0} />
      <Pin n={2} label="Screen and board clock" tag={{ x: screenX, y: -8 }} tx={screenX} ty={screenTop} />
      <Pin n={3} label="Windows key lock" tag={{ x: anchors.win.x, y: 103.5 }} tx={anchors.win.x} ty={anchors.win.y + 4} />
    </>
  );
}

function Callout({ n, title, className = "", index = 0, stagger = false, children }: { n: number; title: string; className?: string; index?: number; stagger?: boolean; children: ReactNode }) {
  const hot = useHot();
  return (
    <section
      aria-labelledby={`callout-${n}`}
      onMouseEnter={() => setHot(n)}
      onMouseLeave={() => setHot(null)}
      style={{ "--i": index } as CSSProperties}
      className={`panel p-4 transition-colors duration-150 ${stagger ? "stagger-in" : ""} ${hot === n ? "border-[var(--line-strong)] border-t-[var(--text)]" : ""} ${className}`}
    >
      <PanelHead n={n} title={title} id={`callout-${n}`} />
      {children}
    </section>
  );
}

async function copyDiagnostics(notify: ((m: string, k?: "success" | "error") => void) | undefined) {
  try {
    const text = await ipc.copyDiagnostics();
    await navigator.clipboard.writeText(text);
    notify?.("Diagnostics copied ✓");
  } catch {
    notify?.("Could not copy diagnostics", "error");
  }
}

/** Cause-specific next step for a failed connect. */
function nextStep(kind: string | null | undefined, transport: string): string {
  if (kind === "permission_denied") {
    return isLinux() ? "Run the udev commands below, then unplug and replug the board." : "Close any other app that is using the keyboard, then try again.";
  }
  if (transport === "wireless24g") return "Switch the keyboard to 2.4 GHz, or connect the cable and use the wired row.";
  return "Check the cable and try again. Copy diagnostics if it keeps failing.";
}

function ScanLine() {
  return (
    <div aria-hidden className="relative h-px w-[360px] max-w-full overflow-hidden bg-[var(--line)]">
      <span className="scan-sweep absolute inset-y-0 left-0 w-1/3 bg-[var(--text)]" />
    </div>
  );
}

function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** One line of the scan table: label, dot leader, value. */
function ScanRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-2 border-t border-[var(--line)] py-1 first:border-t-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span aria-hidden className="mb-[3px] min-w-3 flex-1 self-end border-b border-dotted border-[var(--line-strong)]" />
      <span>{children}</span>
    </li>
  );
}

/** What the scan has seen so far: cable, dongle, and when it last looked. */
function ScanTable({ devices, lastScanAt }: { devices: ipc.DeviceInfo[]; lastScanAt: number | null }) {
  const wired = devices.some((d) => d.transport === "wired");
  const dongle = devices.some((d) => d.transport === "wireless24g");
  return (
    <ul aria-label="Scan results" className="readout w-[360px] max-w-full text-[12px] text-[var(--text)]">
      <ScanRow label="USB CABLE">{wired ? <span className="text-[var(--success)]">FOUND</span> : <span className="text-[var(--dim)]">SCANNING</span>}</ScanRow>
      <ScanRow label="2.4 GHZ DONGLE">{dongle ? <span className="text-[var(--success)]">FOUND · CLICK TO CONNECT</span> : <span className="text-[var(--dim)]">NOT FOUND</span>}</ScanRow>
      <ScanRow label="LAST SCAN">{lastScanAt ? clock(lastScanAt) : "—"}</ScanRow>
    </ul>
  );
}

/** Set once the connected panels have had their entrance; cleared when the link drops. */
let staggerDone = false;


export default function DeviceScreen() {
  const devices = useAppStore((s) => s.devices);
  const connected = useAppStore((s) => s.connected);
  const connectedPath = useAppStore((s) => s.connectedPath);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const connectingPath = useAppStore((s) => s.connectingPath);
  const connectErrorPath = useAppStore((s) => s.connectErrorPath);
  const error = useAppStore((s) => s.error);
  const errorKind = useAppStore((s) => s.errorKind);
  const state = useAppStore((s) => s.state);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const connectTo = useAppStore((s) => s.connectTo);
  const disconnectDevice = useAppStore((s) => s.disconnectDevice);
  const syncClock = useAppStore((s) => s.syncClock);
  const setNotice = useAppStore((s) => s.setNotice);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const rereadState = useAppStore((st) => st.rereadState);
  const lastScanAt = useAppStore((s) => s.lastScanAt);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // The three panels stagger in when the link comes up, not on every return to this tab.
  const [stagger] = useState(() => !staggerDone);
  useEffect(() => {
    staggerDone = connected;
  }, [connected]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!confirmDisconnect) return;
    const t = window.setTimeout(() => setConfirmDisconnect(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDisconnect]);

  const diagnostics = (
    <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => void copyDiagnostics(setNotice)}>
      <Clipboard className="size-3.5" aria-hidden />
      Copy diagnostics
    </Button>
  );

  if (!connected) {
    if (devices.length === 0) {
      return (
        <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-2.5 pb-0 pt-1 text-center">
          <h2 className="display text-[34px]">Plug in your GMK87</h2>
          <ScanLine />
          <ScanTable devices={devices} lastScanAt={lastScanAt} />
          <p className="text-[12.5px] text-[var(--muted)]">Cable in, mode switch on the back set to USB.</p>
          <div>{diagnostics}</div>
        </div>
      );
    }
    const wiredFirst = [...devices].sort((a, b) => Number(b.transport === "wired") - Number(a.transport === "wired"));
    return (
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3 pb-6 pt-3">
        <PanelHead n={1} title="Link" id="callout-1" />
        <div className="flex flex-col gap-2.5">
          {wiredFirst.map((device) => {
            const isConnecting = connectingPath === device.path;
            const failed = connectErrorPath === device.path && !isConnecting && error;
            const transportLabel = device.transport === "wireless24g" ? "2.4 GHz dongle" : "Wired USB";
            const single = devices.length === 1;
            return (
              <div key={device.path} className={`panel flex flex-col gap-2 p-3.5 ${failed ? "border-l-2 border-l-[var(--danger)]" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-[var(--text)]">{device.label}</span>
                      {device.hasVia && <Badge variant="secondary">VIA</Badge>}
                      {!single && device.transport === "wired" && <span className="readout text-[10.5px] tracking-[0.12em] text-[var(--success)]">RECOMMENDED</span>}
                    </div>
                    <p className="readout mt-0.5 text-[11px] text-[var(--dim)]">
                      {isConnecting ? (
                        <>Opening {device.path}…</>
                      ) : (
                        <>
                          Product 0x{device.productId.toString(16).padStart(4, "0")} · {device.path}
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
                      {transportLabel}
                      {device.transport === "wireless24g" && " · The keyboard must be switched to 2.4 GHz"}
                    </p>
                  </div>
                  <Button
                    size={single ? "lg" : "sm"}
                    className={single ? "h-11 min-w-32 text-[15px]" : undefined}
                    disabled={connectingPath !== null}
                    aria-busy={isConnecting || undefined}
                    onClick={() => void connectTo(device.path)}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Connecting…
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </div>
                {failed && (
                  <div className="border-t border-[var(--line)] pt-2 text-[12px]">
                    <p className="text-[var(--danger)]">{error}</p>
                    <p className="mt-0.5 text-[var(--muted)]">{nextStep(errorKind, device.transport)}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-col items-center gap-3.5">
          <ScanTable devices={devices} lastScanAt={lastScanAt} />
          {diagnostics}
        </div>
      </div>
    );
  }

  const active = devices.find((d) => d.path === connectedPath) ?? devices[0];
  const transportLabel = active?.transport === "wireless24g" ? "2.4 GHz dongle" : "Wired USB";

  return (
    <div className="grid grid-cols-2 gap-3 pb-4 min-[1100px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <Callout n={1} title="Link" index={0} stagger={stagger} className="col-span-2 min-[1100px]:col-span-1">
        <div className="flex items-center gap-3 rounded-[var(--r-ctl)] bg-[var(--bg-sunk)] p-3">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--success)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-[var(--text)]">{active?.label ?? "GMK87"}</span>
              {active?.hasVia && <Badge variant="secondary">VIA</Badge>}
            </div>
            <p className="readout mt-0.5 text-[11px] text-[var(--dim)]">
              {transportLabel}
              {active && (
                <>
                  {" · "}Product 0x{active.productId.toString(16).padStart(4, "0")} · {active.path}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {state && (
            <Button variant="outline" size="sm" onClick={() => void rereadState()}>
              Test connection
            </Button>
          )}
          {state && (
            <Button
              variant={confirmDisconnect ? "destructive" : "secondary"}
              size="sm"
              onClick={() => {
                if (!confirmDisconnect) {
                  setConfirmDisconnect(true);
                  return;
                }
                setConfirmDisconnect(false);
                void disconnectDevice();
              }}
            >
              {confirmDisconnect ? "Confirm disconnect" : "Disconnect"}
            </Button>
          )}
          <span className="flex-1" />
          {diagnostics}
        </div>
      </Callout>

      <Callout n={2} title="Clock" index={1} stagger={stagger}>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
          <dt className="text-[12px] text-[var(--muted)]">Last written</dt>
          <dd className="readout text-[22px] leading-none text-[var(--text)]" title={state ? formatDeviceDate(state.time as DeviceTime) : undefined}>
            {state ? formatDeviceTime(state.time as DeviceTime) : "—"}
          </dd>
          <dt className="text-[12px] text-[var(--muted)]">Timezone</dt>
          <dd className="readout text-[var(--text)]">{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
          <dt className="text-[12px] text-[var(--muted)]">Last synced</dt>
          <dd className="readout text-[var(--text)]">{lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "Not yet this session"}</dd>
        </dl>
        <Button className="mt-3.5" size="sm" onClick={() => void syncClock()} disabled={!state}>
          Sync clock
        </Button>
      </Callout>

      <Callout n={3} title="Windows key" index={2} stagger={stagger}>
        <label className="flex items-center gap-3 text-[var(--text)]">
          <Switch checked={state?.winLock ?? false} disabled={!state} onCheckedChange={(checked) => setLightingDraft?.({ winLock: checked })} />
          <span>
            <span className="block font-medium">Windows key lock</span>
            <span className="block text-[12px] text-[var(--muted)]">Disables the Windows key while on.</span>
          </span>
        </label>
      </Callout>
    </div>
  );
}
