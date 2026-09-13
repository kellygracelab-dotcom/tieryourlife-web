import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import { localStorageStore, type DraftStore } from "../board/draft";
import { claimKeptRankings } from "./claim";
import { keptKey, readKept, writeKept } from "./kept";

vi.mock("../../lib/api", () => ({ claimKept: vi.fn() }));

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
    keys: () => [...data.keys()],
  };
}

describe("claimKeptRankings", () => {
  it("claims what this device finished, once per account, and skips what is not a ranking", async () => {
    const store = memoryStore();
    writeKept(store, "a", { code: "aaaaaaaa", claimToken: "ta" });
    writeKept(store, "b", { code: "bbbbbbbb", claimToken: "tb", claimedBy: "u1" });
    writeKept(store, "c", { code: "cccccccc", claimToken: "tc", claimedBy: "someone-else" });
    store.write("tyl:draft:a", "{}");
    store.write(keptKey("broken"), "{");
    const claim = vi.fn(async () => ({ code: "x" }));

    await expect(claimKeptRankings(store, "u1", claim)).resolves.toBe(2);

    expect(claim.mock.calls).toEqual([
      ["aaaaaaaa", "ta"],
      ["cccccccc", "tc"],
    ]);
    expect(readKept(store, "a")).toEqual({ code: "aaaaaaaa", claimToken: "ta", claimedBy: "u1" });
    expect(readKept(store, "c")?.claimedBy).toBe("u1");
    expect(store.data.get("tyl:draft:a")).toBe("{}");
  });

  it("forgets a ranking the server will not hand over, and keeps trying after other failures", async () => {
    const store = memoryStore();
    writeKept(store, "gone", { code: "gggggggg", claimToken: "tg" });
    writeKept(store, "theirs", { code: "tttttttt", claimToken: "tt" });
    writeKept(store, "later", { code: "llllllll", claimToken: "tl" });
    writeKept(store, "taken", { code: "kkkkkkkk", claimToken: "tk" });
    const claim = vi.fn(async (code: string) => {
      if (code === "gggggggg") throw new ApiFailure({ kind: "notFound" });
      if (code === "tttttttt") throw new ApiFailure({ kind: "notYours" });
      if (code === "llllllll") throw new ApiFailure({ kind: "offline" });
      if (code === "kkkkkkkk") throw new ApiFailure({ kind: "conflict" });
      return { code };
    });

    await expect(claimKeptRankings(store, "u1", claim)).resolves.toBe(0);

    expect(readKept(store, "gone")).toBeNull();
    expect(readKept(store, "theirs")).toBeNull();
    expect(readKept(store, "later")).toEqual({ code: "llllllll", claimToken: "tl" });
    expect(readKept(store, "taken")).toEqual({ code: "kkkkkkkk", claimToken: "tk" });
  });

  it("does nothing with a store that cannot list its keys", async () => {
    const claim = vi.fn();
    const store: DraftStore = { read: () => null, write: () => {}, remove: () => {} };
    await expect(claimKeptRankings(store, "u1", claim)).resolves.toBe(0);
    expect(claim).not.toHaveBeenCalled();
  });

  it("walks the browser's storage", async () => {
    writeKept(localStorageStore, "abc", { code: "abcdefgh", claimToken: "t" });
    window.localStorage.setItem("other", "x");
    expect(localStorageStore.keys?.()).toEqual(expect.arrayContaining([keptKey("abc"), "other"]));
    const claim = vi.fn(async () => ({ code: "abcdefgh" }));
    await expect(claimKeptRankings(localStorageStore, "u1", claim)).resolves.toBe(1);
    expect(readKept(localStorageStore, "abc")?.claimedBy).toBe("u1");
  });
});
