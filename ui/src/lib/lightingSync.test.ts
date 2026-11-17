import { describe, expect, it } from "vitest";
import { deriveSyncStatus, diffSummary, filterEffects, matchingLook, profileMatches } from "./lightingSync";
import { OFFLINE_STATE } from "@/store";

describe("deriveSyncStatus", () => {
  const base = { connected: true, draftDirty: false, applying: false };
  it("derives each state", () => {
    expect(deriveSyncStatus(base)).toBe("synced");
    expect(deriveSyncStatus({ ...base, draftDirty: true })).toBe("draft");
    expect(deriveSyncStatus({ ...base, draftDirty: true, applying: true })).toBe("applying");
    expect(deriveSyncStatus({ ...base, connected: false, draftDirty: true })).toBe("offline");
    expect(deriveSyncStatus({ ...base, draftDirty: true, applyFailed: true })).toBe("error");
  });
});

describe("diffSummary", () => {
  it("describes changes in plain words", () => {
    const next = { ...OFFLINE_STATE, underglow: { ...OFFLINE_STATE.underglow, effect: 16, brightness: 8 } };
    const base = { ...OFFLINE_STATE, underglow: { ...OFFLINE_STATE.underglow, effect: 6, brightness: 6 } };
    expect(diffSummary(base, next)).toEqual(["Effect: Steady glow → Tide", "Brightness 6 → 8"]);
    expect(diffSummary(base, base)).toEqual([]);
  });
});

describe("filterEffects", () => {
  it("filters by category", () => {
    expect(filterEffects("all")).toHaveLength(19);
    expect(filterEffects("wave").map((e) => e.value)).toEqual([1, 2, 3, 13, 16]);
    expect(filterEffects("static").map((e) => e.value)).toContain(0);
    expect(filterEffects("rainbow").every((e) => [4, 11, 12, 18].includes(e.value))).toBe(true);
  });
});

describe("profile and look matching", () => {
  it("detects divergence", () => {
    const lighting = { underglow: { ...OFFLINE_STATE.underglow }, led: { ...OFFLINE_STATE.led }, winLock: false };
    expect(profileMatches(lighting, OFFLINE_STATE)).toBe(true);
    expect(profileMatches({ ...lighting, underglow: { ...lighting.underglow, brightness: 1 } }, OFFLINE_STATE)).toBe(false);
    expect(matchingLook({ ...OFFLINE_STATE, underglow: { ...OFFLINE_STATE.underglow, effect: 6, brightness: 4, speed: 5, rainbow: 0, color: [255, 255, 255] }, led: { ...OFFLINE_STATE.led, mode: 3, color: 7 } })).toBe("productivity");
  });
});
