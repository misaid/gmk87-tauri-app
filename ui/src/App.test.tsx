import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "./App";

describe("App shell", () => {
  it("renders the four screens", () => {
    render(<App />);
    for (const label of ["Device", "Display", "Lighting", "Clock"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });
});
