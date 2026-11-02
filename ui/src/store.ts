import { create } from "zustand";
import * as ipc from "./lib/ipc";
import { DEFAULT_CROP, type CropParams } from "./lib/crop";

export type Slot = "slot0" | "slot1";

interface AppStore {
  devices: ipc.DeviceInfo[];
  state: ipc.DeviceState | null;
  connected: boolean;
  error: string | null;
  crop: CropParams;
  slot: Slot;
  source: { bytes: Uint8Array; name: string } | null;
  previewUrl: string | null;
  progress: ipc.UploadProgress | null;
  uploads: number;

  refreshDevices: () => Promise<void>;
  connectTo: (path: string) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  setCrop: (crop: CropParams) => void;
  setSlot: (slot: Slot) => void;
  loadSource: (bytes: Uint8Array, name: string) => void;
  refreshPreview: () => Promise<void>;
  upload: (delayMs: number, showAfter: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  applyLighting: (patch: ipc.LightingPatch) => Promise<void>;
  applyPreset: (name: string) => Promise<void>;
  syncClock: () => Promise<void>;
  dismissError: () => void;
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
  crop: { ...DEFAULT_CROP },
  slot: "slot0",
  source: null,
  previewUrl: null,
  progress: null,
  uploads: 0,

  refreshDevices: async () => {
    try {
      set({ devices: await ipc.listDevices() });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  connectTo: async (path) => {
    try {
      const state = await ipc.connect(path);
      set({ state, connected: state.connected, error: null });
      await get().refreshPreview();
    } catch (error) {
      set({ error: message(error) });
    }
  },

  disconnectDevice: async () => {
    await ipc.disconnect();
    set({ state: null, connected: false });
  },

  setCrop: (crop) => {
    set({ crop });
    void get().refreshPreview();
  },
  setSlot: (slot) => set({ slot }),
  loadSource: (bytes, name) => {
    set({ source: { bytes, name } });
    void get().refreshPreview();
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
      set({ previewUrl: URL.createObjectURL(blob), error: null });
    } catch (error) {
      set({ error: message(error) });
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
      set({ state: await ipc.readState(), error: null });
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ uploads: Math.max(0, get().uploads - 1), progress: null });
    }
  },

  cancel: async () => {
    await ipc.cancelUpload();
  },

  applyLighting: async (patch) => {
    try {
      set({ state: await ipc.setLighting(patch), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  applyPreset: async (name) => {
    try {
      set({ state: await ipc.applyPreset(name), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  syncClock: async () => {
    try {
      set({ state: await ipc.syncClock(), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  dismissError: () => set({ error: null }),
}));
