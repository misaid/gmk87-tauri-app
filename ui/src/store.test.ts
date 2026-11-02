import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/ipc", () => ({
  listDevices: vi.fn(async () => [
    {
      path: "/dev/hidraw12",
      label: "GMK87 (wired)",
      transport: "wired",
      productId: 0x5055,
      hasVia: true,
    },
  ]),
  connect: vi.fn(async () => ({ connected: true }) as never),
  disconnect: vi.fn(async () => {}),
  readState: vi.fn(),
  setLighting: vi.fn(),
  syncClock: vi.fn(),
  listPresets: vi.fn(async () => []),
  applyPreset: vi.fn(),
  previewDisplay: vi.fn(async () => [137, 80, 78, 71]),
  inspectSource: vi.fn(async () => ({ isGif: false, frames: 1, delayMs: 100 })),
  uploadDisplay: vi.fn(async () => {}),
  cancelUpload: vi.fn(async () => {}),
  copyDiagnostics: vi.fn(),
}));

import { useAppStore } from "./store";

describe("store", () => {
  beforeEach(() => {
    useAppStore.setState({
      devices: [],
      connected: false,
      error: null,
      source: null,
      previewUrl: null,
    });
  });

  it("loads devices", async () => {
    await useAppStore.getState().refreshDevices();
    expect(useAppStore.getState().devices).toHaveLength(1);
  });

  it("refuses to upload without a source", async () => {
    await useAppStore.getState().upload(100, true);
    expect(useAppStore.getState().error).toContain("Choose an image");
  });

  it("produces a preview URL once a source is loaded", async () => {
    useAppStore.getState().loadSource(new Uint8Array([1, 2, 3]), "x.png");
    await vi.waitFor(() => expect(useAppStore.getState().previewUrl).not.toBeNull());
  });

  it("records upload progress from the event", () => {
    useAppStore.getState().setProgress({ bytesSent: 50, totalBytes: 100 });
    expect(useAppStore.getState().progress).toEqual({ bytesSent: 50, totalBytes: 100 });
  });

  it("marks the device disconnected when the event fires", () => {
    useAppStore.setState({ connected: true, state: { connected: true } as never });
    useAppStore.getState().handleDisconnected();
    expect(useAppStore.getState().connected).toBe(false);
    expect(useAppStore.getState().state).toBeNull();
  });

  it("revokes the previous preview URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    useAppStore.setState({ source: { bytes: new Uint8Array([1]), name: "x.png" } });
    await useAppStore.getState().refreshPreview();
    const first = useAppStore.getState().previewUrl;
    await useAppStore.getState().refreshPreview();
    expect(revoke).toHaveBeenCalledWith(first);
    revoke.mockRestore();
  });

  it("debounces the preview while dragging", async () => {
    vi.useFakeTimers();
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.previewDisplay).mockClear();
    useAppStore.setState({ source: { bytes: new Uint8Array([1]), name: "x.png" } });
    useAppStore.getState().setCrop({ offsetX: 0.1, offsetY: 0, zoom: 1, fit: "cover" });
    useAppStore.getState().setCrop({ offsetX: 0.2, offsetY: 0, zoom: 1, fit: "cover" });
    await vi.advanceTimersByTimeAsync(120);
    expect(vi.mocked(ipc.previewDisplay)).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
