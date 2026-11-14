import { describe, expect, it, vi } from "vitest";
import { decodeUrl, getBitmap, peekBitmap } from "./bitmapCache";

describe("bitmapCache", () => {
  it("has nothing to peek before a source is decoded", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(peekBitmap(bytes)).toBeNull();
    expect(peekBitmap(null)).toBeNull();
    await getBitmap(bytes); // jsdom has no createImageBitmap, so this resolves null
    expect(peekBitmap(bytes)).toBeNull();
  });

  it("peeks a decoded bitmap synchronously", async () => {
    const bmp = { width: 4, height: 3, close() {} } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bmp));
    const bytes = new Uint8Array([9, 9]);
    expect(await getBitmap(bytes)).toBe(bmp);
    expect(peekBitmap(bytes)).toBe(bmp);
    vi.unstubAllGlobals();
  });

  it("pre-decodes a url and never rejects", async () => {
    await expect(decodeUrl("blob:none")).resolves.toBeUndefined();
  });
});
