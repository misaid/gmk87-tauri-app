import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CropParams, Fit } from "./crop";

export interface DeviceInfo {
  path: string;
  label: string;
  transport: "wired" | "wireless24g";
  productId: number;
  hasVia: boolean;
}

export interface DeviceState {
  connected: boolean;
  synced: boolean;
  underglow: {
    effect: number;
    brightness: number;
    speed: number;
    orientation: number;
    rainbow: number;
    color: [number, number, number];
  };
  led: { mode: number; saturation: number; rainbow: number; color: number };
  winLock: boolean;
  show: number;
  slot0Frames: number;
  slot1Frames: number;
  frameDelayMs: number;
  time: [number, number, number, number, number, number, number];
}

export interface Preset {
  name: string;
  description: string;
}

export interface LightingPatch {
  underglowEffect?: number;
  underglowBrightness?: number;
  underglowSpeed?: number;
  underglowOrientation?: number;
  underglowRainbow?: number;
  underglowColor?: [number, number, number];
  winLock?: boolean;
  ledMode?: number;
  ledSaturation?: number;
  ledRainbow?: number;
  ledColor?: number;
}

export interface DisplayJob {
  slot: "slot0" | "slot1";
  name: string;
  bytes: Uint8Array;
  crop: { offsetX: number; offsetY: number; zoom: number; fit: Fit };
  delayMs: number;
  showAfter: boolean;
}

/**
 * Image bytes are sent as a raw IPC body and the small JSON metadata rides in
 * a header. Sending them as `number[]` in the JSON payload costs roughly an
 * order of magnitude more to serialise and blocks the webview for large GIFs.
 */
const JOB_HEADER = "x-gmk87-job";

function invokeBytes<T>(command: string, bytes: Uint8Array, meta: unknown): Promise<T> {
  return invoke<T>(command, bytes, { headers: { [JOB_HEADER]: JSON.stringify(meta) } });
}

export interface UploadProgress {
  bytesSent: number;
  totalBytes: number;
}

export interface SourceInfo {
  isGif: boolean;
  frames: number;
  delayMs: number;
  /** Frames the source held before any compression. */
  sourceFrames: number;
  /** Source frame indices dropped to fit the slot's remaining budget. */
  dropped: number[];
}

export interface StoredSlotMeta {
  name: string;
  isGif: boolean;
  frames: number;
  sourceFrames: number;
  dropped: number[];
  delayMs: number;
  crop: { offsetX: number; offsetY: number; zoom: number; fit: Fit };
}

export interface StoredSlot extends StoredSlotMeta {
  bytes: Uint8Array | null;
}

export interface StoredDisplay {
  slot0: StoredSlot | null;
  slot1: StoredSlot | null;
}

export interface AppError {
  kind: string;
  message: string;
}

export function listDevices(): Promise<DeviceInfo[]> {
  return invoke("list_devices");
}
export function connect(path: string): Promise<DeviceState> {
  return invoke("connect", { path });
}
export function disconnect(): Promise<void> {
  return invoke("disconnect");
}
export function readState(): Promise<DeviceState> {
  return invoke("read_state");
}
export function setLighting(patch: LightingPatch): Promise<DeviceState> {
  return invoke("set_lighting", { patch });
}
export function syncClock(): Promise<DeviceState> {
  return invoke("sync_clock");
}
export function listPresets(): Promise<Preset[]> {
  return invoke("list_presets");
}
export function applyPreset(name: string): Promise<DeviceState> {
  return invoke("apply_preset", { name });
}
export async function previewDisplay(
  bytes: Uint8Array,
  crop: CropParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await invokeBytes<ArrayBuffer>("preview_display", bytes, { crop });
  return new Uint8Array(buffer);
}
export function inspectSource(
  bytes: Uint8Array,
  crop: CropParams,
  maxFrames: number,
): Promise<SourceInfo> {
  return invokeBytes("inspect_source", bytes, { crop, maxFrames });
}
async function loadDisplaySource(slot: "slot0" | "slot1"): Promise<Uint8Array | null> {
  const buffer = await invoke<ArrayBuffer>("load_display_source", { target: slot });
  const bytes = new Uint8Array(buffer);
  return bytes.byteLength > 0 ? bytes : null;
}
export async function loadDisplayStore(): Promise<StoredDisplay> {
  const meta = await invoke<{ slot0: StoredSlotMeta | null; slot1: StoredSlotMeta | null }>(
    "load_display_store",
  );
  const [slot0, slot1] = await Promise.all([
    loadDisplaySource("slot0"),
    loadDisplaySource("slot1"),
  ]);
  return {
    slot0: meta.slot0 ? { ...meta.slot0, bytes: slot0 } : null,
    slot1: meta.slot1 ? { ...meta.slot1, bytes: slot1 } : null,
  };
}
export function uploadDisplay(job: DisplayJob): Promise<void> {
  const { bytes, ...meta } = job;
  return invokeBytes("upload_display", bytes, meta);
}
export function cancelUpload(): Promise<void> {
  return invoke("cancel_upload");
}
export function copyDiagnostics(): Promise<string> {
  return invoke("copy_diagnostics");
}
export function onUploadProgress(
  handler: (progress: UploadProgress) => void,
): Promise<UnlistenFn> {
  return listen<UploadProgress>("upload://progress", (event) => handler(event.payload));
}
export function onDeviceDisconnected(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>("device://disconnected", (event) => handler(event.payload));
}
