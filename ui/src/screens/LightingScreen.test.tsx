import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const applyPreset = vi.fn(async () => {});
const applyLighting = vi.fn(async () => {});
const setActiveTab = vi.fn();
const setLightingDraft = vi.fn();
const commitDraft = vi.fn(async () => {});
const discardDraft = vi.fn();
const undoLighting = vi.fn(async () => {});
const setAnimationsPaused = vi.fn();
const setShowWriteConfirm = vi.fn();
const boardState = {
  underglow: {
    effect: 5,
    brightness: 9,
    speed: 1,
    orientation: 1,
    rainbow: 0,
    color: [255, 0, 0] as [number, number, number],
  },
  led: { mode: 3, saturation: 9, rainbow: 0, color: 0 },
  winLock: false,
};
vi.mock("@/store", () => ({
  selectEffectiveState: (s: { draft?: unknown; state?: unknown }) => s.draft ?? s.state ?? null,
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      state: boardState,
      draft: null,
      draftDirty: false,
      lightingHistory: [],
      presets: [
        { name: "gaming", description: "Aggressive red theme with fast effects" },
        { name: "matrix", description: "Green rain effect" },
      ],
      loadPresets: vi.fn(async () => {}),
      applyPreset,
      applyLighting,
      setLightingDraft,
      commitDraft,
      discardDraft,
      undoLighting,
      setActiveTab,
      animationsPaused: false,
      setAnimationsPaused,
      notice: null,
      setNotice: vi.fn(),
      showWriteConfirm: false,
      setShowWriteConfirm,
    }),
}));

import LightingScreen from "./LightingScreen";

describe("LightingScreen", () => {
  it("lists all 19 named effects in the gallery", async () => {
    render(<LightingScreen />);
    await userEvent.click(screen.getByRole("button", { name: /all 19 effects/i }));
    const group = screen.getByRole("radiogroup", { name: "Underglow effect" });
    expect(within(group).getAllByRole("radio")).toHaveLength(19);
  });
  it("stages a preset as a draft (single commit model)", async () => {
    render(<LightingScreen />);
    await userEvent.click(screen.getByRole("button", { name: /matrix/i }));
    expect(setLightingDraft).toHaveBeenCalled();
    expect(applyPreset).not.toHaveBeenCalled();
  });
  it("stages effect edits as a draft instead of writing immediately", async () => {
    render(<LightingScreen />);
    await userEvent.click(screen.getByRole("radio", { name: /Breathing/i }));
    expect(setLightingDraft).toHaveBeenCalled();
    expect(applyLighting).not.toHaveBeenCalled();
  });
});
