import type { DeviceState } from "@/lib/ipc";
import { LED_COLORS, LED_MODES } from "@/lib/effects";

interface BoardStatusProps {
  committed: DeviceState | null;
  boardEffect: string;
  draft: DeviceState | null;
  draftDirty: boolean;
  draftChangeCount: number;
  draftEffect: string | null;
  since: string | null;
  tab: "device" | "display" | "lighting" | "profiles";
  displayStaged: boolean;
  displayName: string;
}

/**
 * Single canonical status model, reused in the narrow strip and the XL rail.
 * Status language is fixed: "On board:" and "Draft · N changes — not on board".
 */
export function BoardStatus({
  committed,
  boardEffect,
  draft,
  draftDirty,
  draftChangeCount,
  draftEffect,
  since,
  tab,
  displayStaged,
  displayName,
}: BoardStatusProps) {
  return (
    <>
      <p className="text-xs uppercase tracking-wide text-white/80">On board</p>
      {committed ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full border border-white/20" style={{ background: `rgb(${committed.underglow.color.join(",")})` }} aria-hidden />
          <span className="font-medium text-white">{boardEffect} · {committed.underglow.brightness}/9</span>
          {since && <span className="text-white/70">since {since}</span>}
        </div>
      ) : (
        <p className="mt-1 text-white/70">Not connected — picture is simulated.</p>
      )}
      {draftDirty && draft && committed ? (
        <div className="mt-3 rounded-md bg-sky-400/10 p-2">
          <p className="text-xs uppercase tracking-wide text-sky-300">Draft · {draftChangeCount} change{draftChangeCount === 1 ? "" : "s"} — not on board</p>
          <p className="mt-1 text-white/90">
            Draft: <span className="inline-block size-3 rounded-full border border-white/20 align-middle" style={{ background: `rgb(${draft.underglow.color.join(",")})` }} aria-hidden />{" "}
            {draftEffect} · {draft.underglow.brightness}/9 — LED {LED_MODES.find((m) => m.value === draft.led.mode)?.name ?? draft.led.mode} ({LED_COLORS.find((c) => c.value === draft.led.color)?.name ?? draft.led.color})
            {draft.winLock !== committed.winLock ? ` · Win lock ${draft.winLock ? "on" : "off"}` : ""}
          </p>
        </div>
      ) : committed ? (
        <p className="mt-2 text-white/70">Draft matches the board.</p>
      ) : null}
      {tab === "display" && displayStaged ? (
        <p className="mt-2 text-sky-300">Display draft: {displayName || "image"} — Write image to board to put it on display.</p>
      ) : null}
    </>
  );
}
