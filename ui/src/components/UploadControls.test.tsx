import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = {
  uploads: 0,
  progress: null,
  upload: vi.fn(),
  cancel: vi.fn(),
  delayMs: 100,
  totalFrames: 40,
  source: { bytes: new Uint8Array(), name: "x.gif" },
};
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector(state),
}));

import { UploadControls } from "./UploadControls";

describe("UploadControls", () => {
  it("disables upload when the combined frames exceed the budget", () => {
    render(<UploadControls />);
    expect(screen.getByRole("button", { name: /upload and show/i })).toBeDisabled();
  });
});
