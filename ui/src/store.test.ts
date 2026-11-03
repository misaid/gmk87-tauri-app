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
  previewDisplay: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
  inspectSource: vi.fn(async () => ({
    isGif: false,
    frames: 1,
    delayMs: 100,
    sourceFrames: 1,
    dropped: [],
  })),
  loadDisplayStore: vi.fn(async () => ({ slot0: null, slot1: null })),
  uploadDisplay: vi.fn(async () => {}),
  cancelUpload: vi.fn(async () => {}),
  copyDiagnostics: vi.fn(),
}));

import { DEFAULT_CROP } from "./lib/crop";
import { useAppStore, type SlotEntry } from "./store";

function emptyEntry(): SlotEntry {
  return { source: null, name: "", info: null, crop: { ...DEFAULT_CROP }, delayMs: 100 };
}

describe("store", () => {
  beforeEach(() => {
    useAppStore.setState({
      devices: [],
      connected: false,
      error: null,
      slot: "slot0",
      entries: { slot0: emptyEntry(), slot1: emptyEntry() },
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

  it("keeps a separate source and crop per slot", async () => {
    useAppStore.getState().loadSource(new Uint8Array([1]), "a.png");
    useAppStore.getState().setSlot("slot1");
    useAppStore.getState().loadSource(new Uint8Array([2]), "b.png");
    await vi.waitFor(() => expect(useAppStore.getState().entries.slot1.info).not.toBeNull());

    const { entries } = useAppStore.getState();
    expect(entries.slot0.name).toBe("a.png");
    expect(entries.slot1.name).toBe("b.png");
    expect(Array.from(entries.slot0.source!)).toEqual([1]);
    expect(Array.from(entries.slot1.source!)).toEqual([2]);
  });

  it("inspects with the other slot's frames subtracted", async () => {
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.inspectSource).mockClear();
    useAppStore.setState({
      state: { connected: true, slot0Frames: 1, slot1Frames: 10 } as never,
      slot: "slot0",
    });
    useAppStore.getState().loadSource(new Uint8Array([9]), "x.gif");
    await vi.waitFor(() => expect(vi.mocked(ipc.inspectSource)).toHaveBeenCalled());
    const call = vi.mocked(ipc.inspectSource).mock.calls.at(-1)!;
    expect(call[2]).toBe(26);
  });

  it("rehydrates both slots from the stored display", async () => {
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.loadDisplayStore).mockResolvedValueOnce({
      slot0: {
        name: "a.gif",
        isGif: true,
        frames: 5,
        sourceFrames: 40,
        dropped: [1, 2],
        delayMs: 111,
        crop: { offsetX: 0.1, offsetY: 0, zoom: 1, fit: "cover" },
        bytes: new Uint8Array([1, 2, 3]),
      },
      slot1: null,
    });
    await useAppStore.getState().loadStoredDisplay();
    const entry = useAppStore.getState().entries.slot0;
    expect(entry.name).toBe("a.gif");
    expect(entry.info?.frames).toBe(5);
    expect(entry.delayMs).toBe(111);
    expect(Array.from(entry.source!)).toEqual([1, 2, 3]);
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
    useAppStore.setState((s) => ({
      entries: {
        ...s.entries,
        slot0: { ...s.entries.slot0, source: new Uint8Array([1]), name: "x.png" },
      },
    }));
    await useAppStore.getState().refreshPreview();
    const first = useAppStore.getState().previewUrl;
    await useAppStore.getState().refreshPreview();
    expect(revoke).toHaveBeenCalledWith(first);
    revoke.mockRestore();
  });

  it("throttles the preview during a continuous drag", async () => {
    vi.useFakeTimers();
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.previewDisplay).mockClear();
    useAppStore.setState((s) => ({
      entries: {
        ...s.entries,
        slot0: { ...s.entries.slot0, source: new Uint8Array([1]), name: "x.png" },
      },
    }));
    // A stream of pointer moves must still refresh while the drag continues,
    // rather than only after the pointer stops.
    useAppStore.getState().setCrop({ offsetX: 0.1, offsetY: 0, zoom: 1, fit: "cover" });
    useAppStore.getState().setCrop({ offsetX: 0.2, offsetY: 0, zoom: 1, fit: "cover" });
    await vi.advanceTimersByTimeAsync(40);
    expect(vi.mocked(ipc.previewDisplay)).toHaveBeenCalledTimes(1);
    useAppStore.getState().setCrop({ offsetX: 0.3, offsetY: 0, zoom: 1, fit: "cover" });
    await vi.advanceTimersByTimeAsync(40);
    expect(vi.mocked(ipc.previewDisplay)).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
