import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CROP } from "@/lib/crop";

const setCrop = vi.fn();
const state = {
  slot: "slot0",
  entries: {
    slot0: { source: null, crop: DEFAULT_CROP, previewUrl: null, previewKey: null },
    slot1: { source: null, crop: DEFAULT_CROP, previewUrl: null, previewKey: null },
  },
  setCrop,
};
vi.mock("@/store", () => {
  const useAppStore = (selector: (s: unknown) => unknown) => selector(state);
  useAppStore.getState = () => state;
  return { useAppStore };
});

import { CropEditor } from "./CropEditor";

describe("CropEditor", () => {
  beforeEach(() => setCrop.mockClear());

  it("does not touch the store while dragging, then commits once on release", () => {
    render(<CropEditor />);
    const surface = screen.getByTestId("crop-surface");
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, pointerId: 1 });
    for (let x = 1; x <= 40; x++) fireEvent.pointerMove(surface, { clientX: x, clientY: 0, pointerId: 1 });
    expect(setCrop).not.toHaveBeenCalled();
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(setCrop).toHaveBeenCalledTimes(1);
    expect(setCrop.mock.calls[0][0].offsetX).toBeGreaterThan(0);
  });

  it("zooms on wheel and commits once after the wheel goes quiet", () => {
    vi.useFakeTimers();
    render(<CropEditor />);
    const surface = screen.getByTestId("crop-surface");
    for (let i = 0; i < 10; i++) fireEvent.wheel(surface, { deltaY: -40 });
    expect(setCrop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(setCrop).toHaveBeenCalledTimes(1);
    expect(setCrop.mock.calls[0][0].zoom).toBeGreaterThan(1);
    vi.useRealTimers();
  });
});
