import type { CropParams } from "@/lib/crop";

/** Metadata for one remembered image/GIF (bytes are stored separately). */
export interface LibraryItem {
  id: string;
  name: string;
  isGif: boolean;
  frames: number;
  width: number;
  height: number;
  byteSize: number;
  addedAt: number;
  lastUsedAt: number;
  useCount: number;
  lastCrop: CropParams | null;
  thumb: string;
}

/** Minimal persistence the library needs; IndexedDB in the app, a Map in tests. */
export interface LibraryStorage {
  list(): Promise<LibraryItem[]>;
  getBytes(id: string): Promise<Uint8Array | null>;
  put(item: LibraryItem, bytes?: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const MAX_ITEMS = 40;
export const MAX_BYTES = 60 * 1024 * 1024;

export class MemoryStorage implements LibraryStorage {
  items = new Map<string, LibraryItem>();
  blobs = new Map<string, Uint8Array>();
  async list() {
    return [...this.items.values()].map((i) => ({ ...i }));
  }
  async getBytes(id: string) {
    return this.blobs.get(id) ?? null;
  }
  async put(item: LibraryItem, bytes?: Uint8Array) {
    this.items.set(item.id, { ...item });
    if (bytes) this.blobs.set(item.id, bytes);
  }
  async delete(id: string) {
    this.items.delete(id);
    this.blobs.delete(id);
  }
  async clear() {
    this.items.clear();
    this.blobs.clear();
  }
}

const DB = "gmk87-media-library";
const META = "meta";
const BLOBS = "blobs";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** IndexedDB-backed storage. Every method rejects if IndexedDB is unavailable. */
export class IndexedDbStorage implements LibraryStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(META, { keyPath: "id" });
        open.result.createObjectStore(BLOBS);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbPromise;
  }
  async list() {
    const db = await this.db();
    return req(db.transaction(META).objectStore(META).getAll() as IDBRequest<LibraryItem[]>);
  }
  async getBytes(id: string) {
    const db = await this.db();
    const v = await req(db.transaction(BLOBS).objectStore(BLOBS).get(id) as IDBRequest<ArrayBuffer | Uint8Array | undefined>);
    return v ? new Uint8Array(v as ArrayBuffer) : null;
  }
  async put(item: LibraryItem, bytes?: Uint8Array) {
    const db = await this.db();
    const tx = db.transaction([META, BLOBS], "readwrite");
    tx.objectStore(META).put(item);
    if (bytes) tx.objectStore(BLOBS).put(bytes.slice().buffer, item.id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  }
  async delete(id: string) {
    const db = await this.db();
    const tx = db.transaction([META, BLOBS], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(BLOBS).delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async clear() {
    const db = await this.db();
    const tx = db.transaction([META, BLOBS], "readwrite");
    tx.objectStore(META).clear();
    tx.objectStore(BLOBS).clear();
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

/** Content hash used as the item id, so the same file is stored once. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const digest = await subtle.digest("SHA-256", bytes as BufferSource);
      return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* fall through */
  }
  // FNV-1a fallback (two lanes) when WebCrypto is unavailable.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ bytes[i], 0x85ebca6b) >>> 0;
  }
  return `f${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}${bytes.length.toString(16)}`;
}

export interface NewItem {
  name: string;
  isGif: boolean;
  frames: number;
  width: number;
  height: number;
  thumb: string;
}

/** Case-insensitive name filter. */
export function searchItems(items: LibraryItem[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
}

export function totalBytes(items: LibraryItem[]): number {
  return items.reduce((n, i) => n + i.byteSize, 0);
}

export class MediaLibrary {
  constructor(
    private storage: LibraryStorage,
    private limits = { maxItems: MAX_ITEMS, maxBytes: MAX_BYTES },
    private now: () => number = Date.now,
  ) {}

  /** Newest-used first. Never throws; an unavailable store reads as empty. */
  async list(): Promise<LibraryItem[]> {
    try {
      return (await this.storage.list()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    } catch {
      return [];
    }
  }

  /** Remember a file. Re-adding the same bytes bumps its use instead of duplicating. */
  async add(bytes: Uint8Array, meta: NewItem, inUse: ReadonlySet<string> = new Set()): Promise<LibraryItem | null> {
    try {
      const id = await hashBytes(bytes);
      const existing = (await this.storage.list()).find((i) => i.id === id);
      const t = this.now();
      const item: LibraryItem = existing
        ? { ...existing, lastUsedAt: t, useCount: existing.useCount + 1, thumb: existing.thumb || meta.thumb }
        : { ...meta, id, byteSize: bytes.byteLength, addedAt: t, lastUsedAt: t, useCount: 1, lastCrop: null };
      await this.storage.put(item, existing ? undefined : bytes);
      await this.evict(new Set([...inUse, id]));
      return item;
    } catch {
      return null;
    }
  }

  /** Record a successful use (upload): bump counters and remember the framing. */
  async touch(id: string, crop?: CropParams): Promise<void> {
    try {
      const item = (await this.storage.list()).find((i) => i.id === id);
      if (!item) return;
      await this.storage.put({
        ...item,
        lastUsedAt: this.now(),
        useCount: item.useCount + 1,
        lastCrop: crop ? { ...crop } : item.lastCrop,
      });
    } catch {
      /* best effort */
    }
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    try {
      return await this.storage.getBytes(id);
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.storage.delete(id);
    } catch {
      /* best effort */
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.clear();
    } catch {
      /* best effort */
    }
  }

  /** Drop least-recently-used items past the caps, sparing `keep`. */
  private async evict(keep: ReadonlySet<string>): Promise<void> {
    const items = (await this.storage.list()).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    let count = items.length;
    let bytes = totalBytes(items);
    for (const item of items) {
      if (count <= this.limits.maxItems && bytes <= this.limits.maxBytes) break;
      if (keep.has(item.id)) continue;
      await this.storage.delete(item.id);
      count--;
      bytes -= item.byteSize;
    }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatAgo(from: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
