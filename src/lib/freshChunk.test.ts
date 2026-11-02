import { describe, expect, it, vi } from "vitest";
import { CHUNK_RETRY_KEY, freshChunk, reloadOnce } from "./freshChunk";
import { memoryStore, type KeyValueStore } from "./storage";

describe("freshChunk", () => {
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
    await expect(gone()).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
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
});
