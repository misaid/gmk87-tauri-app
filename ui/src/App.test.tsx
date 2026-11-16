import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "./App";
import { OFFLINE_STATE, useAppStore } from "./store";

function plugIn() {
  act(() => {
    useAppStore.setState({ connected: true, state: { ...OFFLINE_STATE, connected: true } });
  });
}

describe("App shell", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ connected: false, state: null, draft: null, draftDirty: false, activeTab: "device", error: null, errorKind: null });
    });
  });

  it("opens on Device with the other tabs locked until connected", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: "Device" })).toHaveAttribute("data-state", "active");
    for (const label of ["Lighting", "Display", "Profiles"]) {
      expect(screen.getByRole("tab", { name: label })).toBeDisabled();
    }
    expect(screen.queryByRole("tab", { name: "Clock" })).not.toBeInTheDocument();
  });

  it("explains locked tabs to assistive tech, not only through a title", () => {
    render(<App />);
    const locked = screen.getByRole("tab", { name: "Lighting" });
    expect(locked).toHaveAccessibleDescription(/connected/i);
    expect(screen.getByRole("tab", { name: "Device" })).not.toHaveAttribute("aria-describedby");
    plugIn();
    expect(screen.getByRole("tab", { name: "Lighting" })).not.toHaveAttribute("aria-describedby");
  });

  it("reports the link in the header", () => {
    render(<App />);
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("NO LINK");
    plugIn();
    expect(screen.getByText(/LINK\s+WIRED/)).toBeInTheDocument();
  });

  it("maps 1-4 to the tab order, even with a button focused", async () => {
    render(<App />);
    plugIn();
    const device = screen.getByRole("tab", { name: "Device" });
    device.focus();
    await userEvent.keyboard("2");
    expect(useAppStore.getState().activeTab).toBe("lighting");
    await userEvent.keyboard("3");
    expect(useAppStore.getState().activeTab).toBe("display");
    await userEvent.keyboard("4");
    expect(useAppStore.getState().activeTab).toBe("profiles");
    await userEvent.keyboard("1");
    expect(useAppStore.getState().activeTab).toBe("device");
  });

  it("ignores number keys while typing and does not unlock tabs without a link", async () => {
    render(<App />);
    await userEvent.keyboard("2");
    expect(useAppStore.getState().activeTab).toBe("device");
    plugIn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await userEvent.keyboard("3");
    expect(useAppStore.getState().activeTab).toBe("device");
    input.remove();
  });

  it("opens Help with ? from a focused button and shows the version and corrected shortcuts", async () => {
    render(<App />);
    screen.getByRole("tab", { name: "Device" }).focus();
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(dialog).toHaveTextContent(/GMK87 Configurator v\d+\.\d+\.\d+/);
    expect(screen.getByRole("row", { name: /2\s*Lighting/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /3\s*Display/ })).toBeInTheDocument();
  });

  it("shows the screen title as the rail h1 and runs the write pulse once per write", () => {
    render(<App />);
    plugIn();
    expect(screen.getByRole("heading", { level: 1, name: "Device" })).toBeInTheDocument();
    expect(document.querySelector(".rail-pulse")).toBeNull();
    act(() => useAppStore.setState({ lastSyncedAt: Date.now() }));
    const first = document.querySelector(".rail-pulse");
    expect(first).not.toBeNull();
    act(() => useAppStore.setState({ lastSyncedAt: Date.now() + 5 }));
    expect(document.querySelector(".rail-pulse")).not.toBe(first);
    expect(document.querySelectorAll(".rail-pulse")).toHaveLength(1);
  });

  it("keeps one board canvas across every tab", () => {
    render(<App />);
    plugIn();
    const before = document.querySelector("[data-renderer]");
    expect(before).not.toBeNull();
    expect(document.querySelectorAll("[data-renderer]")).toHaveLength(1);
    for (const tab of ["lighting", "display", "profiles", "device"] as const) {
      act(() => useAppStore.getState().setActiveTab(tab));
      expect(document.querySelectorAll("[data-renderer]")).toHaveLength(1);
      expect(document.querySelector("[data-renderer]")).toBe(before);
    }
  });
});
