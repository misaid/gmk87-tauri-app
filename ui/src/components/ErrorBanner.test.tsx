import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorBanner } from "./ErrorBanner";
import { useAppStore } from "@/store";

describe("ErrorBanner", () => {
  beforeEach(() => {
    act(() => useAppStore.setState({ error: null, errorKind: null }));
  });

  it("explains an unplug with only a Dismiss button", () => {
    act(() => useAppStore.getState().handleDisconnected());
    render(<ErrorBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("Keyboard unplugged. Plug it back in and it reconnects by itself.");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
});
