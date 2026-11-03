import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CROP } from "@/lib/crop";

const setCrop = vi.fn();
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      slot: "slot0",
      entries: { slot0: { crop: DEFAULT_CROP }, slot1: { crop: DEFAULT_CROP } },
      setCrop,
      previewUrl: null,
    }),
}));

import { CropEditor } from "./CropEditor";

describe("CropEditor", () => {
  it("pans on drag by calling setCrop", () => {
    render(<CropEditor />);
    const surface = screen.getByTestId("crop-surface");
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(setCrop).toHaveBeenCalled();
    const next = setCrop.mock.calls.at(-1)![0];
    expect(next.offsetX).toBeGreaterThan(0);
  });

  it("zooms on wheel", () => {
    render(<CropEditor />);
    fireEvent.wheel(screen.getByTestId("crop-surface"), { deltaY: -100 });
    expect(setCrop).toHaveBeenCalled();
  });
});
