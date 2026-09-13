import { describe, expect, it } from "vitest";
import type { DraftStore } from "../board/draft";
import { keptKey, readKept, writeKept } from "./kept";

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
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

  it.each(["{", "null", "7", JSON.stringify({ code: 1, claimToken: "x" })])(
    "ignores what it cannot read: %s",
    (text) => {
      const store = memoryStore();
      store.write(keptKey("abc"), text);
      expect(readKept(store, "abc")).toBeNull();
    },
  );
});
