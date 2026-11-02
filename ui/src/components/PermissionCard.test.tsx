import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionCard } from "./PermissionCard";

describe("PermissionCard", () => {
  it("shows the udev rule and reload commands", () => {
    render(<PermissionCard />);
    expect(screen.getByText(/TAG\+=.uaccess./)).toBeInTheDocument();
    expect(screen.getByText(/udevadm control --reload-rules/)).toBeInTheDocument();
  });

  it("copies the install commands", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PermissionCard />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalled();
  });
});
