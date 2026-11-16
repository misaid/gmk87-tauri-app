import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Toast } from "./Toast";
import { useAppStore } from "@/store";

describe("Toast", () => {
  beforeEach(() => {
    act(() => useAppStore.setState({ notice: null, noticeKind: "success" }));
  });

  it("is a status for notices and an alert (alone) for errors", () => {
    render(<Toast />);
    act(() => useAppStore.setState({ notice: "Clock synced ✓", noticeKind: "success" }));
    expect(screen.getByRole("status")).toHaveTextContent("Clock synced ✓");
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-live");
    act(() => useAppStore.setState({ notice: "Could not copy", noticeKind: "error" }));
    expect(screen.getByRole("alert")).not.toHaveAttribute("aria-live");
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("goes away on click and on Escape", async () => {
    render(<Toast />);
    act(() => useAppStore.setState({ notice: "One", noticeKind: "success" }));
    await userEvent.click(screen.getByRole("status"));
    expect(useAppStore.getState().notice).toBeNull();
    act(() => useAppStore.setState({ notice: "Two", noticeKind: "success" }));
    await userEvent.keyboard("{Escape}");
    expect(useAppStore.getState().notice).toBeNull();
  });
});
