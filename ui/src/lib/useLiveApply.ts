import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "@/store";

/** Quiet time after the last staged edit before it is written to the board. */
export const LIVE_APPLY_DEBOUNCE_MS = 200;
/** A long slider drag still flushes at least this often (one write at a time). */
export const LIVE_APPLY_MAX_WAIT_MS = 900;

/**
 * Live apply: while connected and not in Draft mode, a staged edit is written
 * shortly after the last change. Edits debounce and coalesce (the draft always
 * holds the latest value); writes are serialised by the store, and an edit made
 * mid-write stays staged and goes out next. A failed write is not retried for
 * the same draft — a new edit or a reconnect tries again.
 */
export function useLiveApply(): void {
  const autoApply = useAppStore((s) => s.autoApply);
  const connected = useAppStore((s) => s.connected);
  const draft = useAppStore((s) => s.draft);
  const draftDirty = useAppStore((s) => s.draftDirty);
  const applying = useAppStore((s) => s.applying);
  const commitDraft = useAppStore((s) => s.commitDraft);
  const signature = useMemo(() => (draft ? JSON.stringify(draft) : ""), [draft]);
  const lastAttempted = useRef<string | null>(null);
  const pendingSince = useRef<number | null>(null);

  useEffect(() => {
    if (!connected) lastAttempted.current = null;
  }, [connected]);

  useEffect(() => {
    if (!draftDirty) pendingSince.current = null;
    if (!autoApply || !connected || !draftDirty || !signature || applying) return;
    if (lastAttempted.current === signature) return;
    const now = Date.now();
    if (pendingSince.current === null) pendingSince.current = now;
    const wait = Math.max(0, Math.min(LIVE_APPLY_DEBOUNCE_MS, LIVE_APPLY_MAX_WAIT_MS - (now - pendingSince.current)));
    const id = window.setTimeout(() => {
      lastAttempted.current = signature;
      pendingSince.current = null;
      void commitDraft();
    }, wait);
    return () => window.clearTimeout(id);
  }, [autoApply, connected, draftDirty, signature, applying, commitDraft]);
}
