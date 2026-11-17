import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_APPLY_DEBOUNCE_MS, LIVE_APPLY_MAX_WAIT_MS, useLiveApply } from "./useLiveApply";
import { useAppStore } from "@/store";

const dirty = (n: number) => ({ underglow: { effect: 6, brightness: n } }) as never;

describe("useLiveApply", () => {
  const commit = vi.fn(async () => {});
  beforeEach(() => {
    vi.useFakeTimers();
    commit.mockClear();
    useAppStore.setState({ autoApply: true, connected: true, draft: null, draftDirty: false, applying: false, commitDraft: commit });
  });
  afterEach(() => vi.useRealTimers());

  const stage = (n: number) => act(() => useAppStore.setState({ draft: dirty(n), draftDirty: true }));

  it("defaults to live apply", () => {
    expect(LIVE_APPLY_DEBOUNCE_MS).toBe(200);
  });

  it("writes once, 200ms after the last of a burst of edits (coalesced)", () => {
    renderHook(() => useLiveApply());
    stage(1);
    act(() => void vi.advanceTimersByTime(150));
    stage(2);
    act(() => void vi.advanceTimersByTime(150));
    stage(3);
    act(() => void vi.advanceTimersByTime(199));
    expect(commit).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("still flushes during a continuous drag (max wait)", () => {
    renderHook(() => useLiveApply());
    let n = 0;
    for (let t = 0; t <= LIVE_APPLY_MAX_WAIT_MS + 100; t += 100) {
      stage(++n);
      act(() => void vi.advanceTimersByTime(100));
    }
    expect(commit).toHaveBeenCalled();
  });

  it("holds edits in Draft mode and while offline, and waits out an in-flight write", () => {
    renderHook(() => useLiveApply());
    act(() => useAppStore.setState({ autoApply: false }));
    stage(1);
    act(() => void vi.advanceTimersByTime(2000));
    expect(commit).not.toHaveBeenCalled();
    act(() => useAppStore.setState({ autoApply: true, connected: false }));
    act(() => void vi.advanceTimersByTime(2000));
    expect(commit).not.toHaveBeenCalled();
    act(() => useAppStore.setState({ connected: true, applying: true }));
    act(() => void vi.advanceTimersByTime(2000));
    expect(commit).not.toHaveBeenCalled();
    act(() => useAppStore.setState({ applying: false }));
    act(() => void vi.advanceTimersByTime(LIVE_APPLY_DEBOUNCE_MS + 1));
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
