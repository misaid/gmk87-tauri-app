import { useEffect } from "react";
import { useAppStore } from "@/store";

export function Toast() {
  const notice = useAppStore((s) => s.notice);
  const noticeKind = useAppStore((s) => s.noticeKind);
  const setNotice = useAppStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const dwell = noticeKind === "error" ? 10000 : 6000;
    const t = window.setTimeout(() => setNotice(null), dwell);
    return () => window.clearTimeout(t);
  }, [notice, noticeKind, setNotice]);

  if (!notice) return null;

  const isError = noticeKind === "error";

  return (
    <div
      className={
        isError
          ? "fixed right-4 top-16 z-50 flex items-center gap-3 rounded-full border border-[var(--danger)]/40 bg-[#180d0d]/95 px-4 py-2 text-xs text-[#fecaca] shadow-lg backdrop-blur"
          : "fixed right-4 top-16 z-50 flex items-center gap-3 rounded-full border border-[var(--success)]/30 bg-[#0c1512]/95 px-4 py-2 text-xs text-[#bbf7d0] shadow-lg backdrop-blur"
      }
      role={isError ? "alert" : "status"}
      aria-live="polite"
    >
      <span>{notice}</span>
      <button
        className={`underline underline-offset-2 ${isError ? "text-[#fecaca]/70" : "text-[#bbf7d0]/70"}`}
        onClick={() => setNotice(null)}
      >
        Dismiss
      </button>
    </div>
  );
}
