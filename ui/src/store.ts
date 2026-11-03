import { create } from "zustand";
import * as ipc from "./lib/ipc";
import { DEFAULT_CROP, type CropParams } from "./lib/crop";
import { MAX_TOTAL_FRAMES } from "./lib/budget";

/** Orders async preview renders so a slow, stale one cannot overwrite a newer. */
let previewSequence = 0;

export type Slot = "slot0" | "slot1";

export const SLOTS: Slot[] = ["slot0", "slot1"];

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

interface AppStore {
  devices: ipc.DeviceInfo[];
  state: ipc.DeviceState | null;
  connected: boolean;
  error: string | null;
  errorKind: string | null;
  presets: ipc.Preset[];
  entries: Record<Slot, SlotEntry>;
  slot: Slot;
  previewUrl: string | null;
  progress: ipc.UploadProgress | null;
  uploads: number;
  previewTimer: number | null;

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

function withEntry(
  state: AppStore,
  slot: Slot,
  patch: Partial<SlotEntry>,
): Pick<AppStore, "entries"> {
  return { entries: { ...state.entries, [slot]: { ...state.entries[slot], ...patch } } };
}

export const useAppStore = create<AppStore>((set, get) => ({
  devices: [],
  state: null,
  connected: false,
  error: null,
  errorKind: null,
  presets: [],
  entries: { slot0: emptyEntry(), slot1: emptyEntry() },
  slot: "slot0",
  previewUrl: null,
  progress: null,
  uploads: 0,
  previewTimer: null,

  refreshDevices: async () => {
    try {
      set({ devices: await ipc.listDevices() });
    } catch (error) {
      set({ error: message(error), errorKind: kindOf(error) });
    }
  },

  connectTo: async (path) => {
    try {
      const state = await ipc.connect(path);
      set({ state, connected: state.connected, error: null, errorKind: null });
      await get().refreshPreview();
    } catch (error) {
      set({ error: message(error), errorKind: kindOf(error) });
    }
  },

  disconnectDevice: async () => {
    await ipc.disconnect();
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
    const { entries, slot } = get();
    const entry = entries[slot];
    if (!entry.source) {
      set({ error: "Choose an image or GIF first." });
      return;
    }
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
      set({ state: await ipc.readState(), error: null, errorKind: null });
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
      state: null,
      error: "The keyboard was disconnected. Reconnect from the Device screen.",
      errorKind: null,
    }),

  applyLighting: async (patch) => {
    try {
      set({ state: await ipc.setLighting(patch), error: null, errorKind: null });
    } catch (error) {
      set({ error: message(error), errorKind: kindOf(error) });
    }
  },
  applyPreset: async (name) => {
    try {
      set({ state: await ipc.applyPreset(name), error: null, errorKind: null });
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
      set({ state: await ipc.syncClock(), error: null, errorKind: null });
    } catch (error) {
      set({ error: message(error), errorKind: kindOf(error) });
    }
  },
  dismissError: () => set({ error: null, errorKind: null }),
}));
