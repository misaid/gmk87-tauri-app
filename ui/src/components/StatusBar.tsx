import { useEffect, useState } from "react";
import { useAppStore } from "@/store";

export function StatusBar() {
  const connected = useAppStore((s) => s.connected);
  const uploads = useAppStore((s) => s.uploads);
  const progress = useAppStore((s) => s.progress);
  const [label, setLabel] = useState("Disconnected");

  useEffect(() => {
    setLabel(connected ? "Connected" : "Disconnected");
  }, [connected]);

  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : null;

  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-xs text-white/60">
      <span
        className={
          connected ? "size-2 rounded-full bg-emerald-400" : "size-2 rounded-full bg-red-400"
        }
        aria-hidden
      />
      <span>{label}</span>
      {uploads > 0 && (
        <span className="ml-auto">Uploading {percent !== null ? `— ${percent}%` : "…"}</span>
      )}
    </div>
  );
}
