import { PermissionCard } from "@/components/PermissionCard";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";

export function ErrorBanner() {
  const error = useAppStore((s) => s.error);
  const errorKind = useAppStore((s) => s.errorKind);
  const dismiss = useAppStore((s) => s.dismissError);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const setNotice = useAppStore((s) => s.setNotice);
  if (!error) return null;
  if (errorKind === "permission_denied") return <PermissionCard />;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <span className="min-w-0 flex-1">{error}</span>
      <span className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            dismiss();
            if (errorKind === "device_gone" || errorKind === "not_connected") {
              void refreshDevices().then(() => setNotice?.("Devices refreshed ✓"));
            }
          }}
        >
          Refresh devices
        </Button>
        <button className="underline" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
