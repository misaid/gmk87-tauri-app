import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { setLightingDraft, boardState } = vi.hoisted(() => ({
  setLightingDraft: vi.fn(),
  boardState: {
    underglow: { effect: 5, brightness: 9, speed: 1, orientation: 1, rainbow: 0, color: [255, 0, 0] as [number, number, number] },
    led: { mode: 3, saturation: 9, rainbow: 0, color: 0 },
    winLock: false,
  },
}));
vi.mock("@/store", () => ({
  OFFLINE_STATE: boardState,
  selectEffectiveState: (s: { draft?: unknown; state?: unknown }) => s.draft ?? s.state ?? null,
  useAppStore: (selector: (s: unknown) => unknown) => selector({ state: boardState, draft: null, setLightingDraft }),
}));

import { LightBarPopover } from "./LightBarPopover";

function setup() {
  const onClose = vi.fn();
  const anchor = { current: document.createElement("button") };
  render(<LightBarPopover anchor={anchor} onClose={onClose} />);
  return onClose;
}

describe("LightBarPopover", () => {
  it("shows 5 modes and 9 colours and stages edits", async () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Side light bar" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: false }).length + screen.getAllByRole("button", { pressed: true }).length).toBe(14);
    await userEvent.click(screen.getByRole("button", { name: "Pulse rainbow" }));
    expect(setLightingDraft).toHaveBeenCalledWith({ ledMode: expect.any(Number) });
  });

  it("closes on Escape and on outside click", async () => {
    const onClose = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
