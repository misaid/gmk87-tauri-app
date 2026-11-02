import { useAppStore } from "@/store";

export function ErrorBanner() {
  const error = useAppStore((s) => s.error);
  const dismiss = useAppStore((s) => s.dismissError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <span>{error}</span>
      <button className="underline" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
