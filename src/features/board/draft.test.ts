import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  draftKey,
  loadDraft,
  localStorageStore,
  parseDraft,
  saveDraft,
  serializeDraft,
  type DraftScope,
  type DraftStore,
} from "./draft";

const scope: DraftScope = { id: "abc", updatedAt: 1700, itemCount: 4, tierCount: 2 };

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

describe("draft", () => {
  it("round-trips placements for the snapshot they were made on", () => {
    const text = serializeDraft(scope, [[2, 0], [3]]);
    expect(parseDraft(text, scope)).toEqual([[2, 0], [3]]);
  });

  it.each([
    ["another list", { ...scope, id: "def" }],
    ["a republished list", { ...scope, updatedAt: 1800 }],
    ["a list with a different card count", { ...scope, itemCount: 5 }],
    ["a list with a different tier count", { ...scope, tierCount: 3 }],
  ])("forgets a draft that belongs to %s", (_, other) => {
    expect(parseDraft(serializeDraft(scope, [[1], []]), other)).toBeNull();
  });

  it.each([
    ["not json", "{"],
    ["null", "null"],
    ["a number", "5"],
    ["rows that are not arrays", JSON.stringify({ ...base(), rows: [1, 2] })],
    ["a card outside the list", JSON.stringify({ ...base(), rows: [[4], []] })],
    ["a fractional card", JSON.stringify({ ...base(), rows: [[0.5], []] })],
    ["a card placed twice", JSON.stringify({ ...base(), rows: [[1], [1]] })],
    ["nothing at all", null],
  ])("rejects %s", (_, text) => {
    expect(parseDraft(text, scope)).toBeNull();
  });

  it("saves, loads and clears through a store under one key per list", () => {
    const store = memoryStore();
    saveDraft(store, scope, [[0], [1, 2]]);
    expect(store.data.has(draftKey("abc"))).toBe(true);
    expect(loadDraft(store, scope)).toEqual([[0], [1, 2]]);
    clearDraft(store, "abc");
    expect(loadDraft(store, scope)).toBeNull();
  });

  describe("localStorageStore", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      window.localStorage.clear();
    });

    it("uses the browser's storage", () => {
      localStorageStore.write("k", "v");
      expect(localStorageStore.read("k")).toBe("v");
      localStorageStore.remove("k");
      expect(localStorageStore.read("k")).toBeNull();
    });

    it("shrugs when storage throws", () => {
      const boom = () => {
        throw new Error("blocked");
      };
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
      expect(() => localStorageStore.write("k", "v")).not.toThrow();
      expect(localStorageStore.read("k")).toBeNull();
      expect(() => localStorageStore.remove("k")).not.toThrow();
    });
  });
});

function base() {
  return { listId: scope.id, updatedAt: scope.updatedAt, itemCount: scope.itemCount };
}
