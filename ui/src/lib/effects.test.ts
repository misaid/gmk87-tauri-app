import { describe, expect, it } from "vitest";
import { LED_COLORS, LED_MODES, UNDERGLOW_EFFECTS } from "./effects";

describe("effect tables", () => {
  it("has the 19 named underglow effects, in device order", () => {
    expect(UNDERGLOW_EFFECTS).toHaveLength(19);
    expect(UNDERGLOW_EFFECTS[0]).toEqual({ name: "Off", value: 0 });
    expect(UNDERGLOW_EFFECTS[5]).toEqual({ name: "Breathe", value: 5 });
    expect(UNDERGLOW_EFFECTS[18]).toEqual({ name: "Slow rainbow", value: 18 });
  });
  it("has the five LED modes and nine LED colours", () => {
    expect(LED_MODES).toHaveLength(5);
    expect(LED_MODES[3]).toEqual({ name: "Fixed colour", value: 3 });
    expect(LED_COLORS).toHaveLength(9);
    expect(LED_COLORS[8]).toEqual({ name: "Off", value: 8 });
  });
});
