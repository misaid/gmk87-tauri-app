import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UNDERGLOW_EFFECTS } from "@/lib/effects";
import { loadProfiles, saveProfiles, upsertProfile, profileLightingFromState, type Profile } from "@/lib/profiles";
import { selectEffectiveState, useAppStore } from "@/store";

export default function ProfilesScreen() {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const entries = useAppStore((s) => s.entries);
  const slot = useAppStore((s) => s.slot);
  const setSlot = useAppStore((s) => s.setSlot);
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
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
    setLightingDraft({
      underglowEffect: profile.lighting.underglow.effect,
      underglowBrightness: profile.lighting.underglow.brightness,
      underglowSpeed: profile.lighting.underglow.speed,
      underglowOrientation: profile.lighting.underglow.orientation,
      underglowRainbow: profile.lighting.underglow.rainbow,
      underglowColor: profile.lighting.underglow.color,
      ledMode: profile.lighting.led.mode,
      ledSaturation: profile.lighting.led.saturation,
      ledRainbow: profile.lighting.led.rainbow,
      ledColor: profile.lighting.led.color,
      winLock: profile.lighting.winLock,
    });
    setSlot(profile.display.slot);
    setDelayMs(profile.display.delayMs);
    setActiveTab("lighting");
    setNotice(`Profile "${profile.name}" staged as draft ✓ — review, then Write to board.`);
  }

  function deleteProfile(profile: Profile) {
    persist(profiles.filter((p) => p.id !== profile.id));
    setNotice(`Profile "${profile.name}" deleted.`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-[var(--space-section)] pt-3 text-sm">
      <div>
        <h1 className="text-[var(--text-h1)] font-semibold text-white">Profiles</h1>
        <p className="mt-1 text-sm text-white/80">
          Save a complete look (lighting + display slot). Apply it as a draft, then Write to board.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-4" aria-labelledby="save-profile-heading">
        <h2 id="save-profile-heading" className="text-[var(--text-h2)] font-medium text-white">Save current look</h2>
        <p className="text-xs text-white/70">
          {current
            ? `Current: ${UNDERGLOW_EFFECTS.find((e) => e.value === current.underglow.effect)?.name ?? current.underglow.effect} · ${current.underglow.brightness}/9 · Slot ${slot === "slot0" ? "0" : "1"} · ${currentEntry.delayMs}ms`
            : "Stage lighting first (any Lighting edit) to create a profile."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="Profile name"
            placeholder="My gaming look"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 min-w-52 rounded-md border border-white/15 bg-neutral-900 px-3 text-sm text-white placeholder:text-white/50"
          />
          <Button size="sm" onClick={saveCurrent} disabled={!current}>
            Save profile
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-white/10 p-4" aria-labelledby="saved-profiles-heading">
        <h2 id="saved-profiles-heading" className="text-[var(--text-h2)] font-medium text-white">Saved profiles</h2>
        {profiles.length === 0 ? (
          <p className="text-xs text-white/70">No saved profiles yet. Save your current look above, then Apply it here later.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <span className="size-4 shrink-0 rounded-full border border-white/20" style={{ background: `rgb(${profile.lighting.underglow.color.join(",")})` }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-white">{profile.name}</span>
                  <span className="block text-xs text-white/70">
                    {UNDERGLOW_EFFECTS.find((e) => e.value === profile.lighting.underglow.effect)?.name ?? profile.lighting.underglow.effect} · {profile.lighting.underglow.brightness}/9 · Slot {profile.display.slot === "slot0" ? "0" : "1"} · {profile.display.delayMs}ms · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(profile.updatedAt))}
                  </span>
                </span>
                <Button size="sm" onClick={() => applyProfile(profile)}>
                  Apply
                </Button>
                <Button variant="outline" size="sm" onClick={() => deleteProfile(profile)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
