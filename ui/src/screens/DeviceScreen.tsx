import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store";

export default function DeviceScreen() {
  const devices = useAppStore((s) => s.devices);
  const connected = useAppStore((s) => s.connected);
  const state = useAppStore((s) => s.state);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const connectTo = useAppStore((s) => s.connectTo);
  const disconnectDevice = useAppStore((s) => s.disconnectDevice);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  return (
    <div className="flex max-w-xl flex-col gap-3 pt-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Devices</h2>
        <Button variant="outline" size="sm" onClick={() => void refreshDevices()}>
          Refresh
        </Button>
      </div>

      {devices.length === 0 && (
        <p className="text-sm text-white/50">
          No GMK87 found. Check the USB cable and the udev rule on the Device screen.
        </p>
      )}

      {devices.map((device) => (
        <Card key={device.path}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">{device.label}</CardTitle>
            {device.hasVia && <Badge variant="secondary">VIA detect</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-white/60">
            <span className="font-mono text-xs">{device.path}</span>
            {device.hasVia && <span>Remapping is available in a future version.</span>}
            <div className="flex gap-2">
              <Button size="sm" disabled={connected} onClick={() => void connectTo(device.path)}>
                Connect
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!connected}
                onClick={() => void disconnectDevice()}
              >
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {state && (
        <p className="text-xs text-white/40">
          {state.synced ? "Settings written and acknowledged." : "Connected; nothing written yet."}
        </p>
      )}
    </div>
  );
}
