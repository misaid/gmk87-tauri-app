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
  libraryUse: vi.fn(),
  library: [],
  loadLibrary: vi.fn(),
  libraryRemove: vi.fn(),
  libraryClear: vi.fn(),
  loadSource: vi.fn(),
  setDelayMs: vi.fn(),
  connected: true,
  setActiveTab: vi.fn(),
  uploads: 0,
  progress: null,
  uploadChanged: vi.fn(),
  batch: null,
  lastUploaded: null,
  cancel: vi.fn(),
  setCrop: vi.fn(),
};
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector(state),
  selectTotalFrames: () => 2,
  dirtySlots: () => ["slot0"],
}));

import DisplayScreen from "./DisplayScreen";

describe("DisplayScreen", () => {
  it("shows the frame budget", () => {
    render(<DisplayScreen />);
    expect(screen.getByText("2 / 36")).toBeInTheDocument();
  });
  it("draws the budget as 36 cells: slot 0, slot 1, then free", () => {
    render(<DisplayScreen />);
    const cells = [...screen.getByRole("progressbar").querySelectorAll("[data-cell]")].map((c) => c.getAttribute("data-cell"));
    expect(cells).toHaveLength(36);
    expect(cells.slice(0, 2)).toEqual(["slot0", "slot1"]);
    expect(cells.slice(2).every((c) => c === "free")).toBe(true);
  });
  it("shows the empty-slot drop line only while the slot has no image", () => {
    render(<DisplayScreen />);
    expect(screen.queryByText("Drop an image or GIF here")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset crop" })).toBeInTheDocument();
  });
  it("offers a file picker", () => {
    render(<DisplayScreen />);
    expect(screen.getByLabelText("Choose image or GIF")).toBeInTheDocument();
  });
});
