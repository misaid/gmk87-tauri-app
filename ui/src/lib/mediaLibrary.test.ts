import { describe, expect, it } from "vitest";
import { DEFAULT_CROP } from "./crop";
import { MediaLibrary, MemoryStorage, hashBytes, searchItems } from "./mediaLibrary";

const meta = (name: string, isGif = false) => ({ name, isGif, frames: 1, width: 10, height: 10, thumb: "data:" });
const bytes = (n: number, size = 10) => new Uint8Array(size).fill(n);

function make(limits = { maxItems: 3, maxBytes: 1_000_000 }) {
  let t = 1000;
  const storage = new MemoryStorage();
  const lib = new MediaLibrary(storage, limits, () => ++t);
  return { lib, storage };
}

describe("MediaLibrary", () => {
  it("stores identical bytes once and bumps use", async () => {
    const { lib, storage } = make();
    await lib.add(bytes(1), meta("a.png"));
    const again = await lib.add(bytes(1), meta("renamed.png"));
    expect(storage.items.size).toBe(1);
    expect(again?.useCount).toBe(2);
    expect(await hashBytes(bytes(1))).toBe(await hashBytes(bytes(1)));
    expect(await hashBytes(bytes(1))).not.toBe(await hashBytes(bytes(2)));
  });

  it("evicts least-recently-used past the item cap", async () => {
    const { lib } = make();
    for (let i = 1; i <= 4; i++) await lib.add(bytes(i), meta(`f${i}`));
    const names = (await lib.list()).map((i) => i.name);
    expect(names).toHaveLength(3);
    expect(names).not.toContain("f1");
  });

  it("never evicts items assigned to a slot", async () => {
    const { lib } = make();
    const first = await lib.add(bytes(1), meta("pinned"));
    for (let i = 2; i <= 5; i++) await lib.add(bytes(i), meta(`f${i}`), new Set([first!.id]));
    const names = (await lib.list()).map((i) => i.name);
    expect(names).toContain("pinned");
    expect(names).toHaveLength(3);
  });

  it("evicts by total size too", async () => {
    const { lib } = make({ maxItems: 40, maxBytes: 25 });
    await lib.add(bytes(1, 10), meta("a"));
    await lib.add(bytes(2, 10), meta("b"));
    await lib.add(bytes(3, 10), meta("c"));
    expect((await lib.list()).map((i) => i.name).sort()).toEqual(["b", "c"]);
  });

  it("restores the last crop after touch", async () => {
    const { lib } = make();
    const item = await lib.add(bytes(1), meta("a"));
    expect(item?.lastCrop).toBeNull();
    await lib.touch(item!.id, { ...DEFAULT_CROP, zoom: 2.5, offsetX: 0.4 });
    const [stored] = await lib.list();
    expect(stored.lastCrop).toMatchObject({ zoom: 2.5, offsetX: 0.4 });
    expect(stored.useCount).toBe(2);
    expect(await lib.getBytes(item!.id)).toEqual(bytes(1));
  });

  it("searches names case-insensitively", async () => {
    const { lib } = make({ maxItems: 10, maxBytes: 1e6 });
    await lib.add(bytes(1), meta("Cat.gif", true));
    await lib.add(bytes(2), meta("sunset.png"));
    const items = await lib.list();
    expect(searchItems(items, "cat").map((i) => i.name)).toEqual(["Cat.gif"]);
    expect(searchItems(items, "  ")).toHaveLength(2);
  });

  it("removes and clears; failing storage degrades to empty", async () => {
    const { lib } = make();
    const a = await lib.add(bytes(1), meta("a"));
    await lib.remove(a!.id);
    expect(await lib.list()).toHaveLength(0);
    await lib.add(bytes(2), meta("b"));
    await lib.clear();
    expect(await lib.list()).toHaveLength(0);
    const broken = new MediaLibrary({
      list: async () => { throw new Error("no idb"); },
      getBytes: async () => { throw new Error("no idb"); },
      put: async () => { throw new Error("no idb"); },
      delete: async () => { throw new Error("no idb"); },
      clear: async () => { throw new Error("no idb"); },
    });
    expect(await broken.list()).toEqual([]);
    expect(await broken.add(bytes(1), meta("x"))).toBeNull();
  });
});
