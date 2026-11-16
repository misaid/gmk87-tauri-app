import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PanelHead } from "@/components/PanelHead";
import { Button } from "@/components/ui/button";
import { BoardThumb } from "@/components/BoardThumb";
import { galleryItems, type GalleryItem } from "@/lib/gallery";
import { matchingLook } from "@/lib/lightingSync";
import { loadProfiles, profileLightingFromState, saveProfiles, upsertProfile, type Profile } from "@/lib/profiles";
import { OFFLINE_STATE, selectEffectiveState, useAppStore } from "@/store";

/** Looks and saved profiles as tiles of mini boards. `compact` is one strip (Lighting); otherwise two indexed groups (Profiles). */
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

  const cardW = compact ? "w-[172px] shrink-0" : "";
  const idx = (n: number) => String(n + 1).padStart(2, "0");

  const saveCard = (
    <li key="save" className={cardW}>
      {saving ? (
        <form
          className="tile flex h-full min-h-[116px] flex-col justify-center gap-2 border-dashed p-2.5"
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
            className="h-8 w-full rounded-[var(--r-ctl)] border border-[var(--line)] bg-[var(--bg-sunk)] px-2 text-[12px] text-[var(--text)] placeholder:text-[var(--dim)]"
          />
          <button type="submit" className="keycap h-8 text-[12px]">
            Save
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setSaving(true)}
          className="tile flex h-full min-h-[116px] w-full flex-col items-center justify-center gap-2 border-dashed border-[var(--line-strong)] text-[12px] font-[550] text-[var(--text)]"
        >
          <span aria-hidden className="keycap flex size-6 items-center justify-center !rounded-[4px]">
            <Plus className="size-3.5" />
          </span>
          Save current
        </button>
      )}
    </li>
  );

  function tile(item: GalleryItem, i: number) {
    return (
      <li key={item.id} data-active={item.active} className={`tile group flex flex-col gap-2 p-2 ${cardW}`} onMouseEnter={() => setHot(item.id)} onMouseLeave={() => setHot(null)}>
        <button
          type="button"
          aria-pressed={item.active}
          aria-label={item.kind === "profile" ? `Apply profile ${item.name}` : `Apply look ${item.name}`}
          title={item.subtitle}
          onClick={() => apply(item)}
          onFocus={() => setHot(item.id)}
          onBlur={() => setHot(null)}
          className="flex flex-col gap-2 rounded-[var(--r-ctl)] text-left"
        >
          <span className="tile-well block">
            <BoardThumb lighting={item.lighting} live={hot === item.id} />
            <span aria-hidden className="tile-led" />
          </span>
          {renaming === item.profile?.id ? null : (
            <span className="flex items-center gap-2 px-0.5">
              <span aria-hidden className="readout text-[11px] text-[var(--dim)]">{idx(i)}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-[550] capitalize text-[var(--text)]">{item.name}</span>
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
            className="h-7 w-full rounded-[var(--r-ctl)] border border-[var(--line)] bg-[var(--bg-sunk)] px-1.5 text-[12px] text-[var(--text)]"
          />
        )}
        {!compact && item.profile && (
          <span className="absolute left-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <Button variant="ghost" size="icon" className="size-[26px] bg-[var(--bg-sunk)]/80" aria-label={`Rename ${item.profile.name}`} onClick={() => {
              setRenameValue(item.profile!.name);
              setRenaming(item.profile!.id);
            }}>
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" className="size-[26px] bg-[var(--bg-sunk)]/80" aria-label={`Delete ${item.profile.name}`} onClick={() => remove(item.profile!)}>
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </span>
        )}
      </li>
    );
  }

  const skeletons = !presetsLoaded && presets.length === 0 && [0, 1, 2].map((i) => <li key={i} aria-hidden className={`tile min-h-[116px] animate-pulse ${cardW}`} />);

  if (compact) {
    return (
      <ul aria-label="Looks and profiles" className="flex gap-2.5 overflow-x-auto pb-2 pr-1 pt-0.5">
        {saveCard}
        {skeletons}
        {items.map((item, i) => tile(item, i))}
      </ul>
    );
  }

  const mine = items.filter((item) => item.kind === "profile");
  const builtIn = items.filter((item) => item.kind !== "profile");
  const grid = "grid grid-cols-2 gap-3 min-[900px]:grid-cols-3 min-[1180px]:grid-cols-4";
  return (
    <>
      <section className="panel p-4" aria-labelledby="profiles-mine">
        <PanelHead n={1} title="Your profiles" id="profiles-mine" />
        <ul aria-label="Your profiles" className={grid}>
          {saveCard}
          {mine.map((item, i) => tile(item, i))}
        </ul>
        {mine.length === 0 && <p className="mt-3 text-[12px] text-[var(--muted)]">Nothing saved yet. Set the board how you like it, then press Save current.</p>}
      </section>
      <section className="panel p-4" aria-labelledby="profiles-built-in">
        <PanelHead n={2} title="Built-in looks" id="profiles-built-in" />
        <ul aria-label="Built-in looks" className={grid}>
          {skeletons}
          {builtIn.map((item, i) => tile(item, i))}
        </ul>
      </section>
    </>
  );
}
