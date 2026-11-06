import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "../../lib/storage";
import { forgetKept, forgetKeptOf, keptBy, keptFor, keptKey, readKept, writeKept } from "./kept";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
    keys: () => [...data.keys()],
  };
}

describe("kept ranking", () => {
  it("remembers the code and the claim token per list", () => {
    const store = memoryStore();
    writeKept(store, "abc", { code: "abcdefgh", claimToken: "secret" });
    expect(store.data.has(keptKey("abc"))).toBe(true);
    expect(readKept(store, "abc")).toEqual({ code: "abcdefgh", claimToken: "secret" });
    expect(readKept(store, "other")).toBeNull();
  });

  it("remembers which account a ranking went to, and ignores a claim that is not a uid", () => {
    const store = memoryStore();
    writeKept(store, "abc", { code: "abcdefgh", claimToken: "secret", claimedBy: "u1" });
    expect(readKept(store, "abc")).toEqual({
      code: "abcdefgh",
      claimToken: "secret",
      claimedBy: "u1",
    });
    store.write(
      keptKey("abc"),
      JSON.stringify({ code: "abcdefgh", claimToken: "secret", claimedBy: 7 }),
    );
    expect(readKept(store, "abc")).toEqual({ code: "abcdefgh", claimToken: "secret" });
  });

  it("remembers the rows the link holds and the list's version, and drops rows it cannot read", () => {
    const store = memoryStore();
    const kept = { code: "abcdefgh", claimToken: "secret", rows: [[1], [0, 2]], version: 9 };
    writeKept(store, "abc", kept);
    expect(readKept(store, "abc")).toEqual(kept);
    store.write(keptKey("abc"), JSON.stringify({ ...kept, rows: [["x"]] }));
    expect(readKept(store, "abc")).toEqual({ code: "abcdefgh", claimToken: "secret", version: 9 });
  });

  it("gives the link back only for the same rows of the same version", () => {
    const kept = { code: "abcdefgh", claimToken: "secret", rows: [[1], [0]], version: 9 };
    expect(keptFor(kept, 9, [[1], [0]])).toBe("abcdefgh");
    expect(keptFor(kept, 9, [[1], []])).toBeNull();
    expect(keptFor(kept, 10, [[1], [0]])).toBeNull();
    expect(keptFor({ code: "abcdefgh", claimToken: "secret" }, 9, [[1], [0]])).toBeNull();
    expect(keptFor(null, 9, [])).toBeNull();
  });

  it("is shown only to the person it is theirs, on a browser others use too", () => {
    const guests = { code: "abcdefgh", claimToken: "secret" };
    const accounts = { ...guests, claimedBy: "u1" };
    expect(keptBy(accounts, "u1")).toBe(accounts);
    expect(keptBy(accounts, null)).toBeNull();
    expect(keptBy(accounts, "u2")).toBeNull();
    expect(keptBy(accounts, undefined)).toBeNull();
    // A guest's goes to whoever signs in next, unless the server keeps it for another account.
    expect(keptBy(guests, null)).toBe(guests);
    expect(keptBy(guests, undefined)).toBe(guests);
    expect(keptBy(guests, "u2")).toBe(guests);
    expect(keptBy({ ...guests, refusedTo: "u2" }, "u2")).toBeNull();
    expect(keptBy(null, "u1")).toBeNull();
  });

  it("forgets a deleted account's rankings and keeps everyone else's", () => {
    const store = memoryStore();
    writeKept(store, "a", { code: "aaaaaaaa", claimToken: "ta", claimedBy: "gone" });
    writeKept(store, "b", { code: "bbbbbbbb", claimToken: "tb", claimedBy: "other" });
    writeKept(store, "c", { code: "cccccccc", claimToken: "tc" });
    store.write("tyl:draft:a", "{}");
    forgetKeptOf(store, "gone");
    expect([...store.data.keys()].sort()).toEqual(["tyl:draft:a", keptKey("b"), keptKey("c")]);
  });

  it.each(["{", "null", "7", JSON.stringify({ code: 1, claimToken: "x" })])(
    "ignores what it cannot read: %s",
    (text) => {
      const store = memoryStore();
      store.write(keptKey("abc"), text);
      expect(readKept(store, "abc")).toBeNull();
    },
  );
});

describe("forgetting a kept ranking", () => {
  it("forgets the list's ranking only while it is the one deleted", () => {
    const store = memoryStore();
    writeKept(store, "abc", { code: "abcdefgh", claimToken: "secret" });
    forgetKept(store, "abc", "zzzzzzzz");
    expect(readKept(store, "abc")).not.toBeNull();
    forgetKept(store, "abc", "abcdefgh");
    expect(store.data.has(keptKey("abc"))).toBe(false);
  });
});
