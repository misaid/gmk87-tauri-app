import { PermissionCard, isLinux } from "@/components/PermissionCard";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";

export function ErrorBanner() {
  const error = useAppStore((s) => s.error);
  const errorKind = useAppStore((s) => s.errorKind);
  const dismiss = useAppStore((s) => s.dismissError);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const setNotice = useAppStore((s) => s.setNotice);
  if (!error) return null;
  if (errorKind === "permission_denied" && isLinux()) return <PermissionCard />;
  return (
    <div
      role="alert"
      className="panel flex flex-wrap items-center justify-between gap-3 border-l-2 border-l-[var(--danger)] px-4 py-2.5 text-[13px] text-[var(--text)]"
    >
      <span className="min-w-0 flex-1">{error}</span>
      <span className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            dismiss();
            if (errorKind === "device_gone" || errorKind === "not_connected") {
              void refreshDevices().then(() => setNotice?.("Refreshed"));
            }
          }}
        >
          Refresh
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}
