import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      slot: "slot0",
      setSlot: vi.fn(),
      source: { bytes: new Uint8Array(), name: "cat.png" },
      sourceInfo: { isGif: false, frames: 1, delayMs: 100 },
      previewUrl: null,
      totalFrames: 2,
      delayMs: 100,
      setDelayMs: vi.fn(),
      loadSource: vi.fn(),
      crop: { offsetX: 0, offsetY: 0, zoom: 1, fit: "cover" },
      setCrop: vi.fn(),
      uploads: 0,
      progress: null,
      upload: vi.fn(),
      cancel: vi.fn(),
    }),
}));

import DisplayScreen from "./DisplayScreen";

describe("DisplayScreen", () => {
  it("shows the frame budget", () => {
    render(<DisplayScreen />);
    expect(screen.getByText("2 / 36")).toBeInTheDocument();
  });
  it("offers a file picker", () => {
    render(<DisplayScreen />);
    expect(screen.getByLabelText("Choose image or GIF")).toBeInTheDocument();
  });
});
