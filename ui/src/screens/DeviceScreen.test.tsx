import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectTo = vi.fn(async () => {});
const defaultDevices = [
  {
    path: "/dev/hidraw12",
    label: "GMK87 (wired)",
    transport: "wired",
    productId: 0x5055,
    hasVia: true,
  },
];
const mockState: Record<string, unknown> = {
  devices: [...defaultDevices],
  connected: false,
  connectingPath: null,
  state: null,
  refreshDevices: vi.fn(async () => {}),
  connectTo,
  disconnectDevice: vi.fn(async () => {}),
};
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector(mockState),
}));

import DeviceScreen from "./DeviceScreen";

describe("DeviceScreen", () => {
  beforeEach(() => {
    connectTo.mockClear();
    mockState.devices = [...defaultDevices];
    mockState.connectingPath = null;
  });

  it("lists each transport with its label", () => {
    render(<DeviceScreen />);
    expect(screen.getByText("GMK87 (wired)")).toBeInTheDocument();
  });

  it("connects to the chosen path", async () => {
    render(<DeviceScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(connectTo).toHaveBeenCalledWith("/dev/hidraw12");
  });

  it("shows a Connecting spinner on the in-flight row and disables Connect", () => {
    mockState.connectingPath = "/dev/hidraw12";
    render(<DeviceScreen />);
    const button = screen.getByRole("button", { name: /connecting/i });
    expect(button).toBeDisabled();
  });

  it("keeps other rows idle while one row connects", () => {
    mockState.devices = [
      {
        path: "/dev/hidraw12",
        label: "GMK87 (wired)",
        transport: "wired",
        productId: 0x5055,
        hasVia: true,
      },
      {
        path: "/dev/hidraw13",
        label: "GMK87 (2.4G)",
        transport: "wireless24g",
        productId: 0x5088,
        hasVia: false,
      },
    ];
    mockState.connectingPath = "/dev/hidraw12";
    render(<DeviceScreen />);
    expect(screen.getByRole("button", { name: /connecting/i })).toBeDisabled();
    // The second row's Connect is disabled during connect but shows no spinner.
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(1);
  });

  it("shows the VIA notice when the interface is present", () => {
    render(<DeviceScreen />);
    expect(screen.getByText(/remapping/i)).toBeInTheDocument();
  });
});
