import { useEffect } from "react";
import { useAppStore } from "@/store";

/** A key-shaped notice: bottom-centre, one LED for the outcome, mono text. Click or Esc puts it away. */
export function Toast() {
  const notice = useAppStore((s) => s.notice);
  const noticeKind = useAppStore((s) => s.noticeKind);
  const setNotice = useAppStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const dwell = noticeKind === "error" ? 10000 : 6000;
    const t = window.setTimeout(() => setNotice(null), dwell);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotice(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [notice, noticeKind, setNotice]);

  if (!notice) return null;

  const isError = noticeKind === "error";

  return (
    <div
      key={notice}
      role={isError ? "alert" : "status"}
      title="Click to dismiss"
      onClick={() => setNotice(null)}
      className="toast-in keycap-dark readout fixed bottom-6 left-1/2 z-50 flex max-w-[min(92vw,560px)] cursor-pointer items-center gap-2.5 px-4 py-2.5 text-[12px] font-medium"
      style={{ background: "linear-gradient(180deg, var(--key-top), var(--key-bot))" }}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: isError ? "var(--danger)" : "var(--success)", boxShadow: `0 0 8px ${isError ? "var(--danger)" : "var(--success)"}` }} />
      <span className="min-w-0">{notice}</span>
    </div>
  );
}
