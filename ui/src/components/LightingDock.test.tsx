import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { setLightingDraft, boardState } = vi.hoisted(() => ({ setLightingDraft: vi.fn(), boardState: {
  underglow: { effect: 5, brightness: 9, speed: 1, orientation: 1, rainbow: 0, color: [255, 0, 0] as [number, number, number] },
  led: { mode: 3, saturation: 9, rainbow: 0, color: 0 },
  winLock: false,
} }));
vi.mock("@/store", () => ({
  OFFLINE_STATE: boardState,
  selectEffectiveState: (s: { draft?: unknown; state?: unknown }) => s.draft ?? s.state ?? null,
  useAppStore: (selector: (s: unknown) => unknown) => selector({ state: boardState, draft: null, setLightingDraft }),
}));

import { LightingDock } from "./LightingDock";

describe("LightingDock", () => {
  it("stages colour, rainbow and shows value labels via setLightingDraft", async () => {
    render(<LightingDock />);
    expect(screen.getByText("9/9")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sky" }));
    expect(setLightingDraft).toHaveBeenCalledWith({ underglowColor: [10, 132, 255] });
    await userEvent.click(screen.getByRole("switch", { name: /rainbow/i }));
    expect(setLightingDraft).toHaveBeenCalledWith({ underglowRainbow: 1 });
  });

  it("stages brightness and speed from the sliders (speed inverted)", async () => {
    render(<LightingDock />);
    const [bright, speed] = screen.getAllByRole("slider");
    bright.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(setLightingDraft).toHaveBeenCalledWith({ underglowBrightness: 8 });
    speed.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(setLightingDraft).toHaveBeenCalledWith({ underglowSpeed: 2 });
  });
});
