import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const applyPreset = vi.fn(async () => {});
const applyLighting = vi.fn(async () => {});
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      state: {
        underglow: {
          effect: 5,
          brightness: 9,
          speed: 1,
          orientation: 1,
          rainbow: 0,
          color: [255, 0, 0],
        },
        led: { mode: 3, saturation: 9, rainbow: 0, color: 0 },
        winLock: false,
      },
      presets: [
        { name: "gaming", description: "Aggressive red theme with fast effects" },
        { name: "matrix", description: "Green rain effect" },
      ],
      loadPresets: vi.fn(async () => {}),
      applyPreset,
      applyLighting,
    }),
}));

import LightingScreen from "./LightingScreen";

describe("LightingScreen", () => {
  it("lists all 19 named effects", () => {
    render(<LightingScreen />);
    const effectSelect = screen.getByLabelText("Underglow effect");
    expect(within(effectSelect).getAllByRole("option")).toHaveLength(19);
  });
  it("applies a preset when its chip is clicked", async () => {
    render(<LightingScreen />);
    await userEvent.click(screen.getByRole("button", { name: /matrix/i }));
    expect(applyPreset).toHaveBeenCalledWith("matrix");
  });
});
