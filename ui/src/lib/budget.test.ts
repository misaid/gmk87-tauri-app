import { describe, expect, it } from "vitest";
import { budgetError, otherSlotFrames } from "./budget";

describe("budgetError", () => {
  it("accepts a valid animation", () => {
    expect(budgetError({ totalFrames: 36, delayMs: 60 })).toBeNull();
  });
  it("rejects more than 36 frames and names the count", () => {
    expect(budgetError({ totalFrames: 37, delayMs: 100 })).toContain("37");
  });
  it("rejects a delay below 60 ms and names it", () => {
    expect(budgetError({ totalFrames: 2, delayMs: 59 })).toContain("59");
  });
  it("rejects an empty animation", () => {
    expect(budgetError({ totalFrames: 0, delayMs: 100 })).not.toBeNull();
  });
});

describe("otherSlotFrames", () => {
  it("returns the slot that is not being replaced", () => {
    expect(otherSlotFrames({ slot0Frames: 10, slot1Frames: 3 }, "slot0")).toBe(3);
    expect(otherSlotFrames({ slot0Frames: 10, slot1Frames: 3 }, "slot1")).toBe(10);
  });
  it("assumes one retained frame before any device state is known", () => {
    expect(otherSlotFrames(null, "slot0")).toBe(1);
  });
});
