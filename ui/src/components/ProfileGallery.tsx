import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { BoardThumb } from "@/components/BoardThumb";
import { galleryItems, type GalleryItem } from "@/lib/gallery";
import { matchingLook } from "@/lib/lightingSync";
import { loadProfiles, profileLightingFromState, saveProfiles, upsertProfile, type Profile } from "@/lib/profiles";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** Looks and saved profiles as one gallery of mini boards. `compact` is a one-row strip. */
export function ProfileGallery({ compact = false }: { compact?: boolean }) {
  const effective = useAppStore(selectEffectiveState);
  const committed = useAppStore((s) => s.state);
  const presets = useAppStore((s) => s.presets);
  const presetsLoaded = useAppStore((s) => s.presetsLoaded);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const activeId = useAppStore((s) => s.activeProfileId);
  const stageProfile = useAppStore((s) => s.stageProfile);
  const setLightingDraft = useAppStore((s) => s.setLightingDraft);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSlot = useAppStore((s) => s.setSlot);
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const setNotice = useAppStore((s) => s.setNotice);
  const slot = useAppStore((s) => s.slot);
  const entries = useAppStore((s) => s.entries);
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [hot, setHot] = useState<string | null>(null);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const current = effective ?? committed ?? OFFLINE_STATE;
  const activeLook = matchingLook(current);
  const items = useMemo(
    () => galleryItems({ looks: presets, profiles, activeProfileId: activeId, activeLook }),
    [presets, profiles, activeId, activeLook],
  );

  function persist(next: Profile[]) {
    setProfiles(next);
    saveProfiles(next);
  }

  function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice("Give the profile a name first.");
      return;
    }
    const profile: Profile = {
      id: `${Date.now()}`,
      name: trimmed,
      lighting: profileLightingFromState(current),
      display: { slot, delayMs: entries[slot].delayMs },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = upsertProfile(profiles, profile);
    persist(next);
    stageProfile(next.find((p) => p.name.toLowerCase() === trimmed.toLowerCase()) ?? profile);
    setName("");
    setSaving(false);
    setNotice(`Profile "${trimmed}" saved ✓`);
  }

  function apply(item: GalleryItem) {
    if (item.profile) {
      stageProfile(item.profile);
      setSlot(item.profile.display.slot);
      setDelayMs(item.profile.display.delayMs);
      if (!compact) setActiveTab("lighting");
      setNotice(`Profile "${item.profile.name}" applied.`);
    } else if (item.look) {
      const v = item.look;
      setLightingDraft({
        underglowEffect: v.effect,
        underglowBrightness: v.brightness,
        underglowSpeed: v.speed,
        underglowOrientation: v.orientation,
        underglowRainbow: v.rainbow,
        underglowColor: v.color,
        ledMode: v.ledMode,
        ledSaturation: v.ledSaturation,
        ledRainbow: v.ledRainbow,
        ledColor: v.ledColor,
      });
    }
  }

  function commitRename(profile: Profile) {
    const trimmed = renameValue.trim();
    setRenaming(null);
    if (!trimmed || trimmed === profile.name) return;
    persist(profiles.map((p) => (p.id === profile.id ? { ...p, name: trimmed, updatedAt: Date.now() } : p)));
    setNotice(`Renamed to "${trimmed}".`);
  }

  function remove(profile: Profile) {
    persist(profiles.filter((p) => p.id !== profile.id));
    setNotice(`Profile "${profile.name}" deleted.`);
  }

  const cardW = compact ? "w-[188px] shrink-0" : "";
  const saveCard = (
    <li key="save" className={cardW}>
      {saving ? (
        <form
          className="flex h-full min-h-[88px] flex-col justify-center gap-1.5 rounded-[12px] border border-dashed border-white/40 bg-[var(--panel-2)] p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            saveCurrent();
          }}
        >
          <input
            autoFocus
            type="text"
            aria-label="Profile name"
            placeholder="Name this look"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSaving(false)}
            className="h-7 w-full rounded-[8px] border border-[var(--line-strong)] bg-[var(--panel)] px-2 text-[12px] text-[var(--text)] placeholder:text-[var(--dim)]"
          />
          <button type="submit" className="h-7 rounded-[8px] bg-white text-[12px] font-semibold text-[#0b0d12]">
            Save
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setSaving(true)}
          className="flex h-full min-h-[88px] w-full flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[var(--line-strong)] text-[12px] font-medium text-[var(--text)] transition-colors hover:border-white/50 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <Plus className="size-4" aria-hidden />
          Save current
        </button>
      )}
    </li>
  );

  return (
    <ul
      aria-label="Looks and profiles"
      className={compact ? "flex gap-2 overflow-x-auto pb-1.5" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"}
    >
      {saveCard}
      {!presetsLoaded && presets.length === 0 && [0, 1, 2].map((i) => <li key={i} aria-hidden className={`min-h-[88px] animate-pulse rounded-[12px] bg-white/[0.06] ${cardW}`} />)}
      {items.map((item) => (
        <li
          key={item.id}
          className={`group flex flex-col gap-1.5 rounded-[12px] border bg-[var(--panel-2)] p-2 ${cardW} ${item.active ? "border-white/60" : "border-[var(--line)]"}`}
          onMouseEnter={() => setHot(item.id)}
          onMouseLeave={() => setHot(null)}
        >
          <button
            type="button"
            aria-pressed={item.active}
            aria-label={item.kind === "profile" ? `Apply profile ${item.name}` : `Apply look ${item.name}`}
            title={item.subtitle}
            onClick={() => apply(item)}
            onFocus={() => setHot(item.id)}
            onBlur={() => setHot(null)}
            className="flex flex-col gap-1.5 rounded-[8px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <BoardThumb lighting={item.lighting} live={hot === item.id} />
            {renaming === item.profile?.id ? null : (
              <span className="flex items-center gap-1 text-[12px] font-medium capitalize text-[var(--text)]">
                <span className="truncate">{item.name}</span>
                {item.active && <Check className="size-3 shrink-0" aria-label="Active" />}
              </span>
            )}
          </button>
          {item.profile && renaming === item.profile.id && (
            <input
              autoFocus
              type="text"
              aria-label={`Rename ${item.profile.name}`}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(item.profile!)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(item.profile!);
                if (e.key === "Escape") setRenaming(null);
              }}
              className="h-6 w-full rounded-[6px] border border-[var(--line-strong)] bg-[var(--panel)] px-1.5 text-[12px] text-[var(--text)]"
            />
          )}
          {!compact && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
              <span className="truncate">{item.kind === "profile" ? item.subtitle : "Look"}</span>
              {item.profile && (
                <span className="ml-auto flex gap-0.5">
                  <button
                    type="button"
                    aria-label={`Rename ${item.profile.name}`}
                    onClick={() => {
                      setRenameValue(item.profile!.name);
                      setRenaming(item.profile!.id);
                    }}
                    className="rounded p-1 hover:bg-white/10 hover:text-[var(--text)]"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" aria-label={`Delete ${item.profile.name}`} onClick={() => remove(item.profile!)} className="rounded p-1 hover:bg-white/10 hover:text-[var(--text)]">
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
