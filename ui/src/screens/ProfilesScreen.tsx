import { useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UNDERGLOW_EFFECTS } from "@/lib/effects";
import { loadProfiles, saveProfiles, upsertProfile, profileLightingFromState, type Profile } from "@/lib/profiles";
import { ledGrid } from "@/lib/ledField";
import { selectEffectiveState, useAppStore } from "@/store";

const THUMB_UNLIT = "#1b222d";

/** A saved look rendered as a tiny LED board, so profiles are recognisable at a glance. */
function ProfileThumb({ profile }: { profile: Profile }) {
  const u = profile.lighting.underglow;
  const off = u.effect === 0;
  const grid = ledGrid({ effect: u.effect, brightness: 9, speed: u.speed, orientation: u.orientation, rainbow: u.rainbow, color: u.color as [number, number, number] }, 280, 4, 16);
  return (
    <span aria-hidden className="relative block rounded-[10px] bg-[#07080b] p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
      <span className="flex flex-col gap-[3px]" style={{ opacity: off ? 0.25 : 1 }}>
        {grid.map((row, i) => (
          <span key={i} className="flex h-[9px] gap-[2px]">
            {row.map((stop, j) => (
              <span key={j} className="h-full flex-1 rounded-[2px]" style={{ backgroundColor: THUMB_UNLIT, backgroundImage: off ? undefined : `linear-gradient(${stop}, ${stop})` }} />
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function ProfilesScreen() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const entries = useAppStore((s) => s.entries);
  const slot = useAppStore((s) => s.slot);
  const setSlot = useAppStore((s) => s.setSlot);
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const stageProfile = useAppStore((s) => s.stageProfile);
  const activeId = useAppStore((s) => s.activeProfileId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const setNotice = useAppStore((s) => s.setNotice);
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [name, setName] = useState("");

  const current = effective ?? committed;
  const currentEntry = entries[slot];

  function persist(next: Profile[]) {
    setProfiles(next);
    saveProfiles(next);
  }

  function saveCurrent() {
    if (!current) {
      setNotice("Stage lighting first, then save the profile.");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice("Give the profile a name first.");
      return;
    }
    const profile: Profile = {
      id: `${Date.now()}`,
      name: trimmed,
      lighting: profileLightingFromState(current),
      display: { slot, delayMs: currentEntry.delayMs },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    persist(upsertProfile(profiles, profile));
    setName("");
    setNotice(`Profile "${trimmed}" saved ✓`);
  }

  function applyProfile(profile: Profile) {
    stageProfile(profile);
    setSlot(profile.display.slot);
    setDelayMs(profile.display.delayMs);
    setActiveTab("lighting");
    setNotice(`Profile "${profile.name}" applied.`);
  }

  function commitRename(profile: Profile) {
    const trimmed = renameValue.trim();
    setRenaming(null);
    if (!trimmed || trimmed === profile.name) return;
    persist(profiles.map((p) => (p.id === profile.id ? { ...p, name: trimmed, updatedAt: Date.now() } : p)));
    setNotice(`Renamed to "${trimmed}".`);
  }

  function deleteProfile(profile: Profile) {
    persist(profiles.filter((p) => p.id !== profile.id));
    setNotice(`Profile "${profile.name}" deleted.`);
  }

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <section className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4" aria-labelledby="save-profile-heading">
        <h2 id="save-profile-heading" className="mb-3 text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
          Save current look
        </h2>
        <p className="text-[11px] text-[var(--muted)]">
          {current
            ? `Current: ${UNDERGLOW_EFFECTS.find((e) => e.value === current.underglow.effect)?.name ?? current.underglow.effect} · ${current.underglow.brightness}/9 · Slot ${slot === "slot0" ? "0" : "1"} · ${currentEntry.delayMs}ms`
            : "Stage lighting first (any Lighting edit) to create a profile."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="Profile name"
            placeholder="My gaming look"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 min-w-52 flex-1 rounded-[10px] border border-[var(--line-strong)] bg-[var(--panel-2)] px-3 text-[13px] text-[var(--text)] placeholder:text-[var(--dim)]"
          />
          <Button size="sm" onClick={saveCurrent} disabled={!current}>
            Save profile
          </Button>
        </div>
      </section>

      <section className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4" aria-labelledby="saved-profiles-heading">
        <h2 id="saved-profiles-heading" className="mb-3 text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
          Saved profiles
        </h2>
        {profiles.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-[var(--line-strong)] px-4 py-8 text-center">
            <span aria-hidden className="mb-1 flex h-6 w-40 gap-[3px]">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className="h-full flex-1 rounded-[2px] bg-white/[0.07]" />
              ))}
            </span>
            <p className="text-[13px] font-medium text-[var(--text)]">No saved profiles yet</p>
            <p className="max-w-sm text-[12px] text-[var(--muted)]">Dial in a look on the Lighting page, name it above, and it shows up here as a card you can apply in one click.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => {
              const active = profile.id === activeId;
              return (
                <li key={profile.id} className={`flex flex-col gap-3 rounded-[14px] border bg-[var(--panel-2)] p-3 ${active ? "border-white/45" : "border-[var(--line)]"}`}>
                  <ProfileThumb profile={profile} />
                  <div className="min-w-0">
                    {renaming === profile.id ? (
                      <input
                        autoFocus
                        type="text"
                        aria-label={`Rename ${profile.name}`}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(profile)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(profile);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        className="h-7 w-full rounded-[8px] border border-[var(--line-strong)] bg-[var(--panel-2)] px-2 text-[13px] text-[var(--text)]"
                      />
                    ) : (
                      <span className="flex items-center gap-2 font-medium text-[var(--text)]">
                        <span aria-hidden className="size-3 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: `rgb(${profile.lighting.underglow.color.join(",")})` }} />
                        <span className="truncate">{profile.name}</span>
                        {active && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--text)]">
                            <Check className="size-3" aria-hidden />
                            Active
                          </span>
                        )}
                      </span>
                    )}
                    <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                      {UNDERGLOW_EFFECTS.find((e) => e.value === profile.lighting.underglow.effect)?.name ?? profile.lighting.underglow.effect} · {profile.lighting.underglow.brightness}/9 · Slot {profile.display.slot === "slot0" ? "0" : "1"} · {profile.display.delayMs}ms · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(profile.updatedAt))}
                    </span>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5">
                    <Button size="sm" onClick={() => applyProfile(profile)}>
                      Apply
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Rename ${profile.name}`}
                      onClick={() => {
                        setRenameValue(profile.name);
                        setRenaming(profile.id);
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      Rename
                    </Button>
                    <Button variant="outline" size="sm" className="ml-auto" aria-label={`Delete ${profile.name}`} onClick={() => deleteProfile(profile)}>
                      <Trash2 className="size-3.5" aria-hidden />
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
