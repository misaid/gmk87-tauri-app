import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as ipc from "@/lib/ipc";
import { useAppStore } from "@/store";

type DeviceTime = [number, number, number, number, number, number, number];
function formatDeviceTime([year, month, day, _w, hour, minute, second]: DeviceTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export default function DeviceScreen() {
  const devices = useAppStore((s) => s.devices);
  const connected = useAppStore((s) => s.connected);
  const connectingPath = useAppStore((s) => s.connectingPath);
  const state = useAppStore((s) => s.state);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const connectTo = useAppStore((s) => s.connectTo);
  const disconnectDevice = useAppStore((s) => s.disconnectDevice);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const syncClock = useAppStore((s) => s.syncClock);
  const setNotice = useAppStore((s) => s.setNotice);
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
    <div className="flex max-w-xl flex-col gap-6 pt-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[var(--text-h1)] font-semibold text-white">Devices</h1>
          <p className="mt-1 text-sm text-white/80">Connect your GMK87 over USB.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshDevices()}>
          Refresh
        </Button>
      </div>

      {devices.length === 0 && (
        <p className="text-sm text-white/80">
          No GMK87 found. Plug in the USB cable (wired keyboard or 2.4 GHz dongle) and press Refresh. If it still doesn't appear, a permission prompt will explain the udev fix.
        </p>
      )}

      {devices.map((device) => {
        const isConnecting = connectingPath === device.path;
        const transportLabel = device.transport === "wireless24g" ? "2.4 GHz dongle" : "Wired USB";
        return (
        <Card key={device.path}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">{device.label}</CardTitle>
            <div className="flex items-center gap-2">
              {device.hasVia && <Badge variant="secondary">VIA</Badge>}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-white/80">
            <span className="text-xs text-white/70">{transportLabel}</span>
            <details className="rounded-md border border-white/10 p-2 text-xs text-white/70">
              <summary className="cursor-pointer font-medium text-white/80">Technical details</summary>
              <p className="mt-1">Product 0x{device.productId.toString(16).padStart(4, "0")}</p>
              <p className="font-mono">{device.path}</p>
            </details>
            {device.hasVia && <span className="text-xs text-white/70">VIA reachable — remapping arrives in a future version.</span>}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={connected || connectingPath !== null}
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
          </CardContent>
        </Card>
        );
      })}

      {state && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-white/70">
            {state.synced ? "Settings written and acknowledged." : "Connected; nothing written yet."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={confirmDisconnect ? "destructive" : "outline"}
              onClick={() => {
                if (!confirmDisconnect) {
                  setConfirmDisconnect(true);
                  return;
                }
                setConfirmDisconnect(false);
                void disconnectDevice();
              }}
            >
              {confirmDisconnect ? "Click again to disconnect — draft kept" : "Disconnect"}
            </Button>
            <p className="flex flex-wrap items-center gap-2 text-sm text-white/80">
              <span>Win Lock: <span className="font-medium text-white">{state.winLock ? "On" : "Off"}</span></span>
              <Button variant="outline" size="sm" onClick={() => setActiveTab("lighting")}>Edit in Lighting</Button>
              <span className="text-xs text-white/70">— joins the lighting draft</span>
            </p>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-white/10 p-4" aria-labelledby="device-clock">
        <h2 id="device-clock" className="text-sm font-semibold text-white">Board clock</h2>
        <p className="mt-1 text-xs text-white/70">Set the board clock to your system time ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Shows last written time — the board cannot be read back.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="font-mono text-xl text-white">{state ? formatDeviceTime(state.time as DeviceTime) : "—"}</p>
          <Button size="sm" onClick={() => void syncClock()} disabled={!state}>Sync now</Button>
        </div>
      </section>

      <details className="rounded-lg border border-white/10 p-4 text-sm text-white/70">
        <summary className="cursor-pointer font-medium text-white/80">How this works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>The board cannot be read back — the app keeps the last settings it wrote.</li>
          <li>The display keeps two image slots (240×135, 36 frames total). Both are resent on every upload.</li>
          <li>Underglow and side LEDs are hardware effects — the picture in the app simulates them, it does not drive them.</li>
        </ul>
      </details>

      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={async () => {
          const text = await ipc.copyDiagnostics();
          await navigator.clipboard.writeText(text);
          setNotice?.("Diagnostics copied ✓");
        }}
      >
        Copy diagnostics
      </Button>
    </div>
  );
}
