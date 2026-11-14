import { useEffect, useState } from "react";
import { Clipboard, Loader2, RefreshCw } from "lucide-react";
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
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!confirmDisconnect) return;
    const t = window.setTimeout(() => setConfirmDisconnect(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDisconnect]);

  return (
    <div className="grid gap-4 text-[13px] lg:grid-cols-2 lg:items-stretch">
      <section
        className="h-full rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4"
        aria-labelledby="device-heading"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            id="device-heading"
            className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]"
          >
            Connection
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void refreshDevices()}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Refresh
            </Button>
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
              {confirmDisconnect ? "Click again to disconnect" : "Disconnect"}
            </Button>
            )}
          </div>
        </div>

        {devices.length === 0 && (
          <p className="text-[var(--muted)]">
            No GMK87 found. Plug in the USB cable (wired keyboard or 2.4 GHz
            dongle) and press Refresh. On Linux, a permission prompt will appear
            if udev access is missing.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {devices.map((device) => {
            const isConnecting = connectingPath === device.path;
            const transportLabel =
              device.transport === "wireless24g"
                ? "2.4 GHz dongle"
                : "Wired USB";
            return (
              <div
                key={device.path}
                className="flex items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--panel-2)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-[var(--text)]">
                      {device.label}
                    </span>
                    {device.hasVia && <Badge variant="secondary">VIA</Badge>}
                  </div>
                  <span className="text-[11px] text-[var(--muted)]">
                    {transportLabel}
                  </span>
                  {device.hasVia && (
                    <span className="block text-[11px] text-[var(--muted)]">
                      VIA reachable — remapping arrives in a future version.
                    </span>
                  )}
                  <details className="mt-1 text-[11px] text-[var(--muted)]">
                    <summary className="cursor-pointer">
                      Technical details
                    </summary>
                    <p className="mt-1">
                      Product 0x{device.productId.toString(16).padStart(4, "0")}
                    </p>
                    <p className="font-mono">{device.path}</p>
                  </details>
                </div>
                {connected ? (
                  devices.length === 1 && (
                    <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      Connected
                    </span>
                  )
                ) : (
                  <Button
                    size="sm"
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
                )}
              </div>
            );
          })}
        </div>

        {state && (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            {state.synced ? "Settings written and acknowledged." : "Nothing written yet."}
          </p>
        )}
      </section>

      <div className="flex flex-col gap-4">

        <section
          className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4"
          aria-labelledby="device-clock"
        >
          <h2
            id="device-clock"
            className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]"
          >
            Board clock
          </h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Set the board clock to your system time. Shows last written time
            — the board cannot be read back.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-lg tabular-nums text-[var(--text)]">
              {state ? formatDeviceTime(state.time as DeviceTime) : "—"}
            </span>
            <Button onClick={() => void syncClock()} disabled={!state}>
              Sync now
            </Button>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <dt className="text-[var(--muted)]">Timezone</dt>
            <dd className="text-[var(--text)]">{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
            <dt className="text-[var(--muted)]">Last synced</dt>
            <dd className="text-[var(--text)]">{lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "Not yet this session"}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4">
          <h2 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">Advanced</h2>
          <label className="flex items-center gap-2.5 text-[var(--muted)]">
            <Switch
              checked={state?.winLock ?? false}
              disabled={!state}
              onCheckedChange={(checked) =>
                setLightingDraft?.({ winLock: checked })
              }
            />
            Windows key lock
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-self-start self-start text-xs"
            onClick={async () => {
              const text = await ipc.copyDiagnostics();
              await navigator.clipboard.writeText(text);
              setNotice?.("Diagnostics copied ✓");
            }}
          >
            <Clipboard className="size-3.5" aria-hidden />
            Copy diagnostics
          </Button>
        </section>
      </div>
    </div>
  );
}
