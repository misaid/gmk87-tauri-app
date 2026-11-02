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
  bytes: number[];
  crop: { offsetX: number; offsetY: number; zoom: number; fit: Fit };
  delayMs: number;
  showAfter: boolean;
}

export interface UploadProgress {
  bytesSent: number;
  totalBytes: number;
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
export function previewDisplay(bytes: Uint8Array, crop: CropParams): Promise<number[]> {
  return invoke("preview_display", {
    job: {
      bytes: Array.from(bytes),
      crop: { ...crop, fit: crop.fit as Fit },
    },
  });
}
export function uploadDisplay(job: DisplayJob): Promise<void> {
  return invoke("upload_display", { job });
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
