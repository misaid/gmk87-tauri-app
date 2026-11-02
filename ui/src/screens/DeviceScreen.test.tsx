import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectTo = vi.fn(async () => {});
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      devices: [
        {
          path: "/dev/hidraw12",
          label: "GMK87 (wired)",
          transport: "wired",
          productId: 0x5055,
          hasVia: true,
        },
      ],
      connected: false,
      state: null,
      refreshDevices: vi.fn(async () => {}),
      connectTo,
      disconnectDevice: vi.fn(async () => {}),
    }),
}));

import DeviceScreen from "./DeviceScreen";

describe("DeviceScreen", () => {
  beforeEach(() => connectTo.mockClear());

  it("lists each transport with its label", () => {
    render(<DeviceScreen />);
    expect(screen.getByText("GMK87 (wired)")).toBeInTheDocument();
  });

  it("connects to the chosen path", async () => {
    render(<DeviceScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(connectTo).toHaveBeenCalledWith("/dev/hidraw12");
  });

  it("shows the VIA notice when the interface is present", () => {
    render(<DeviceScreen />);
    expect(screen.getByText(/remapping/i)).toBeInTheDocument();
  });
});
