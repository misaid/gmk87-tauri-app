import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CROP } from "@/lib/crop";

const entry = {
  source: new Uint8Array(),
  name: "cat.png",
  info: { isGif: false, frames: 1, delayMs: 100, sourceFrames: 1, dropped: [] },
  crop: DEFAULT_CROP,
  delayMs: 100,
};
const state = {
  slot: "slot0",
  setSlot: vi.fn(),
  entries: { slot0: entry, slot1: { ...entry, source: null } },
  previewUrl: null,
  loadSource: vi.fn(),
  setDelayMs: vi.fn(),
  uploads: 0,
  progress: null,
  upload: vi.fn(),
  cancel: vi.fn(),
  setCrop: vi.fn(),
};
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector(state),
  selectTotalFrames: () => 2,
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
