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
      connectingPath: null,
      activeTab: "device",
      error: null,
      slot: "slot0",
      entries: { slot0: emptyEntry(), slot1: emptyEntry() },
      previewUrl: null,
      draft: null,
      draftDirty: false,
      lightingHistory: [],
      displayHistory: [],
      lastUploaded: null,
      state: null,
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

  it("debounces the backend preview until the crop settles", async () => {
    vi.useFakeTimers();
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.previewDisplay).mockClear();
    useAppStore.setState((s) => ({
      entries: {
        ...s.entries,
        slot0: { ...s.entries.slot0, source: new Uint8Array([1]), name: "x.png" },
      },
    }));
    for (let i = 1; i <= 20; i++) {
      useAppStore.getState().setCrop({ offsetX: i / 100, offsetY: 0, zoom: 1, fit: "cover" });
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(vi.mocked(ipc.previewDisplay)).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(vi.mocked(ipc.previewDisplay)).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("switches slots without any backend call once both are rendered", async () => {
    const ipc = await import("./lib/ipc");
    useAppStore.getState().loadSource(new Uint8Array([1]), "a.png");
    useAppStore.getState().setSlot("slot1");
    useAppStore.getState().loadSource(new Uint8Array([2]), "b.png");
    await vi.waitFor(() => expect(useAppStore.getState().entries.slot1.previewUrl).toBeTruthy());
    await vi.waitFor(() => expect(useAppStore.getState().entries.slot0.previewUrl).toBeTruthy());
    const spies = [ipc.previewDisplay, ipc.inspectSource, ipc.loadDisplayStore].map((f) => vi.mocked(f));
    spies.forEach((f) => f.mockClear());
    for (let i = 0; i < 10; i++) {
      useAppStore.getState().setSlot(i % 2 ? "slot1" : "slot0");
    }
    await new Promise((r) => setTimeout(r, 50));
    spies.forEach((f) => expect(f).not.toHaveBeenCalled());
    expect(useAppStore.getState().previewUrl).toBe(useAppStore.getState().entries.slot1.previewUrl);
  });

  it("tracks connectingPath while a connect is in flight and clears it on success", async () => {
    const ipc = await import("./lib/ipc");
    let resolveConnect: (value: { connected: true }) => void = () => {};
    vi.mocked(ipc.connect).mockImplementationOnce(
      () => new Promise((resolve) => { resolveConnect = resolve as never; }),
    );
    const pending = useAppStore.getState().connectTo("/dev/hidraw12");
    expect(useAppStore.getState().connectingPath).toBe("/dev/hidraw12");
    resolveConnect({ connected: true });
    await pending;
    expect(useAppStore.getState().connectingPath).toBeNull();
  });

  it("clears connectingPath when connect fails", async () => {
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.connect).mockRejectedValueOnce(new Error("boom"));
    await useAppStore.getState().connectTo("/dev/hidraw12");
    expect(useAppStore.getState().connectingPath).toBeNull();
  });

  it("stages lighting edits as a draft without writing to the board", async () => {
    const ipc = await import("./lib/ipc");
    const boardState = {
      connected: true,
      synced: true,
      underglow: { effect: 6, brightness: 5, speed: 4, orientation: 0, rainbow: 0, color: [0, 0, 255] as [number, number, number] },
      led: { mode: 3, saturation: 5, rainbow: 0, color: 0 },
      winLock: false,
      show: 0,
      slot0Frames: 1,
      slot1Frames: 1,
      frameDelayMs: 100,
      time: [2026, 11, 9, 0, 12, 0, 0] as [number, number, number, number, number, number, number],
    };
    useAppStore.setState({ state: boardState as never, draft: null, draftDirty: false, lightingHistory: [] });
    vi.mocked(ipc.setLighting).mockClear();

    useAppStore.getState().setLightingDraft({ underglowEffect: 11 });
    expect(vi.mocked(ipc.setLighting)).not.toHaveBeenCalled();
    expect(useAppStore.getState().draftDirty).toBe(true);
    expect(useAppStore.getState().draft?.underglow.effect).toBe(11);
    // Committed state is untouched until the draft is written.
    expect(useAppStore.getState().state?.underglow.effect).toBe(6);
  });

  it("commits a draft and records undo history", async () => {
    const ipc = await import("./lib/ipc");
    const boardState = {
      connected: true,
      synced: true,
      underglow: { effect: 6, brightness: 5, speed: 4, orientation: 0, rainbow: 0, color: [0, 0, 255] as [number, number, number] },
      led: { mode: 3, saturation: 5, rainbow: 0, color: 0 },
      winLock: false,
      show: 0,
      slot0Frames: 1,
      slot1Frames: 1,
      frameDelayMs: 100,
      time: [2026, 11, 9, 0, 12, 0, 0] as [number, number, number, number, number, number, number],
    };
    const nextState = { ...boardState, underglow: { ...boardState.underglow, effect: 11 } };
    vi.mocked(ipc.setLighting).mockResolvedValueOnce(nextState as never);
    useAppStore.setState({ state: boardState as never, draft: null, draftDirty: false, lightingHistory: [] });

    useAppStore.getState().setLightingDraft({ underglowEffect: 11 });
    await useAppStore.getState().commitDraft();
    expect(vi.mocked(ipc.setLighting)).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().draftDirty).toBe(false);
    expect(useAppStore.getState().draft).toBeNull();
    expect(useAppStore.getState().lightingHistory).toHaveLength(1);
    expect(useAppStore.getState().lightingHistory[0].state.underglow.effect).toBe(6);
  });

  it("keeps an edit made while a write is in flight, and applies live by default", async () => {
    const ipc = await import("./lib/ipc");
    expect(useAppStore.getState().autoApply).toBe(true);
    vi.mocked(ipc.setLighting).mockClear();
    const mk = (effect: number) => ({
      connected: true, synced: true,
      underglow: { effect, brightness: 5, speed: 4, orientation: 0, rainbow: 0, color: [0, 0, 255] as [number, number, number] },
      led: { mode: 3, saturation: 5, rainbow: 0, color: 0 }, winLock: false, show: 0, slot0Frames: 1, slot1Frames: 1, frameDelayMs: 100,
      time: [2026, 11, 9, 0, 12, 0, 0] as [number, number, number, number, number, number, number],
    });
    let release: (v: never) => void = () => {};
    vi.mocked(ipc.setLighting).mockImplementationOnce(() => new Promise((r) => { release = r as never; }));
    useAppStore.setState({ state: mk(6) as never, draft: null, draftDirty: false, lightingHistory: [] });
    useAppStore.getState().setLightingDraft({ underglowEffect: 11 });
    const writing = useAppStore.getState().commitDraft();
    // A second commit while one is in flight is ignored; a newer edit stays staged.
    void useAppStore.getState().commitDraft();
    useAppStore.getState().setLightingDraft({ underglowEffect: 14 });
    release(mk(11) as never);
    await writing;
    expect(vi.mocked(ipc.setLighting)).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().state?.underglow.effect).toBe(11);
    expect(useAppStore.getState().draftDirty).toBe(true);
    expect(useAppStore.getState().draft?.underglow.effect).toBe(14);
  });

  it("undoes a lighting write to the previous board state", async () => {
    const ipc = await import("./lib/ipc");
    const prev = {
      connected: true,
      synced: true,
      underglow: { effect: 6, brightness: 5, speed: 4, orientation: 0, rainbow: 0, color: [0, 0, 255] as [number, number, number] },
      led: { mode: 3, saturation: 5, rainbow: 0, color: 0 },
      winLock: false,
      show: 0,
      slot0Frames: 1,
      slot1Frames: 1,
      frameDelayMs: 100,
      time: [2026, 11, 9, 0, 12, 0, 0] as [number, number, number, number, number, number, number],
    };
    const current = { ...prev, underglow: { ...prev.underglow, effect: 11 } };
    vi.mocked(ipc.setLighting).mockResolvedValueOnce(prev as never);
    useAppStore.setState({ state: current as never, lightingHistory: [prev as never], draft: null, draftDirty: false });

    await useAppStore.getState().undoLighting();
    expect(useAppStore.getState().state?.underglow.effect).toBe(6);
    expect(useAppStore.getState().lightingHistory).toHaveLength(0);
  });

  it("undoes a display upload by restoring the previous entries", async () => {
    const ipc = await import("./lib/ipc");
    vi.mocked(ipc.inspectSource).mockResolvedValue({
      isGif: false,
      frames: 1,
      delayMs: 100,
      sourceFrames: 1,
      dropped: [],
    });
    vi.mocked(ipc.uploadDisplay).mockResolvedValueOnce(undefined as never);
    const boardState = {
      connected: true,
      slot0Frames: 1,
      slot1Frames: 1,
    };
    useAppStore.setState({ state: boardState as never, entries: { slot0: emptyEntry(), slot1: emptyEntry() }, slot: "slot0", displayHistory: [] });
    useAppStore.getState().loadSource(new Uint8Array([1]), "first.png");
    await vi.waitFor(() => expect(useAppStore.getState().entries.slot0.info).not.toBeNull());
    vi.mocked(ipc.readState).mockResolvedValueOnce(boardState as never);
    await useAppStore.getState().upload(100, true);
    expect(useAppStore.getState().displayHistory).toHaveLength(1);

    useAppStore.getState().loadSource(new Uint8Array([2]), "second.png");
    await vi.waitFor(() => expect(useAppStore.getState().entries.slot0.name).toBe("second.png"));
    vi.mocked(ipc.uploadDisplay).mockResolvedValueOnce(undefined as never);
    vi.mocked(ipc.readState).mockResolvedValueOnce(boardState as never);
    await useAppStore.getState().upload(100, true);
    expect(useAppStore.getState().displayHistory).toHaveLength(2);

    vi.mocked(ipc.uploadDisplay).mockResolvedValueOnce(undefined as never);
    vi.mocked(ipc.readState).mockResolvedValueOnce(boardState as never);
    await useAppStore.getState().undoDisplayUpload();
    // The second upload's pre-state was the first.png upload, so undo lands there.
    // First undo: back to first.png (second upload's pre-state).
    expect(useAppStore.getState().entries.slot0.name).toBe("first.png");
    expect(Array.from(useAppStore.getState().entries.slot0.source!)).toEqual([1]);
    expect(useAppStore.getState().displayHistory).toHaveLength(1);
  });

  describe("trust layer", () => {
    const board = {
      connected: true,
      synced: true,
      underglow: { effect: 6, brightness: 5, speed: 4, orientation: 0, rainbow: 0, color: [0, 0, 255] as [number, number, number] },
      led: { mode: 3, saturation: 5, rainbow: 0, color: 0 },
      winLock: false,
      show: 0,
      slot0Frames: 1,
      slot1Frames: 1,
      frameDelayMs: 100,
      time: [2026, 11, 9, 0, 12, 0, 0] as [number, number, number, number, number, number, number],
    };

    it("undoes and redoes staged edits", async () => {
      useAppStore.setState({ state: board as never, draft: null, draftDirty: false, draftPast: [], draftFuture: [], redoStack: [], lightingHistory: [] });
      useAppStore.getState().setLightingDraft({ underglowEffect: 11 });
      expect(useAppStore.getState().draft?.underglow.effect).toBe(11);
      await useAppStore.getState().undo();
      expect(useAppStore.getState().draft).toBeNull();
      expect(useAppStore.getState().draftDirty).toBe(false);
      await useAppStore.getState().redo();
      expect(useAppStore.getState().draft?.underglow.effect).toBe(11);
      expect(useAppStore.getState().draftDirty).toBe(true);
    });

    it("redoes an undone board write and clears redo on a new commit", async () => {
      const ipc = await import("./lib/ipc");
      const current = { ...board, underglow: { ...board.underglow, effect: 11 } };
      useAppStore.setState({ state: current as never, lightingHistory: [{ state: board as never, at: 1, label: "x" }], draft: null, draftDirty: false, draftPast: [], draftFuture: [], redoStack: [] });
      vi.mocked(ipc.setLighting).mockResolvedValueOnce(board as never);
      await useAppStore.getState().undo();
      expect(useAppStore.getState().redoStack).toHaveLength(1);
      vi.mocked(ipc.setLighting).mockResolvedValueOnce(current as never);
      await useAppStore.getState().redo();
      expect(useAppStore.getState().state?.underglow.effect).toBe(11);
      expect(useAppStore.getState().redoStack).toHaveLength(0);
    });

    it("stages a profile into the draft without writing", async () => {
      const ipc = await import("./lib/ipc");
      vi.mocked(ipc.setLighting).mockClear();
      useAppStore.setState({ state: board as never, draft: null, draftDirty: false, draftPast: [], draftFuture: [] });
      useAppStore.getState().stageProfile({
        id: "p1",
        name: "Night",
        lighting: { underglow: { ...board.underglow, effect: 16, brightness: 2 }, led: board.led, winLock: false },
        display: { slot: "slot0", delayMs: 100 },
        createdAt: 1,
        updatedAt: 1,
      });
      expect(vi.mocked(ipc.setLighting)).not.toHaveBeenCalled();
      expect(useAppStore.getState().draft?.underglow.effect).toBe(16);
      expect(useAppStore.getState().activeProfileId).toBe("p1");
    });
  });
});
