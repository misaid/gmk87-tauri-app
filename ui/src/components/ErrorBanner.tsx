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
      className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2.5 text-[13px] text-[#fecaca]"
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
        <button className="underline underline-offset-2" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
