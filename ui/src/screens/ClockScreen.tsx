import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";

type DeviceTime = [number, number, number, number, number, number, number];

export function formatDeviceTime([
  year,
  month,
  day,
  _weekday,
  hour,
  minute,
  second,
]: DeviceTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export default function ClockScreen() {
  const state = useAppStore((s) => s.state);
  const syncClock = useAppStore((s) => s.syncClock);

  return (
    <div className="flex max-w-md flex-col gap-4 pt-3 text-sm">
      <div className="rounded-lg border border-white/10 p-4">
        <p className="text-white/50">The keyboard currently shows</p>
        <p className="mt-1 font-mono text-2xl">
          {state ? formatDeviceTime(state.time as DeviceTime) : "—"}
        </p>
      </div>
      <Button onClick={() => void syncClock()} disabled={!state}>
        Sync now
      </Button>
      <p className="text-xs text-white/40">
        The keyboard cannot be read back, so this shows the last time the app wrote, not what the
        clock currently holds.
      </p>
    </div>
  );
}
