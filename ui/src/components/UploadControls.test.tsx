import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CROP } from "@/lib/crop";

const entry = {
  source: { bytes: new Uint8Array(), name: "x.gif" },
  name: "x.gif",
  info: { isGif: true, frames: 40, delayMs: 100, sourceFrames: 40, dropped: [] },
  crop: DEFAULT_CROP,
  delayMs: 100,
};
const state = {
  uploads: 0,
  progress: null,
  upload: vi.fn(),
  cancel: vi.fn(),
  connected: true,
  setActiveTab: vi.fn(),
  slot: "slot0",
  entries: { slot0: entry, slot1: entry },
};
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector(state),
  selectTotalFrames: () => 40,
}));

import { UploadControls } from "./UploadControls";

describe("UploadControls", () => {
  it("disables upload when the combined frames exceed the budget", () => {
    render(<UploadControls />);
    expect(screen.getByRole("button", { name: /write image to board/i })).toHaveAttribute("aria-disabled", "true");
  });
});
