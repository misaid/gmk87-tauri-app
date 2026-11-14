import { describe, expect, it } from "vitest";
import { galleryItems, thumbLighting } from "./gallery";
import type { Profile } from "./profiles";

const profile = (id: string, effect = 16): Profile => ({
  id,
  name: `P${id}`,
  lighting: { underglow: { effect, brightness: 2, speed: 3, orientation: 0, rainbow: 0, color: [1, 2, 3] }, led: { mode: 3, saturation: 9, rainbow: 0, color: 6 }, winLock: false },
  display: { slot: "slot0", delayMs: 100 },
  createdAt: 1,
  updatedAt: 1,
});

describe("galleryItems", () => {
  const looks = [{ name: "purple-wave" }, { name: "matrix", description: "Green rain" }, { name: "unknown" }];
  it("lists Looks then profiles and skips Looks without values", () => {
    const items = galleryItems({ looks, profiles: [profile("a")], activeProfileId: null, activeLook: null });
    expect(items.map((i) => i.id)).toEqual(["look:purple-wave", "look:matrix", "profile:a"]);
    expect(items[0].name).toBe("purple wave");
    expect(items[1].subtitle).toBe("Green rain");
  });
  it("marks only one source active, preferring the profile", () => {
    const items = galleryItems({ looks, profiles: [profile("a")], activeProfileId: "a", activeLook: "matrix" });
    expect(items.filter((i) => i.active).map((i) => i.id)).toEqual(["profile:a"]);
    const lookOnly = galleryItems({ looks, profiles: [profile("a")], activeProfileId: null, activeLook: "matrix" });
    expect(lookOnly.filter((i) => i.active).map((i) => i.id)).toEqual(["look:matrix"]);
  });
  it("raises dim thumbnails to a readable floor", () => {
    expect(thumbLighting({ effect: 5, brightness: 1, speed: 1, orientation: 0, rainbow: 0, color: [1, 2, 3] }).brightness).toBe(5);
    expect(thumbLighting({ effect: 5, brightness: 8, speed: 1, orientation: 0, rainbow: 0, color: [1, 2, 3] }).brightness).toBe(8);
  });
});
