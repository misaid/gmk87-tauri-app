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
});
