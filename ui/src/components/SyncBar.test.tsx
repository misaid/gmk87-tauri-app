import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SyncBar } from "./SyncBar";
import { OFFLINE_STATE, useAppStore } from "@/store";

describe("SyncBar", () => {
  beforeEach(() => {
    useAppStore.setState({ autoApply: true, connected: true, draft: null, draftDirty: false, applying: false, lastSyncedAt: null });
  });

  it("is live by default: no Apply button, shows Synced", () => {
    render(<SyncBar />);
    expect(screen.getByText("Synced")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply to keyboard/i })).toBeNull();
  });

  it("shows Applying while a live edit is pending", () => {
    useAppStore.setState({ draft: OFFLINE_STATE, state: OFFLINE_STATE, draftDirty: true });
    render(<SyncBar />);
    expect(screen.getByText("Applying…")).toBeInTheDocument();
  });

  it("Draft mode is an opt-in toggle in the options menu that brings Apply back", async () => {
    render(<SyncBar />);
    await userEvent.click(screen.getByRole("button", { name: "Sync options" }));
    const toggle = screen.getByRole("checkbox", { name: /draft mode/i });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(useAppStore.getState().autoApply).toBe(false);
    expect(screen.getByRole("button", { name: /apply to keyboard/i })).toBeInTheDocument();
  });

  it("offers the lighting preview modes in the options menu and applies the choice", async () => {
    const { getLightingMode, resetLightingModeCache } = await import("@/lib/lightingPerf");
    resetLightingModeCache();
    render(<SyncBar />);
    await userEvent.click(screen.getByRole("button", { name: "Sync options" }));
    const group = screen.getByRole("radiogroup", { name: "Lighting preview" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Auto", "GPU", "CPU", "Static"]);
    await userEvent.click(screen.getByRole("radio", { name: "Static" }));
    expect(getLightingMode()).toBe("static");
    expect(screen.getByRole("radio", { name: "Static" })).toHaveAttribute("aria-checked", "true");
    resetLightingModeCache();
  });
});
