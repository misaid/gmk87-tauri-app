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
          ? "fixed right-4 top-14 z-40 rounded-lg border border-red-400/40 bg-red-950/90 px-4 py-2 text-sm text-red-200 shadow-lg"
          : "fixed right-4 top-14 z-40 rounded-lg border border-emerald-400/40 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-200 shadow-lg"
      }
      role={isError ? "alert" : "status"}
      aria-live="polite"
    >
      <span>{notice}</span>
      <button className={`ml-3 underline ${isError ? "text-red-200/70" : "text-emerald-200/70"}`} onClick={() => setNotice(null)}>
        Dismiss
      </button>
    </div>
  );
}
