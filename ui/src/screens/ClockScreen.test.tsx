import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const syncClock = vi.fn(async () => {});
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ state: { time: [2026, 11, 1, 6, 14, 5, 9] }, syncClock }),
}));

import ClockScreen, { formatDeviceTime } from "./ClockScreen";

describe("formatDeviceTime", () => {
  it("formats the tuple as a timestamp", () => {
    expect(formatDeviceTime([2026, 11, 1, 6, 14, 5, 9])).toBe("2026-11-01 14:05:09");
  });
});

describe("ClockScreen", () => {
  it("syncs on demand", async () => {
    render(<ClockScreen />);
    await userEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(syncClock).toHaveBeenCalled();
  });
});
