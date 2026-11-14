import { useEffect, useState } from "react";
import { Clipboard, Loader2, RefreshCw, Usb } from "lucide-react";
import { KeyboardPreview } from "@/components/KeyboardPreview";
import { partAnchors } from "@/components/keyboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import * as ipc from "@/lib/ipc";
import { useAppStore } from "@/store";

type DeviceTime = [number, number, number, number, number, number, number];
function formatDeviceTime([
  year,
  month,
  day,
  _w,
  hour,
  minute,
  second,
]: DeviceTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** A numbered pin on the board: keyboard-reachable, jumps to its info card. */
function Pin({ n, label, x, y, tx, ty, hot, setHot, children }: { n: number; label: string; x: number; y: number; tx: number; ty: number; hot: number | null; setHot: (n: number | null) => void; children?: React.ReactNode }) {
  const on = hot === n;
  return (
    <>
    <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line x1={x} y1={y} x2={tx} y2={ty} stroke={on ? "#fff" : "rgba(255,255,255,0.6)"} strokeWidth={on ? 1.6 : 1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
    </svg>
    <span aria-hidden className={`pointer-events-none absolute z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#0b0d12] ${on ? "scale-150" : ""}`} style={{ left: `${tx}%`, top: `${ty}%` }} />
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
      className={`absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-bold shadow-[0_2px_10px_rgba(0,0,0,0.6)] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${on ? "scale-125 border-white bg-white text-[#0b0d12]" : "border-white/70 bg-[#0b0d12]/90 text-white"}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {children ?? n}
      <span aria-hidden className={`pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/80 px-2 py-0.5 text-[10.5px] font-medium text-white transition-opacity ${on ? "opacity-100" : "opacity-0"}`}>
        {label}
      </span>
    </button>
    </>
  );
}

function Callout({ n, title, icon, hot, setHot, className = "", children }: { n: number; title: string; icon?: React.ReactNode; hot: number | null; setHot: (n: number | null) => void; className?: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={`callout-${n}`}
      onMouseEnter={() => setHot(n)}
      onMouseLeave={() => setHot(null)}
      className={`rounded-[18px] border bg-[var(--panel)] p-4 transition-colors ${hot === n ? "border-white/50" : "border-[var(--line)]"} ${className}`}
    >
      <h2 id={`callout-${n}`} tabIndex={-1} className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold tracking-[0.01em] text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-[#0b0d12]">{n}</span>
        {title}
        {icon}
      </h2>
      {children}
    </section>
  );
}

export default function DeviceScreen() {
  const devices = useAppStore((s) => s.devices);
  const connected = useAppStore((s) => s.connected);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const connectingPath = useAppStore((s) => s.connectingPath);
  const state = useAppStore((s) => s.state);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const connectTo = useAppStore((s) => s.connectTo);
  const disconnectDevice = useAppStore((s) => s.disconnectDevice);
  const syncClock = useAppStore((s) => s.syncClock);
  const setNotice = useAppStore((s) => s.setNotice);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const rereadState = useAppStore((st) => st.rereadState);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const anchors = partAnchors();

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!confirmDisconnect) return;
    const t = window.setTimeout(() => setConfirmDisconnect(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDisconnect]);

  const pins = (
    <>
      <Pin n={1} label="USB connection" x={50} y={-9} tx={50} ty={0} hot={hot} setHot={setHot} />
      <Pin n={2} label="Screen and board clock" x={anchors.screen.x - 2} y={-9} tx={anchors.screen.x} ty={anchors.screen.y} hot={hot} setHot={setHot} />
      <Pin n={3} label="Windows key lock" x={anchors.win.x} y={99} tx={anchors.win.x} ty={anchors.win.y + 4} hot={hot} setHot={setHot} />
      <Pin n={4} label="Knob and brightness" x={anchors.knob.x + 3} y={-9} tx={anchors.knob.x} ty={anchors.knob.y} hot={hot} setHot={setHot} />
    </>
  );

  const brightness = state?.underglow.brightness;

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="mx-auto w-full max-w-[1000px] pb-6 pt-8">
        <KeyboardPreview className="w-full overflow-visible" hero overlay={pins} />
      </div>

      <div className="grid gap-4 lg:grid-cols-6">
        <Callout n={1} title="Connection" icon={<Usb className="size-3.5 text-[var(--muted)]" aria-hidden />} hot={hot} setHot={setHot} className="lg:col-span-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${connected ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.07] text-[var(--muted)]"}`}>
              <span aria-hidden className={`size-1.5 rounded-full ${connected ? "bg-emerald-300" : "bg-[var(--dim)]"}`} />
              {connected ? "Connected" : "Not connected"}
            </span>
            <span className="flex-1" />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void refreshDevices()}>
              <RefreshCw className="size-3.5" aria-hidden />
              Refresh
            </Button>
            {state && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void rereadState()}>
                <RefreshCw className="size-3.5" aria-hidden />
                Test connection
              </Button>
            )}
            {state && (
              <Button
                variant={confirmDisconnect ? "destructive" : "secondary"}
                size="sm"
                className="h-8 text-xs"
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
          </div>

          {devices.length === 0 && (
            <p className="text-[var(--muted)]">No keyboard found. Plug it in, then Refresh.</p>
          )}

          <div className="flex flex-col gap-2">
            {devices.map((device) => {
              const isConnecting = connectingPath === device.path;
              const transportLabel = device.transport === "wireless24g" ? "2.4 GHz dongle" : "Wired USB";
              return (
                <div key={device.path} className="flex items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--panel-2)] p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-[var(--text)]">{device.label}</span>
                      {device.hasVia && <Badge variant="secondary">VIA</Badge>}
                    </div>
                    <span className="text-[11px] text-[var(--muted)]">{transportLabel}</span>
                    <p className="mt-1 font-mono text-[11px] text-[var(--dim)]">
                      Product 0x{device.productId.toString(16).padStart(4, "0")} · {device.path}
                    </p>
                  </div>
                  {!connected && (
                    <Button size={devices.length === 1 ? "lg" : "sm"} className={devices.length === 1 ? "h-11 min-w-32 text-[15px]" : undefined} disabled={connectingPath !== null} aria-busy={isConnecting || undefined} onClick={() => void connectTo(device.path)}>
                      {isConnecting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                          Connecting…
                        </>
                      ) : (
                        "Connect"
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-[var(--muted)]"
              onClick={async () => {
                const text = await ipc.copyDiagnostics();
                await navigator.clipboard.writeText(text);
                setNotice?.("Diagnostics copied ✓");
              }}
            >
              <Clipboard className="size-3.5" aria-hidden />
              Copy diagnostics
            </Button>
          </div>
        </Callout>

        <Callout n={2} title="Screen · board clock" hot={hot} setHot={setHot} className="lg:col-span-2">
          <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-[var(--muted)]">Last written</dt>
            <dd className="text-[15px] tabular-nums text-[var(--text)]">{state ? formatDeviceTime(state.time as DeviceTime) : "—"}</dd>
            <dt className="text-[var(--muted)]">Timezone</dt>
            <dd className="text-[var(--text)]">{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
            <dt className="text-[var(--muted)]">Last synced</dt>
            <dd className="text-[var(--text)]">{lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "Not yet this session"}</dd>
          </dl>
          <Button className="mt-3" size="sm" onClick={() => void syncClock()} disabled={!state}>
            Sync now
          </Button>
        </Callout>

        <Callout n={3} title="Windows key" hot={hot} setHot={setHot} className="lg:col-span-3">
          <label className="flex items-center gap-2.5 text-[var(--text)]">
            <Switch checked={state?.winLock ?? false} disabled={!state} onCheckedChange={(checked) => setLightingDraft?.({ winLock: checked })} />
            Windows key lock
          </label>
        </Callout>

        <Callout n={4} title="Knob · brightness" hot={hot} setHot={setHot} className="lg:col-span-3">
          <p className="text-[var(--text)]">
            Brightness <span className="font-semibold">{brightness !== undefined ? `${brightness}/9` : "—"}</span>
          </p>
        </Callout>
      </div>
    </div>
  );
}
