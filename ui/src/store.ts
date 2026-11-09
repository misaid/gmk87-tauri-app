import { create } from "zustand";
import * as ipc from "./lib/ipc";
import { DEFAULT_CROP, type CropParams } from "./lib/crop";
import { MAX_TOTAL_FRAMES } from "./lib/budget";

/** Orders async preview renders so a slow, stale one cannot overwrite a newer. */
let previewSequence = 0;

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
}

function emptyEntry(): SlotEntry {
  return { source: null, name: "", info: null, crop: { ...DEFAULT_CROP }, delayMs: 100 };
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
  /** Write-confirm modal open (draft commit is destructive — needs a diff). */
  showWriteConfirm: boolean;

  refreshDevices: () => Promise<void>;
  connectTo: (path: string) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  setCrop: (crop: CropParams) => void;
  setSlot: (slot: Slot) => void;
  loadSource: (bytes: Uint8Array, name: string) => void;
  loadStoredDisplay: () => Promise<void>;
  setDelayMs: (ms: number) => void;
  refreshPreview: () => Promise<void>;
  schedulePreview: () => void;
  upload: (delayMs: number, showAfter: boolean) => Promise<void>;
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
      crop: { ...entries.slot0.crop },
      info: entries.slot0.info ? { ...entries.slot0.info, dropped: [...entries.slot0.info.dropped] } : null,
    },
    slot1: {
      ...entries.slot1,
      source: entries.slot1.source ? new Uint8Array(entries.slot1.source) : null,
      crop: { ...entries.slot1.crop },
      info: entries.slot1.info ? { ...entries.slot1.info, dropped: [...entries.slot1.info.dropped] } : null,
    },
  };
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

  return {
    devices: [],
    state: null,
    connected: false,
    connectingPath: null,
    activeTab: "device",
    setActiveTab: (activeTab) => set({ activeTab }),
    error: null,
    errorKind: null,
    presets: [],
    entries: { slot0: emptyEntry(), slot1: emptyEntry() },
    slot: "slot0",
    previewUrl: null,
    progress: null,
    uploads: 0,
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
    showWriteConfirm: false,

    refreshDevices: async () => {
      try {
        set({ devices: await ipc.listDevices() });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    connectTo: async (path) => {
      set({ connectingPath: path });
      try {
        const state = await ipc.connect(path);
        const queued = get().draft;
        set({ state, connected: state.connected, error: null, errorKind: null, draft: queued, draftDirty: queued != null ? JSON.stringify(patchFromState(queued)) !== JSON.stringify(patchFromState(state)) : false });
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
      set({ state: null, connected: false });
    },

    setCrop: (crop) => {
      set((state) => withEntry(state, state.slot, { crop }));
      get().schedulePreview();
    },
    setSlot: (slot) => {
      set({ slot });
      void get().refreshPreview();
    },
    loadSource: async (bytes, name) => {
      const { slot } = get();
      set((state) => withEntry(state, slot, { source: bytes, name, info: null }));
      void get().refreshPreview();
      try {
        const maxFrames = Math.max(0, selectRemainingFor(get(), slot));
        const info = await ipc.inspectSource(bytes, get().entries[slot].crop, maxFrames);
        set((state) => withEntry(state, slot, { info, delayMs: info.delayMs }));
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
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
        // Stored contents are what the board holds — the undo baseline.
        set({ lastUploaded: cloneEntries(get().entries) });
        await get().refreshPreview();
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },
    setDelayMs: (delayMs) => set((state) => withEntry(state, state.slot, { delayMs })),

    schedulePreview: () => {
      // Coalesce renders to one per frame-ish interval. This is a throttle, not
      // a trailing debounce: a debounce reset the timer on every pointer move,
      // so a continuous drag showed nothing until the pointer stopped.
      if (get().previewTimer !== null) return;
      const id = window.setTimeout(() => {
        set({ previewTimer: null });
        void get().refreshPreview();
      }, 33);
      set({ previewTimer: id });
    },

    refreshPreview: async () => {
      const sequence = ++previewSequence;
      const { entries, slot } = get();
      const entry = entries[slot];
      if (!entry.source) {
        set({ previewUrl: null });
        return;
      }
      try {
        const png = await ipc.previewDisplay(entry.source, entry.crop);
        // A newer crop or slot switch has already started; its result wins.
        if (sequence !== previewSequence) return;
        const blob = new Blob([png], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        set((state) => {
          if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
          return { previewUrl: url, error: null, errorKind: null };
        });
      } catch (error) {
        if (sequence !== previewSequence) return;
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    upload: async (delayMs, showAfter) => {
      const { entries, slot, lastUploaded } = get();
      const entry = entries[slot];
      if (!entry.source) {
        set({ error: "Choose an image or GIF first." });
        return;
      }
      // Undo snapshot = what the board showed BEFORE this upload overwrote it,
      // not the staging entries (which already contain the new image).
      const previousBoard = lastUploaded ?? { slot0: emptyEntry(), slot1: emptyEntry() };
      const snapshot: DisplayHistoryEntry = {
        entries: cloneEntries(previousBoard),
        slot,
        delayMs: previousBoard[slot]?.delayMs ?? delayMs,
        at: Date.now(),
        label: previousBoard[slot]?.name || `Slot ${slot === "slot0" ? "0" : "1"} (previous)`,
      };
      set({ uploads: get().uploads + 1, progress: { bytesSent: 0, totalBytes: 0 } });
      try {
        await ipc.uploadDisplay({
          slot,
          name: entry.name,
          bytes: entry.source,
          crop: entry.crop,
          delayMs,
          showAfter,
        });
        set({
          state: await ipc.readState(),
          error: null,
          errorKind: null,
          displayHistory: [...get().displayHistory.slice(-9), snapshot],
          lastUploaded: cloneEntries(entries),
        });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      } finally {
        set({ uploads: Math.max(0, get().uploads - 1), progress: null });
      }
    },

    cancel: async () => {
      await ipc.cancelUpload();
    },

    setProgress: (progress) => set({ progress }),

    handleDisconnected: () =>
      set({
        connected: false,
        connectingPath: null,
        state: null,
        draft: null,
        draftDirty: false,
        error: "The keyboard was disconnected. Reconnect from the Device screen.",
        errorKind: null,
      }),

    applyLighting: async (patch) => {
      const prev = get().state;
      try {
        const next = await ipc.setLighting(patch);
        const history = prev ? [...get().lightingHistory.slice(-19), { state: prev, at: Date.now(), label: "before write" }] : get().lightingHistory;
        saveJSON(LS_HISTORY, history);
        set({ state: next, error: null, errorKind: null, draft: null, draftDirty: false, lightingHistory: history, lastSyncedAt: Date.now() });
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
        set({ presets: await ipc.listPresets() });
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
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
      set({ draft: next, draftDirty: dirty, lastDiscardedDraft: null });
      saveJSON(LS_DRAFT, next);
    },

    commitDraft: async () => {
      const { draft, state: prev } = get();
      if (!draft) return;
      try {
        const next = await ipc.setLighting(patchFromState(draft));
        const history = prev
          ? [...get().lightingHistory.slice(-19), { state: prev, at: Date.now(), label: "before draft write" }]
          : get().lightingHistory;
        saveJSON(LS_HISTORY, history);
        set({ state: next, draft: null, draftDirty: false, lightingHistory: history, lastSyncedAt: Date.now(), error: null, errorKind: null, notice: "Lighting written ✓" });
        clearKey(LS_DRAFT);
      } catch (error) {
        set({ error: message(error), errorKind: kindOf(error) });
      }
    },

    discardDraft: () => {
      const { draft } = get();
      if (!draft) return;
      set({ draft: null, draftDirty: false, lastDiscardedDraft: draft, notice: "Draft discarded — Undo is in the Lighting bar." });
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
        set({ state: next, draft: null, draftDirty: false, lightingHistory: rest, lastSyncedAt: Date.now(), error: null, errorKind: null, notice: "Lighting undone ✓" });
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
