import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "./App";

describe("App shell", () => {
  it("opens on Device with the other tabs locked until connected", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: "Device" })).toHaveAttribute("data-state", "active");
    for (const label of ["Lighting", "Display", "Profiles"]) {
      expect(screen.getByRole("tab", { name: label })).toBeDisabled();
    }
    expect(screen.queryByRole("tab", { name: "Clock" })).not.toBeInTheDocument();
  });
});
