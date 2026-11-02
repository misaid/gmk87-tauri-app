import { create } from "zustand";
import * as ipc from "./lib/ipc";
import { DEFAULT_CROP, type CropParams } from "./lib/crop";
import { otherSlotFrames } from "./lib/budget";

export type Slot = "slot0" | "slot1";

interface AppStore {
  devices: ipc.DeviceInfo[];
  state: ipc.DeviceState | null;
  connected: boolean;
  error: string | null;
  errorKind: string | null;
  presets: ipc.Preset[];
  crop: CropParams;
  slot: Slot;
  source: { bytes: Uint8Array; name: string } | null;
  sourceInfo: ipc.SourceInfo | null;
  totalFrames: number;
  delayMs: number;
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

export const useAppStore = create<AppStore>((set, get) => ({
  devices: [],
  state: null,
  connected: false,
  error: null,
  errorKind: null,
  presets: [],
  crop: { ...DEFAULT_CROP },
  slot: "slot0",
  source: null,
  sourceInfo: null,
  totalFrames: 0,
  delayMs: 100,
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
    set({ crop });
    get().schedulePreview();
  },
  setSlot: (slot) => {
    set({ slot });
    const { sourceInfo, state } = get();
    if (sourceInfo) {
      set({ totalFrames: sourceInfo.frames + otherSlotFrames(state, slot) });
    }
  },
  loadSource: async (bytes, name) => {
    set({ source: { bytes, name }, sourceInfo: null });
    void get().refreshPreview();
    try {
      const info = await ipc.inspectSource(bytes, get().crop);
      set({
        sourceInfo: info,
        delayMs: info.delayMs,
        totalFrames: info.frames + otherSlotFrames(get().state, get().slot),
      });
    } catch (error) {
      set({ error: message(error), errorKind: kindOf(error) });
    }
  },
  setDelayMs: (delayMs) => set({ delayMs }),

  schedulePreview: () => {
    const existing = get().previewTimer;
    if (existing !== null) window.clearTimeout(existing);
    const id = window.setTimeout(() => {
      set({ previewTimer: null });
      void get().refreshPreview();
    }, 80);
    set({ previewTimer: id });
  },

  refreshPreview: async () => {
    const { source, crop } = get();
    if (!source) {
      set({ previewUrl: null });
      return;
    }
    try {
      const png = await ipc.previewDisplay(source.bytes, crop);
      const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      set((state) => {
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        return { previewUrl: url, error: null, errorKind: null };
      });
    } catch (error) {
      set({ error: message(error), errorKind: kindOf(error) });
    }
  },

  upload: async (delayMs, showAfter) => {
    const { source, crop, slot } = get();
    if (!source) {
      set({ error: "Choose an image or GIF first." });
      return;
    }
    set({ uploads: get().uploads + 1, progress: { bytesSent: 0, totalBytes: 0 } });
    try {
      await ipc.uploadDisplay({
        slot,
        bytes: Array.from(source.bytes),
        crop,
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
