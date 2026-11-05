import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import type { KeyValueStore } from "../../lib/storage";
import {
  clearDraft,
  draftKey,
  loadDraft,
  loadDraftLabels,
  loadPlacedDraft,
  parseDraft,
  saveDraft,
  serializeDraft,
  withLabels,
  type DraftScope,
} from "./draft";

const scope: DraftScope = { id: "abc", updatedAt: 1700, itemCount: 4, tierCount: 2 };

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
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

  it("keeps a reader's tier words with the rows until other words are given", () => {
    const store = memoryStore();
    saveDraft(store, scope, [[0], []], ["Top", " "]);
    expect(loadDraftLabels(store, scope)).toEqual(["Top", null]);
    // A move on the board sends the rows alone: the words stay.
    saveDraft(store, scope, [[0], [1]]);
    expect(loadDraftLabels(store, scope)).toEqual(["Top", null]);
    expect(loadDraft(store, scope)).toEqual([[0], [1]]);
    // Starting again from the author's puts the list's own words back.
    saveDraft(store, scope, [[1], []], null);
    expect(loadDraftLabels(store, scope)).toBeNull();
    // Words for another version of the list, or for another count of tiers, are nobody's.
    saveDraft(store, scope, [[0], []], ["Top", "Meh"]);
    expect(loadDraftLabels(store, { ...scope, updatedAt: 1800 })).toBeNull();
    store.write(draftKey("abc"), JSON.stringify({ ...base(), rows: [[], []], labels: ["Top"] }));
    expect(loadDraftLabels(store, scope)).toBeNull();
  });

  it("draws the list under the words Mine wears", () => {
    const tier = { caption: "Masterpiece", colorLight: "#f00", colorDark: "#a00" };
    const list = {
      id: "abc",
      tiers: [
        { ...tier, label: "S" },
        { ...tier, label: "A" },
      ],
    } as PublishedList;
    expect(withLabels(list, null)).toBe(list);
    expect(withLabels(list, [null, "Meh"]).tiers.map((one) => [one.label, one.caption])).toEqual([
      ["S", "Masterpiece"],
      ["Meh", "Masterpiece"],
    ]);
  });

  it("counts a draft as begun only once a card in it is placed", () => {
    const store = memoryStore();
    expect(loadPlacedDraft(store, scope)).toBeNull();
    saveDraft(store, scope, [[], []]);
    expect(loadPlacedDraft(store, scope)).toBeNull();
    saveDraft(store, scope, [[], [3]]);
    expect(loadPlacedDraft(store, scope)).toEqual([[], [3]]);
  });
});

function base() {
  return { listId: scope.id, updatedAt: scope.updatedAt, itemCount: scope.itemCount };
}
