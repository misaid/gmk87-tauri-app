import type { DeviceState } from "@/lib/ipc";

export interface ProfileLighting {
  underglow: { effect: number; brightness: number; speed: number; orientation: number; rainbow: number; color: [number, number, number] };
  led: { mode: number; saturation: number; rainbow: number; color: number };
  winLock: boolean;
}

export interface ProfileDisplay {
  slot: "slot0" | "slot1";
  delayMs: number;
}

export interface Profile {
  id: string;
  name: string;
  lighting: ProfileLighting;
  display: ProfileDisplay;
  createdAt: number;
  updatedAt: number;
}

const KEY = "gmk87.profiles.v1";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

export function loadProfiles(): Profile[] {
  const v = loadJSON<Profile[]>(KEY, []);
  return Array.isArray(v) ? v : [];
}

export function saveProfiles(profiles: Profile[]) {
  saveJSON(KEY, profiles);
}

export function upsertProfile(profiles: Profile[], profile: Profile): Profile[] {
  const idx = profiles.findIndex((p) => p.name.toLowerCase() === profile.name.toLowerCase());
  if (idx >= 0) {
    const next = [...profiles];
    next[idx] = { ...profile, id: profiles[idx].id, createdAt: profiles[idx].createdAt };
    return next;
  }
  return [...profiles, profile];
}

export function profileLightingFromState(state: DeviceState): ProfileLighting {
  return {
    underglow: { ...state.underglow },
    led: { ...state.led },
    winLock: state.winLock,
  };
}
