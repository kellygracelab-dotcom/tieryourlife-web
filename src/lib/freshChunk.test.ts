import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RETRY_KEY,
  freshChunk,
  reloadInto,
  reloadOnce,
  resetFreshChunkForTests,
} from "./freshChunk";
import { memoryStore, type KeyValueStore } from "./storage";

describe("freshChunk", () => {
  beforeEach(resetFreshChunkForTests);

  it("hands the chunk over and forgets an earlier try", async () => {
    const store = memoryStore();
    store.write(CHUNK_RETRY_KEY, "1");
    const reload = vi.fn();
    await expect(freshChunk(async () => "page", { store, reload })()).resolves.toBe("page");
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once for a chunk a deploy took away, and lets the second failure through", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    const gone = freshChunk(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      { store, reload },
    );
    let settled = false;
    void gone().finally(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    // After the reload the same tab still cannot get it: a real failure.
    resetFreshChunkForTests();
    await expect(gone()).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
  });

  it("does not reload offline, where the reload would land on the browser's error page", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    const missing = freshChunk(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      { store, reload, online: () => false },
    );
    await expect(missing()).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
    // Nothing tried yet: back online, a deploy's missing file still gets its one reload.
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
    expect(reloadOnce({ store, reload, online: () => false })).toBe(false);
  });

  it("reloads into the page the tab was on its way to, and in place when it was going nowhere", () => {
    const reload = vi.fn();
    expect(reloadOnce({ store: memoryStore(), reload })).toBe(true);
    expect(reload).toHaveBeenLastCalledWith(null);

    resetFreshChunkForTests();
    reloadInto(() => "/b?view=rows");
    expect(reloadOnce({ store: memoryStore(), reload })).toBe(true);
    expect(reload).toHaveBeenLastCalledWith("/b?view=rows");
  });

  it("does not reload where nothing can be remembered", () => {
    const refusing: KeyValueStore = {
      read: () => {
        throw new Error("denied");
      },
      write: () => {
        throw new Error("denied");
      },
      remove: () => undefined,
    };
    const reload = vi.fn();
    expect(reloadOnce({ store: refusing, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads only once when Vite's handler already asked for the reload and the import comes back empty", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    // main.tsx: the preload error, one reload asked for, the import let go on.
    expect(reloadOnce({ store, reload })).toBe(true);
    const empty = freshChunk(
      async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'AboutPage')");
      },
      { store, reload },
    );
    let settled = false;
    void empty().finally(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // The reload that follows still knows the try was made.
    expect(store.read(CHUNK_RETRY_KEY)).toBe("1");
  });

  it("keeps the try when a stylesheet failed but the module came, so the reload does not loop", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    expect(reloadOnce({ store, reload })).toBe(true);
    await expect(freshChunk(async () => "page", { store, reload })()).resolves.toBe("page");
    expect(store.read(CHUNK_RETRY_KEY)).toBe("1");
  });
});
