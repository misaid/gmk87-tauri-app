import { PRESET_VALUES, type PresetValues } from "@/lib/effects";
import type { LedLighting } from "@/lib/ledField";
import type { Profile } from "@/lib/profiles";

export interface GalleryItem {
  id: string;
  kind: "look" | "profile";
  name: string;
  subtitle: string;
  /** What the mini board renders. */
  lighting: LedLighting;
  active: boolean;
  profile?: Profile;
  look?: PresetValues;
}

/** Thumbnails never render dimmer than this, so a Look is recognisable at a glance. */
const MIN_THUMB_BRIGHTNESS = 5;

export function thumbLighting(u: { effect: number; brightness: number; speed: number; orientation: number; rainbow: number; color: readonly number[] }): LedLighting {
  return {
    effect: u.effect,
    brightness: Math.max(MIN_THUMB_BRIGHTNESS, u.brightness),
    speed: u.speed,
    orientation: u.orientation,
    rainbow: u.rainbow,
    color: [u.color[0], u.color[1], u.color[2]],
  };
}

/** The one gallery: built-in Looks first, then saved profiles; at most one card reads as active. */
export function galleryItems(opts: {
  looks: ReadonlyArray<{ name: string; description?: string }>;
  profiles: readonly Profile[];
  activeProfileId: string | null;
  activeLook: string | null;
}): GalleryItem[] {
  const profileActive = opts.profiles.some((p) => p.id === opts.activeProfileId);
  const out: GalleryItem[] = [];
  for (const look of opts.looks) {
    const v = PRESET_VALUES[look.name];
    if (!v) continue;
    out.push({
      id: `look:${look.name}`,
      kind: "look",
      name: look.name.replace(/-/g, " "),
      subtitle: look.description ?? "Look",
      lighting: thumbLighting({ ...v }),
      active: !profileActive && opts.activeLook === look.name,
      look: v,
    });
  }
  for (const p of opts.profiles) {
    out.push({
      id: `profile:${p.id}`,
      kind: "profile",
      name: p.name,
      subtitle: "Saved profile",
      lighting: thumbLighting(p.lighting.underglow),
      active: p.id === opts.activeProfileId,
      profile: p,
    });
  }
  return out;
}
