import { create } from "zustand";
import * as ipc from "./lib/ipc";
import { DEFAULT_CROP, type CropParams } from "./lib/crop";
import { MAX_TOTAL_FRAMES } from "./lib/budget";
import type { Profile } from "./lib/profiles";
import { cropKey } from "./lib/crop";
import { decodeUrl, makeThumbnail, predecode } from "./lib/bitmapCache";
import {
  IndexedDbStorage,
  MediaLibrary,
  type LibraryItem,
} from "./lib/mediaLibrary";

/** The persistent image/GIF log. Swappable so tests can inject an in-memory store. */
let mediaLibrary = new MediaLibrary(new IndexedDbStorage());
export function setMediaLibrary(lib: MediaLibrary): void {
  mediaLibrary = lib;
}

/** Orders async preview renders so a slow, stale one cannot overwrite a newer. */
const previewSequence: Record<Slot, number> = { slot0: 0, slot1: 0 };

/** Revoke a replaced preview URL a moment later, once no <img> can still be showing it. */
function retireUrl(url: string): void {
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const PREVIEW_DEBOUNCE_MS = 200;

/** Log a slot's source in the media library (deduped by content hash). */
async function registerInLibrary(
  slot: Slot,
  bytes: Uint8Array,
  name: string,
  info: ipc.SourceInfo,
  get: () => AppStore,
  set: (partial: Partial<AppStore>) => void,
): Promise<void> {
  const { thumb, width, height } = await makeThumbnail(bytes).catch(() => ({ thumb: "", width: 0, height: 0 }));
  const inUse = new Set(
    SLOTS.map((s) => get().entries[s].libraryId).filter((id): id is string => Boolean(id)),
  );
  const item = await mediaLibrary.add(
    bytes,
    { name, isGif: info.isGif, frames: info.sourceFrames, width, height, thumb },
    inUse,
  );
  if (!item) return;
  if (get().entries[slot].source === bytes) {
    set({ entries: { ...get().entries, [slot]: { ...get().entries[slot], libraryId: item.id } } });
  }
  set({ library: await mediaLibrary.list() });
}
let lastDraftPush = 0;

export type Slot = "slot0" | "slot1";

/** Offline staging base — lets users build a draft before the board is plugged in. */
export const OFFLINE_STATE: ipc.DeviceState = {
  connected: false,
  synced: false,
  underglow: { effect: 5, brightness: 5, speed: 3, orientation: 0, rainbow: 0, color: [139, 92, 246] },
  led: { mode: 3, saturation: 5, rainbow: 0, color: 6 },
  winLock: false,
  show: 0,
  slot0Frames: 1,
  slot1Frames: 1,
  frameDelayMs: 100,
  time: [2026, 1, 1, 4, 12, 0, 0],
};

export const SLOTS: Slot[] = ["slot0", "slot1"];

export type Tab = "device" | "display" | "lighting" | "profiles";

/** One display slot's in-progress source: the file, its framing and framing. */
export interface SlotEntry {
  /** The source bytes, or null when only a stored record is known. */
  source: Uint8Array | null;
  name: string;
  info: ipc.SourceInfo | null;
  crop: CropParams;
  delayMs: number;
  /** Media-library id (content hash) of the source, once logged. */
  libraryId?: string | null;
  /** Last device-resolution render and the crop it was rendered for. */
  previewUrl?: string | null;
  previewKey?: string | null;
}

function emptyEntry(): SlotEntry {
  return { source: null, name: "", info: null, crop: { ...DEFAULT_CROP }, delayMs: 100, libraryId: null, previewUrl: null, previewKey: null };
}

/** One persisted lighting undo step: the previous board state + when it was saved. */
export interface LightingHistoryEntry {
  state: ipc.DeviceState;
  at: number;
  label: string;
}

/** Snapshot taken before every successful display upload, for undo. */
export interface DisplayHistoryEntry {
  entries: Record<Slot, SlotEntry>;
  slot: Slot;
  delayMs: number;
  at: number;
  label: string;
}

const LS_DRAFT = "gmk87.draft.v1";
const LS_HISTORY = "gmk87.lightingHistory.v1";
/** v2: live apply is the default; the old v1 key meant "opt in to auto-apply". */
const LS_AUTO = "gmk87.autoApply.v2";
const LS_ACTIVE_PROFILE = "gmk87.activeProfile.v1";
const LS_ONBOARDED = "gmk87.onboarded.v1";

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
    // localStorage may be unavailable in tests/private mode — draft/history
    // still work in-memory; persistence is best-effort.
  }
}

function clearKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function patchFromState(s: ipc.DeviceState): ipc.LightingPatch {
  return {
    underglowEffect: s.underglow.effect,
    underglowBrightness: s.underglow.brightness,
    underglowSpeed: s.underglow.speed,
    underglowOrientation: s.underglow.orientation,
    underglowRainbow: s.underglow.rainbow,
    underglowColor: s.underglow.color,
    ledMode: s.led.mode,
    ledSaturation: s.led.saturation,
    ledRainbow: s.led.rainbow,
    ledColor: s.led.color,
    winLock: s.winLock,
  };
}

function mergePatch(base: ipc.DeviceState, patch: ipc.LightingPatch): ipc.DeviceState {
  return {
    ...base,
    underglow: {
      ...base.underglow,
      ...(patch.underglowEffect !== undefined ? { effect: patch.underglowEffect } : {}),
      ...(patch.underglowBrightness !== undefined ? { brightness: patch.underglowBrightness } : {}),
      ...(patch.underglowSpeed !== undefined ? { speed: patch.underglowSpeed } : {}),
      ...(patch.underglowOrientation !== undefined ? { orientation: patch.underglowOrientation } : {}),
      ...(patch.underglowRainbow !== undefined ? { rainbow: patch.underglowRainbow } : {}),
      ...(patch.underglowColor !== undefined ? { color: patch.underglowColor } : {}),
    },
    led: {
      ...base.led,
      ...(patch.ledMode !== undefined ? { mode: patch.ledMode } : {}),
      ...(patch.ledSaturation !== undefined ? { saturation: patch.ledSaturation } : {}),
      ...(patch.ledRainbow !== undefined ? { rainbow: patch.ledRainbow } : {}),
      ...(patch.ledColor !== undefined ? { color: patch.ledColor } : {}),
    },
    winLock: patch.winLock !== undefined ? patch.winLock : base.winLock,
  };
}

interface AppStore {
  devices: ipc.DeviceInfo[];
  state: ipc.DeviceState | null;
  connected: boolean;
  connectingPath: string | null;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  error: string | null;
  errorKind: string | null;
  presets: ipc.Preset[];
  entries: Record<Slot, SlotEntry>;
  slot: Slot;
  /** Preview URL of the selected slot (mirrors entries[slot].previewUrl). */
  previewUrl: string | null;
  progress: ipc.UploadProgress | null;
  uploads: number;
  previewTimer: number | null;
  /** Draft-stage lighting: preview-only edits, not yet written to the board. */
  draft: ipc.DeviceState | null;
  draftDirty: boolean;
  lastDiscardedDraft: ipc.DeviceState | null;
  /** Persisted multi-step undo stack (previous acknowledged board states). */
  lightingHistory: LightingHistoryEntry[];
  /** Last acknowledged board write time (for honest "on board since" caption). */
  lastSyncedAt: number | null;
  /** In-session undo stack for display uploads (previous board contents). */
  displayHistory: DisplayHistoryEntry[];
  /** Last display contents actually acknowledged by the board (for undo). */
  lastUploaded: Record<Slot, SlotEntry> | null;
  onboarded: boolean;
  showOnboarding: boolean;
  /** Transient success feedback (toast) — cleared after a few seconds. */
  notice: string | null;
  /** 'error' toasts get a red style + longer dwell — errors are not successes. */
  noticeKind: "success" | "error" | null;
  /** When set, all ambient animations render once and stay still. */
  animationsPaused: boolean;
  /** Transient hover/focus preview of an underglow effect on the hero board. Never written to the device. */
  previewEffect: number | null;
  setPreviewEffect: (effect: number | null) => void;
  /** Staged (draft) undo/redo: states before/after each edit; null = no draft. */
  draftPast: Array<ipc.DeviceState | null>;
  draftFuture: ipc.DeviceState[];
  /** Applied-write redo stack (states undone from the board). */
  redoStack: LightingHistoryEntry[];
  /** A write to the board is in flight. */
  applying: boolean;
  /** The last write attempt of the current draft failed. */
  applyFailed: boolean;
  /** Live apply (default on): staged edits are written shortly after the last edit. Off = Draft mode, held until Apply. */
  autoApply: boolean;
  setAutoApply: (v: boolean) => void;
  presetsLoaded: boolean;
  activeProfileId: string | null;
  stageProfile: (profile: Profile) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  rereadState: () => Promise<void>;
  /** Write-confirm modal open (draft commit is destructive — needs a diff). */
  showWriteConfirm: boolean;

  refreshDevices: () => Promise<void>;
  connectTo: (path: string) => Promise<void>;
  /** Launch helper: scan, and connect straight away when exactly one keyboard is found. */
  autoConnect: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
  setCrop: (crop: CropParams) => void;
  setSlot: (slot: Slot) => void;
  loadSource: (
    bytes: Uint8Array,
    name: string,
    opts?: { slot?: Slot; crop?: CropParams; libraryId?: string },
  ) => void;
  library: LibraryItem[];
  loadLibrary: () => Promise<void>;
  libraryUse: (id: string, slot?: Slot) => Promise<void>;
  libraryRemove: (id: string) => Promise<void>;
  libraryClear: () => Promise<void>;
  loadStoredDisplay: () => Promise<void>;
  setDelayMs: (ms: number) => void;
  refreshPreview: () => Promise<void>;
  schedulePreview: () => void;
  upload: (delayMs: number, showAfter: boolean) => Promise<void>;
  /** Write every slot that changed since its last successful write, one call each. */
  uploadChanged: (showAfter?: boolean) => Promise<void>;
  /** Progress through a multi-slot write, or null. */
  batch: { index: number; total: number; slot: Slot } | null;
  cancel: () => Promise<void>;
  setProgress: (progress: ipc.UploadProgress) => void;
  handleDisconnected: () => void;
  applyLighting: (patch: ipc.LightingPatch) => Promise<void>;
  loadPresets: () => Promise<void>;
  applyPreset: (name: string) => Promise<void>;
  syncClock: () => Promise<void>;
  dismissError: () => void;
  setLightingDraft: (patch: ipc.LightingPatch) => void;
  commitDraft: () => Promise<void>;
  discardDraft: () => void;
  restoreDraft: () => void;
  undoLighting: () => Promise<void>;
  restoreLightingAt: (index: number) => Promise<void>;
  undoDisplayUpload: () => Promise<void>;
  setOnboarded: (v: boolean) => void;
  setShowOnboarding: (v: boolean) => void;
  setNotice: (msg: string | null, kind?: "success" | "error") => void;
  setAnimationsPaused: (v: boolean) => void;
  setShowWriteConfirm: (v: boolean) => void;
}

function kindOf(error: unknown): string | null {
  if (error && typeof error === "object" && "kind" in error) {
    return String((error as { kind: unknown }).kind);
  }
  return null;
}

function message(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function other(slot: Slot): Slot {
  return slot === "slot0" ? "slot1" : "slot0";
}

/** Frames the device reports for a slot, or the one black frame it starts with. */
function deviceFrames(state: ipc.DeviceState | null, slot: Slot): number {
  if (!state) return 1;
  return slot === "slot0" ? state.slot0Frames : state.slot1Frames;
}

/** Frames a slot will send: the loaded source's count, else what the device holds. */
function slotFrames(entries: Record<Slot, SlotEntry>, state: ipc.DeviceState | null, slot: Slot) {
  return entries[slot].info?.frames ?? deviceFrames(state, slot);
}

/** Frames across both slots, the number the budget is measured against. */
export function selectTotalFrames(store: AppStore): number {
  return slotFrames(store.entries, store.state, "slot0") + slotFrames(store.entries, store.state, "slot1");
}

/** Frames a slot still has room for, given what the other slot will send. */
export function selectRemainingFor(store: AppStore, slot: Slot): number {
  return MAX_TOTAL_FRAMES - slotFrames(store.entries, store.state, other(slot));
}

/** The preview/chrome state: draft edits win over the last acknowledged write. */
export function selectEffectiveState(store: AppStore): ipc.DeviceState | null {
  return store.draft ?? store.state;
}

function cloneEntries(entries: Record<Slot, SlotEntry>): Record<Slot, SlotEntry> {
  return {
    slot0: {
      ...entries.slot0,
      source: entries.slot0.source ? new Uint8Array(entries.slot0.source) : null,
      previewUrl: null,
      previewKey: null,
      crop: { ...entries.slot0.crop },
      info: entries.slot0.info ? { ...entries.slot0.info, dropped: [...entries.slot0.info.dropped] } : null,
    },
    slot1: {
      ...entries.slot1,
      source: entries.slot1.source ? new Uint8Array(entries.slot1.source) : null,
      previewUrl: null,
      previewKey: null,
      crop: { ...entries.slot1.crop },
      info: entries.slot1.info ? { ...entries.slot1.info, dropped: [...entries.slot1.info.dropped] } : null,
    },
  };
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Slots whose source, crop or delay differ from their last successful write,
 * in write order: the viewed slot goes last so it is the one the board shows.
 */
export function dirtySlots(
  entries: Record<Slot, SlotEntry>,
  lastUploaded: Record<Slot, SlotEntry> | null,
  viewed: Slot,
): Slot[] {
  const dirty = SLOTS.filter((s) => {
    const e = entries[s];
    if (!e.source) return false;
    const last = lastUploaded?.[s];
    return !last || !sameBytes(e.source, last.source) || cropKey(e.crop) !== cropKey(last.crop) || e.delayMs !== last.delayMs;
  });
  return [...dirty.filter((s) => s !== viewed), ...dirty.filter((s) => s === viewed)];
}

function slotLabel(slot: Slot): string {
  return slot === "slot0" ? "Slot 0" : "Slot 1";
}

function withEntry(
  state: AppStore,
  slot: Slot,
  patch: Partial<SlotEntry>,
): Pick<AppStore, "entries"> {
  return { entries: { ...state.entries, [slot]: { ...state.entries[slot], ...patch } } };
}

export const useAppStore = create<AppStore>((set, get) => {
  const initialOnboarded = loadJSON<boolean>(LS_ONBOARDED, false) === true;
  const initialHistory = loadJSON<ipc.DeviceState[]>(LS_HISTORY, []);
  const initialDraft = loadJSON<ipc.DeviceState | null>(LS_DRAFT, null);

  /** Write one slot and record it (alone) as what the board now holds. Throws on failure. */
  async function writeSlot(slot: Slot, delayMs: number, showAfter: boolean): Promise<void> {
    const { entries, lastUploaded } = get();
    const entry = entries[slot];
    if (!entry.source) return;
    // Undo snapshot = what the board showed BEFORE this write overwrote it.
    const previousBoard = lastUploaded ?? { slot0: emptyEntry(), slot1: emptyEntry() };
    const snapshot: DisplayHistoryEntry = {
      entries: cloneEntries(previousBoard),
      slot,
      delayMs: previousBoard[slot]?.delayMs ?? delayMs,
      at: Date.now(),
      label: previousBoard[slot]?.name || `${slotLabel(slot)} (previous)`,
    };
    await ipc.uploadDisplay({
      slot,
      name: entry.name,
      bytes: entry.source,
      crop: entry.crop,
      delayMs,
      showAfter,
    });
    // Only this slot becomes "written"; the source is shared (never mutated) so dirty checks stay cheap.
    const written: SlotEntry = { ...entry, crop: { ...entry.crop }, delayMs, previewUrl: null, previewKey: null };
    set({
      lastUploaded: { ...previousBoard, [slot]: written },
      displayHistory: [...get().displayHistory.slice(-9), snapshot],
    });
    set({ state: await ipc.readState(), error: null, errorKind: null });
    if (entry.libraryId) {
      void mediaLibrary.touch(entry.libraryId, entry.crop).then(() => get().loadLibrary());
    }
  }

  return {
    devices: [],
    state: null,
    connected: false,
    connectingPath: null,
    activeTab: "device",
    // Pairing comes first: nothing but the Device screen opens until connected.
    setActiveTab: (activeTab) => {
      if (activeTab !== "device" && !get().connected) return;
      set({ activeTab });
    },
    error: null,
    errorKind: null,
    presets: [],
    entries: { slot0: emptyEntry(), slot1: emptyEntry() },
    slot: "slot0",
    previewUrl: null,
    library: [],
    progress: null,
    uploads: 0,
    batch: null,
    previewTimer: null,
    draft: initialDraft,
    draftDirty: initialDraft !== null,
    lastDiscardedDraft: null,
    lightingHistory: Array.isArray(initialHistory)
      ? initialHistory
          .map((h) =>
            (h as { state?: unknown }).state ? (h as unknown as LightingHistoryEntry) : { state: h, at: 0, label: "earlier write" },
          )
          .slice(-20)
      : [],
    lastSyncedAt: null,
    displayHistory: [],
    lastUploaded: null,
    onboarded: initialOnboarded,
    showOnboarding: !initialOnboarded,
    notice: null,
    noticeKind: null,
    animationsPaused: false,
    previewEffect: null,
    setPreviewEffect: (effect) => set({ previewEffect: effect }),
    showWriteConfirm: false,
    draftPast: [],
    draftFuture: [],
    redoStack: [],
    applying: false,
    applyFailed: false,
    autoApply: loadJSON<boolean>(LS_AUTO, true) !== false,
    setAutoApply: (v) => {
      saveJSON(LS_AUTO, v);
      set({ autoApply: v });
    },
    presetsLoaded: false,
    activeProfileId: loadJSON<string | null>(LS_ACTIVE_PROFILE, null),
    stageProfile: (profile) => {
      get().setLightingDraft({
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
      saveJSON(LS_ACTIVE_PROFILE, profile.id);
      set({ activeProfileId: profile.id });
    },
    undo: async () => {
      const { draft, draftPast, draftFuture } = get();
      if (draft) {
        const prev = draftPast.length ? draftPast[draftPast.length - 1] : null;
        const { state } = get();
        const dirty = prev ? (state ? JSON.stringify(patchFromState(prev)) !== JSON.stringify(patchFromState(state)) : true) : false;
        set({ draft: prev, draftDirty: dirty, draftPast: draftPast.slice(0, -1), draftFuture: [...draftFuture, draft], applyFailed: false });
        if (prev) saveJSON(LS_DRAFT, prev);
        else clearKey(LS_DRAFT);
        return;
      }
      await get().undoLighting();
    },
    redo: async () => {
      const { draft, draftPast, draftFuture, redoStack, state } = get();
      if (draftFuture.length) {
        const next = draftFuture[draftFuture.length - 1];
        const dirty = state ? JSON.stringify(patchFromState(next)) !== JSON.stringify(patchFromState(state)) : true;
        set({ draft: next, draftDirty: dirty, draftFuture: draftFuture.slice(0, -1), draftPast: [...draftPast, draft] });
        saveJSON(LS_DRAFT, next);
        return;
      }
      const entry = redoStack.at(-1);
      if (!entry) return;
      set({ applying: true });
      try {
        const next = await ipc.setLighting(patchFromState(entry.state));
        const history = state ? [...get().lightingHistory.slice(-19), { state, at: Date.now(), label: "before redo" }] : get().lightingHistory;
        saveJSON(LS_HISTORY, history);
        set({ state: next, draft: null, draftDirty: false, lightingHistory: history, redoStack: redoStack.slice(0, -1), lastSyncedAt: Date.now(), error: null, errorKind: null, notice: "Lighting redone ✓" });
        clearKey(LS_DRAFT);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      } finally {
        set({ applying: false });
      }
    },
    rereadState: async () => {
      try {
        const state = await ipc.readState();
        set({ state, connected: state.connected, error: null, errorKind: null, notice: "Board state re-read ✓" });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    refreshDevices: async () => {
      try {
        set({ devices: await ipc.listDevices() });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    autoConnect: async () => {
      await get().refreshDevices();
      const { devices, connected, connectingPath } = get();
      if (devices.length === 1 && !connected && connectingPath === null) {
        await get().connectTo(devices[0].path);
      }
    },

    connectTo: async (path) => {
      set({ connectingPath: path });
      try {
        const state = await ipc.connect(path);
        const queued = get().draft;
        set({ state, connected: state.connected, activeTab: state.connected ? "lighting" : "device", error: null, errorKind: null, draft: queued, draftDirty: queued != null ? JSON.stringify(patchFromState(queued)) !== JSON.stringify(patchFromState(state)) : false });
        if (queued == null) clearKey(LS_DRAFT);
        await get().refreshPreview();
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      } finally {
        set({ connectingPath: null });
      }
    },

    disconnectDevice: async () => {
      await ipc.disconnect();
      // Keep any staged draft — disconnect is not discard.
      set({ state: null, connected: false, activeTab: "device" });
    },

    setCrop: (crop) => {
      set((state) => withEntry(state, state.slot, { crop }));
      get().schedulePreview();
    },
    setSlot: (slot) => {
      // Both slots keep their source, decoded bitmap, crop and last render in
      // memory, so switching only changes which entry the editor shows.
      const entry = get().entries[slot];
      set({ slot, previewUrl: entry.previewUrl ?? null });
      predecode(get().entries[other(slot)].source);
      if (entry.source && (!entry.previewUrl || entry.previewKey !== cropKey(entry.crop))) {
        void get().refreshPreview();
      }
    },
    loadSource: async (bytes, name, opts) => {
      const slot = opts?.slot ?? get().slot;
      const crop = opts?.crop ?? get().entries[slot].crop;
      set((state) => ({
        ...withEntry(state, slot, {
          source: bytes,
          name,
          info: null,
          crop: { ...crop },
          libraryId: opts?.libraryId ?? null,
          previewKey: null,
        }),
        slot,
      }));
      void get().refreshPreview();
      try {
        const maxFrames = Math.max(0, selectRemainingFor(get(), slot));
        const info = await ipc.inspectSource(bytes, get().entries[slot].crop, maxFrames);
        if (get().entries[slot].source !== bytes) return;
        set((state) => withEntry(state, slot, { info, delayMs: info.delayMs }));
        void registerInLibrary(slot, bytes, name, info, get, set);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },
    loadLibrary: async () => {
      set({ library: await mediaLibrary.list() });
    },
    libraryUse: async (id, slot) => {
      const item = get().library.find((i) => i.id === id);
      const bytes = await mediaLibrary.getBytes(id);
      if (!item || !bytes) {
        set({ error: "That library item is no longer available." });
        await get().loadLibrary();
        return;
      }
      await get().loadSource(bytes, item.name, {
        slot: slot ?? get().slot,
        crop: item.lastCrop ?? { ...DEFAULT_CROP },
        libraryId: id,
      });
    },
    libraryRemove: async (id) => {
      await mediaLibrary.remove(id);
      await get().loadLibrary();
    },
    libraryClear: async () => {
      await mediaLibrary.clear();
      await get().loadLibrary();
    },
    loadStoredDisplay: async () => {
      try {
        const stored = await ipc.loadDisplayStore();
        for (const slot of SLOTS) {
          const record = stored[slot];
          if (!record) continue;
          set((state) =>
            withEntry(state, slot, {
              source: record.bytes,
              name: record.name,
              info: {
                isGif: record.isGif,
                frames: record.frames,
                delayMs: record.delayMs,
                sourceFrames: record.sourceFrames,
                dropped: record.dropped,
              },
              crop: { ...record.crop },
              delayMs: record.delayMs,
            }),
          );
        }
        for (const slot of SLOTS) {
          const e = get().entries[slot];
          if (e.source && e.info) void registerInLibrary(slot, e.source, e.name, e.info, get, set);
        }
        // Stored contents are what the board holds — the undo baseline.
        set({ lastUploaded: cloneEntries(get().entries) });
        await get().refreshPreview();
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },
    setDelayMs: (delayMs) => set((state) => withEntry(state, state.slot, { delayMs })),

    schedulePreview: () => {
      // Trailing debounce: the live gesture is drawn client-side, so the true
      // device render only needs to run once the crop has settled.
      const pending = get().previewTimer;
      if (pending !== null) window.clearTimeout(pending);
      const id = window.setTimeout(() => {
        set({ previewTimer: null });
        void get().refreshPreview();
      }, PREVIEW_DEBOUNCE_MS);
      set({ previewTimer: id });
    },

    refreshPreview: async () => {
      const { entries, slot } = get();
      const sequence = ++previewSequence[slot];
      const entry = entries[slot];
      if (!entry.source) {
        set({ previewUrl: null });
        return;
      }
      const key = cropKey(entry.crop);
      const source = entry.source;
      try {
        const png = await ipc.previewDisplay(source, entry.crop);
        // A newer crop or slot switch has already started; its result wins.
        if (sequence !== previewSequence[slot]) return;
        const blob = new Blob([png], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        // Keep the previous frame on screen until this one is decoded: swapping an
        // <img> to a still-loading blob URL paints a blank (black) frame.
        await decodeUrl(url);
        if (sequence !== previewSequence[slot]) {
          URL.revokeObjectURL(url);
          return;
        }
        set((state) => {
          const current = state.entries[slot];
          if (current.previewUrl) retireUrl(current.previewUrl);
          if (current.source !== source) {
            URL.revokeObjectURL(url);
            return {};
          }
          return {
            ...withEntry(state, slot, { previewUrl: url, previewKey: key }),
            previewUrl: state.slot === slot ? url : state.previewUrl,
            error: null,
            errorKind: null,
          };
        });
      } catch (error) {
        if (sequence !== previewSequence[slot]) return;
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    upload: async (delayMs, showAfter) => {
      const { entries, slot } = get();
      if (!entries[slot].source) {
        set({ error: "Choose an image or GIF first." });
        return;
      }
      set({ uploads: get().uploads + 1, progress: { bytesSent: 0, totalBytes: 0 } });
      try {
        await writeSlot(slot, delayMs, showAfter);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      } finally {
        set({ uploads: Math.max(0, get().uploads - 1), progress: null });
      }
    },

    uploadChanged: async (showAfter = true) => {
      const { entries, lastUploaded, slot } = get();
      const queue = dirtySlots(entries, lastUploaded, slot);
      if (queue.length === 0) return;
      set({ uploads: get().uploads + 1, progress: { bytesSent: 0, totalBytes: 0 } });
      try {
        for (const [i, s] of queue.entries()) {
          set({ batch: { index: i + 1, total: queue.length, slot: s }, progress: { bytesSent: 0, totalBytes: 0 } });
          try {
            await writeSlot(s, get().entries[s].delayMs, showAfter && i === queue.length - 1);
          } catch (error) {
            // Earlier slots stay recorded as written; name the one that failed.
            set({ error: `${slotLabel(s)}: ${message(error)}`, errorKind: kindOf(error) });
            return;
          }
        }
      } finally {
        set({ uploads: Math.max(0, get().uploads - 1), progress: null, batch: null });
      }
    },

    cancel: async () => {
      await ipc.cancelUpload();
    },

    setProgress: (progress) => set({ progress }),

    handleDisconnected: () =>
      set({
        connected: false,
        activeTab: "device",
        connectingPath: null,
        state: null,
        draft: null,
        draftDirty: false,
        error: "Keyboard disconnected.",
        errorKind: null,
      }),

    applyLighting: async (patch) => {
      const prev = get().state;
      try {
        const next = await ipc.setLighting(patch);
        const history = prev ? [...get().lightingHistory.slice(-19), { state: prev, at: Date.now(), label: "before write" }] : get().lightingHistory;
        saveJSON(LS_HISTORY, history);
        set({ state: next, error: null, errorKind: null, draft: null, draftDirty: false, lightingHistory: history, lastSyncedAt: Date.now(), redoStack: [] });
        clearKey(LS_DRAFT);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },
    applyPreset: async (name) => {
      const prev = get().state;
      try {
        const next = await ipc.applyPreset(name);
        const history = prev ? [...get().lightingHistory.slice(-19), { state: prev, at: Date.now(), label: `before preset "${name}"` }] : get().lightingHistory;
        saveJSON(LS_HISTORY, history);
        set({ state: next, error: null, errorKind: null, draft: null, draftDirty: false, lightingHistory: history, lastSyncedAt: Date.now(), notice: `Preset "${name}" applied ✓` });
        clearKey(LS_DRAFT);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },
    loadPresets: async () => {
      try {
        set({ presets: await ipc.listPresets(), presetsLoaded: true });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error), presetsLoaded: true });
      }
    },
    syncClock: async () => {
      try {
        set({ state: await ipc.syncClock(), error: null, errorKind: null, notice: "Clock synced ✓" });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },
    dismissError: () => set({ error: null, errorKind: null }),

    setLightingDraft: (patch) => {
      const { state } = get();
      const base = get().draft ?? state ?? OFFLINE_STATE;
      const next = mergePatch(base, patch);
      const dirty = state
        ? JSON.stringify(patchFromState(next)) !== JSON.stringify(patchFromState(state))
        : true;
      // Coalesce rapid edits (slider drags) into one undo step.
      const now = Date.now();
      const coalesce = get().draft !== null && now - lastDraftPush < 500;
      lastDraftPush = now;
      set({
        draft: next,
        draftDirty: dirty,
        lastDiscardedDraft: null,
        draftFuture: [],
        applyFailed: false,
        draftPast: coalesce ? get().draftPast : [...get().draftPast.slice(-29), get().draft],
      });
      saveJSON(LS_DRAFT, next);
    },

    commitDraft: async () => {
      const { draft, state: prev, applying } = get();
      // One write at a time: edits made mid-write stay staged and go out next.
      if (!draft || applying) return;
      set({ applying: true });
      try {
        const next = await ipc.setLighting(patchFromState(draft));
        const history = prev
          ? [...get().lightingHistory.slice(-19), { state: prev, at: Date.now(), label: "before draft write" }]
          : get().lightingHistory;
        saveJSON(LS_HISTORY, history);
        const latest = get().draft;
        const edited = latest !== null && latest !== draft;
        if (edited) {
          const dirty = JSON.stringify(patchFromState(latest)) !== JSON.stringify(patchFromState(next));
          set({ state: next, draft: dirty ? latest : null, draftDirty: dirty, lightingHistory: history, lastSyncedAt: Date.now(), error: null, errorKind: null, redoStack: [], applyFailed: false });
          if (!dirty) clearKey(LS_DRAFT);
        } else {
          set({ state: next, draft: null, draftDirty: false, lightingHistory: history, lastSyncedAt: Date.now(), error: null, errorKind: null, ...(get().autoApply ? {} : { notice: "Lighting written ✓" }), redoStack: [], draftPast: [], draftFuture: [], applyFailed: false });
          clearKey(LS_DRAFT);
        }
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error), applyFailed: true });
      } finally {
        set({ applying: false });
      }
    },

    discardDraft: () => {
      const { draft } = get();
      if (!draft) return;
      set({ draft: null, draftDirty: false, draftPast: [], draftFuture: [], applyFailed: false, lastDiscardedDraft: draft, notice: "Draft discarded — Undo is in the Lighting bar." });
      clearKey(LS_DRAFT);
    },

    restoreDraft: () => {
      const restored = get().lastDiscardedDraft;
      if (!restored) return;
      const { state } = get();
      const dirty = state
        ? JSON.stringify(patchFromState(restored)) !== JSON.stringify(patchFromState(state))
        : true;
      set({ draft: restored, draftDirty: dirty, lastDiscardedDraft: null, notice: "Draft restored ✓" });
      saveJSON(LS_DRAFT, restored);
    },

    undoLighting: async () => {
      const history = get().lightingHistory;
      const entry = history.at(-1);
      const prev = entry?.state ?? (history as unknown as ipc.DeviceState[]).at(-1);
      if (!prev) return;
      try {
        const next = await ipc.setLighting(patchFromState(prev as ipc.DeviceState));
        const rest = history.slice(0, -1);
        saveJSON(LS_HISTORY, rest);
        const undone = get().state;
        set({ redoStack: undone ? [...get().redoStack.slice(-19), { state: undone, at: Date.now(), label: "undone" }] : get().redoStack, state: next, draft: null, draftDirty: false, lightingHistory: rest, lastSyncedAt: Date.now(), error: null, errorKind: null, notice: "Lighting undone ✓" });
        clearKey(LS_DRAFT);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    restoreLightingAt: async (index) => {
      const history = get().lightingHistory;
      const entry = history[index];
      const target = entry?.state ?? (history as unknown as ipc.DeviceState[])[index];
      if (!target) return;
      try {
        const next = await ipc.setLighting(patchFromState(target as ipc.DeviceState));
        const rest = history.slice(0, index);
        saveJSON(LS_HISTORY, rest);
        set({ state: next, draft: null, draftDirty: false, lightingHistory: rest, lastSyncedAt: Date.now(), error: null, errorKind: null, notice: "Restored that write ✓" });
        clearKey(LS_DRAFT);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    undoDisplayUpload: async () => {
      const history = get().displayHistory;
      const snap = history.at(-1);
      if (!snap) return;
      const rest = history.slice(0, -1);
      const restoredEntries = cloneEntries(snap.entries);
      set({ displayHistory: rest, entries: cloneEntries(snap.entries), slot: snap.slot, lastUploaded: restoredEntries });
      await get().refreshPreview();
      // Re-send the restored slot so the board actually reverts, not just the UI.
      const { connected } = get();
      const restored = snap.entries[snap.slot];
      if (connected && restored.source && restored.info) {
        set({ uploads: get().uploads + 1, progress: { bytesSent: 0, totalBytes: 0 } });
        try {
          await ipc.uploadDisplay({
            slot: snap.slot,
            name: restored.name,
            bytes: restored.source,
            crop: restored.crop,
            delayMs: snap.delayMs,
            showAfter: true,
          });
          set({ state: await ipc.readState(), error: null, errorKind: null });
        } catch (error) {
          set({ error: message(error), errorKind: kindOf(error) });
        } finally {
          set({ uploads: Math.max(0, get().uploads - 1), progress: null });
        }
      }
    },

    setOnboarded: (v) => {
      saveJSON(LS_ONBOARDED, v);
      set({ onboarded: v, showOnboarding: !v });
    },
    setShowOnboarding: (v) => set({ showOnboarding: v }),
    setNotice: (msg, kind = "success") => set({ notice: msg, noticeKind: msg ? kind : null }),
    setAnimationsPaused: (v) => set({ animationsPaused: v }),
    setShowWriteConfirm: (v) => set({ showWriteConfirm: v }),
  };
});
