import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RETRY_KEY,
  freshChunk,
  inTheMiddle,
  reloadInto,
  reloadOnce,
  resetFreshChunkForTests,
} from "./freshChunk";
import { memoryStore, type KeyValueStore } from "./storage";

describe("freshChunk", () => {
  beforeEach(resetFreshChunkForTests);

  it("hands the chunk over", async () => {
    const reload = vi.fn();
    await expect(freshChunk(async () => "page", { store: memoryStore(), reload })()).resolves.toBe(
      "page",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload again for a piece that never comes once the reloaded page came", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    let time = 1_000_000;
    const now = () => time;
    // The back-up engine will not come: one reload.
    expect(reloadOnce({ store, reload, now })).toBe(true);
    // The reloaded page's own chunk comes, and the engine still does not.
    resetFreshChunkForTests();
    time += 2_000;
    await expect(freshChunk(async () => "page", { store, reload, now })()).resolves.toBe("page");
    expect(reloadOnce({ store, reload, now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once in a tab's life, however long after, so a file that never comes cannot reload it again", () => {
    const store = memoryStore();
    const reload = vi.fn();
    let time = 1_000_000;
    const now = () => time;
    expect(reloadOnce({ store, reload, now })).toBe(true);
    // Eleven minutes on, an edit asks for the back-up engine again.
    resetFreshChunkForTests();
    time += 11 * 60_000;
    expect(reloadOnce({ store, reload, now })).toBe(false);
    time += 24 * 60 * 60_000;
    expect(reloadOnce({ store, reload, now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // A try kept by the site before it wrote down times counts all the same.
    const old = memoryStore();
    old.write(CHUNK_RETRY_KEY, "1");
    expect(reloadOnce({ store: old, reload, now })).toBe(false);
  });

  it("never reloads under someone's hands: text being typed, or a dialog open", async () => {
    const reload = vi.fn();
    const store = memoryStore();
    const missing = freshChunk(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      { store, reload, busy: () => true },
    );
    await expect(missing()).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
    // Nothing was spent: once the person is done, a deploy's missing file still gets its reload.
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
    expect(reloadOnce({ store, reload, busy: () => false })).toBe(true);
  });

  it("reads a half-typed card name or an open sheet as work a reload would lose", () => {
    document.body.innerHTML = '<input id="name" /><button id="go">Go</button>';
    const field = document.getElementById("name") as HTMLInputElement;
    field.focus();
    expect(inTheMiddle()).toBe(false);
    field.value = "Dun";
    expect(inTheMiddle()).toBe(true);
    document.getElementById("go")!.focus();
    expect(inTheMiddle()).toBe(false);
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"></div>');
    expect(inTheMiddle()).toBe(true);
    document.body.innerHTML = "";
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

    // After the reload the same tab still cannot get it: a real failure, every time it is asked for.
    resetFreshChunkForTests();
    await expect(gone()).rejects.toThrow(/dynamically imported/);
    await expect(gone()).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
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
    expect(store.read(CHUNK_RETRY_KEY)).not.toBeNull();
  });

  it("keeps the try when a stylesheet failed but the module came, so the reload does not loop", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    expect(reloadOnce({ store, reload })).toBe(true);
    await expect(freshChunk(async () => "page", { store, reload })()).resolves.toBe("page");
    expect(store.read(CHUNK_RETRY_KEY)).not.toBeNull();
  });
});
