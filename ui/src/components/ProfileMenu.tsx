import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { loadProfiles, profileLightingFromState, saveProfiles, upsertProfile, type Profile } from "@/lib/profiles";
import { profileMatches } from "@/lib/lightingSync";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** Compact active-profile switcher: selecting stages the profile as a draft. */
export function ProfileMenu({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const activeId = useAppStore((s) => s.activeProfileId);
  const stageProfile = useAppStore((s) => s.stageProfile);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setNotice = useAppStore((s) => s.setNotice);
  const slot = useAppStore((s) => s.slot);
  const entries = useAppStore((s) => s.entries);
  const current = effective ?? committed ?? OFFLINE_STATE;
  const active = profiles.find((p) => p.id === activeId) ?? null;
  const edited = active ? !profileMatches(active.lighting, current) : false;

  useEffect(() => {
    if (!open) return;
    setProfiles(loadProfiles());
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function saveAs() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const profile: Profile = {
      id: `${Date.now()}`,
      name: trimmed,
      lighting: profileLightingFromState(current),
      display: { slot, delayMs: entries[slot].delayMs },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = upsertProfile(profiles, profile);
    saveProfiles(next);
    setProfiles(next);
    stageProfile(next.find((p) => p.name.toLowerCase() === trimmed.toLowerCase()) ?? profile);
    setName("");
    setNotice(`Profile "${trimmed}" saved ✓`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--panel-2)] pl-3 pr-2 text-[12px] text-[var(--text)] transition-colors hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="text-[var(--muted)]">Profile</span>
        <span className="font-semibold">{active?.name ?? "None"}</span>
        {edited && <span role="img" aria-label="Edited" title="Edited since this profile was saved" className="size-1.5 rounded-full bg-[var(--warn)]" />}
        <ChevronDown className="size-3.5 text-[var(--muted)]" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Profiles" className="absolute left-0 top-full z-40 mt-2 w-[260px] rounded-[14px] border border-white/10 bg-[rgba(14,16,22,0.96)] p-2 text-[12px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl">
          {profiles.length === 0 && <p className="px-2 py-1.5 text-[var(--muted)]">No saved profiles yet.</p>}
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === activeId}
              onClick={() => {
                stageProfile(p);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[var(--text)] hover:bg-white/[0.07]"
            >
              <span aria-hidden className="size-3 rounded-full ring-1 ring-white/20" style={{ background: `rgb(${p.lighting.underglow.color.join(",")})` }} />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === activeId && <span className="text-[10px] text-[var(--muted)]">{edited ? "edited" : "active"}</span>}
            </button>
          ))}
          <div className="my-1.5 h-px bg-white/[0.08]" />
          <div className="flex items-center gap-1.5 px-1">
            <input
              type="text"
              aria-label="New profile name"
              placeholder="Save current as…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveAs()}
              className="h-8 min-w-0 flex-1 rounded-[8px] border border-[var(--line-strong)] bg-[var(--panel-2)] px-2 text-[12px] text-[var(--text)] placeholder:text-[var(--dim)]"
            />
            <button type="button" aria-label="Save profile" disabled={!name.trim()} onClick={saveAs} className="inline-flex size-8 items-center justify-center rounded-[8px] bg-[var(--accent)] text-white disabled:opacity-35">
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setActiveTab("profiles");
            }}
            className="mt-1 w-full rounded-[8px] px-2 py-1.5 text-left text-[var(--muted)] hover:bg-white/[0.07] hover:text-[var(--text)]"
          >
            Manage profiles →
          </button>
        </div>
      )}
    </div>
  );
}
