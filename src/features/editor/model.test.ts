import { describe, expect, it } from "vitest";
import {
  clearEditorDraft,
  DEFAULT_TIERS,
  emptyDraft,
  LIMITS,
  loadEditorDraft,
  problemsOf,
  publishBodyOf,
  reduce,
  saveEditorDraft,
  TIER_PRESETS,
  type Draft,
  type DraftStoreLike,
  type EditorAction,
} from "./model";

const apply = (draft: Draft, ...actions: EditorAction[]): Draft => actions.reduce(reduce, draft);

const ready = (): Draft =>
  apply(
    emptyDraft(),
    { type: "title", title: "Every A24 film, ranked" },
    { type: "category", category: "film_tv" },
    { type: "addItem", title: "Ex Machina", imageUrl: "https://img/ex.jpg", key: "tmdb:1" },
    { type: "addItem", title: "The Witch", imageUrl: null },
  );

function memoryStore(): DraftStoreLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

describe("a new list", () => {
  it("starts with the app's five tiers and nothing else", () => {
    const draft = emptyDraft();
    expect(draft.title).toBe("");
    expect(draft.category).toBeNull();
    expect(draft.items).toEqual([]);
    expect(draft.tiers.map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D"]);
    expect(draft.tiers[0]).toMatchObject(DEFAULT_TIERS[0]!);
    expect(new Set(draft.tiers.map((tier) => tier.key)).size).toBe(5);
  });

  it("starts over on request", () => {
    expect(reduce(ready(), { type: "reset" })).toEqual(emptyDraft());
  });

  it("keeps the title within the backend's length", () => {
    const draft = reduce(emptyDraft(), { type: "title", title: "x".repeat(100) });
    expect(draft.title).toHaveLength(LIMITS.title);
  });
});

describe("cards", () => {
  it("adds a card by name, by picture, or both, and never twice from the catalogue", () => {
    const draft = apply(
      emptyDraft(),
      { type: "addItem", title: "  Named  card ", imageUrl: null },
      { type: "addItem", title: "", imageUrl: "https://img/only.jpg" },
      { type: "addItem", title: "Twice", imageUrl: null, key: "tmdb:9" },
      { type: "addItem", title: "Twice", imageUrl: null, key: "tmdb:9" },
      { type: "addItem", title: "   ", imageUrl: null },
    );
    expect(draft.items.map((item) => [item.key, item.title, item.imageUrl])).toEqual([
      ["i5", "Named card", null],
      ["i6", "", "https://img/only.jpg"],
      ["tmdb:9", "Twice", null],
    ]);
  });

  it("removes a card by its key and stops at the backend's ceiling", () => {
    let draft = apply(emptyDraft(), { type: "addItem", title: "One", imageUrl: null });
    const key = draft.items[0]!.key;
    expect(reduce(draft, { type: "removeItem", key }).items).toEqual([]);

    draft = {
      ...draft,
      items: Array.from({ length: LIMITS.items }, (_, i) => ({
        key: `k${i}`,
        title: `${i}`,
        imageUrl: null,
      })),
    };
    expect(reduce(draft, { type: "addItem", title: "More", imageUrl: null }).items).toHaveLength(
      LIMITS.items,
    );
  });
});

describe("tiers", () => {
  it("adds a tier with the next letter and the next preset, up to the backend's ceiling", () => {
    let draft = reduce(emptyDraft(), { type: "addTier" });
    expect(draft.tiers.at(-1)).toMatchObject({
      label: "E",
      caption: null,
      colorLight: TIER_PRESETS[5]!.light,
      colorDark: TIER_PRESETS[5]!.dark,
    });
    for (let i = 0; i < 30; i++) draft = reduce(draft, { type: "addTier" });
    expect(draft.tiers).toHaveLength(LIMITS.tiers);
    expect(new Set(draft.tiers.map((tier) => tier.key)).size).toBe(LIMITS.tiers);
  });

  it("renames, recolours, reorders and removes a tier, but never the last one", () => {
    let draft = emptyDraft();
    const [s, a] = draft.tiers.map((tier) => tier.key) as [string, string];
    draft = apply(
      draft,
      { type: "renameTier", key: s, label: " Top ", caption: "   " },
      { type: "recolourTier", key: a, colorLight: "#6B4E9E", colorDark: "#C9A9F0" },
      { type: "moveTier", key: a, by: -1 },
    );
    expect(draft.tiers[0]).toMatchObject({ key: a, colorLight: "#6B4E9E", colorDark: "#C9A9F0" });
    expect(draft.tiers[1]).toMatchObject({ key: s, label: " Top ", caption: null });
    expect(reduce(draft, { type: "moveTier", key: a, by: -1 })).toBe(draft);

    draft = apply(draft, { type: "removeTier", key: a });
    expect(draft.tiers.map((tier) => tier.key)).not.toContain(a);
    while (draft.tiers.length > 1) {
      draft = reduce(draft, { type: "removeTier", key: draft.tiers[0]!.key });
    }
    expect(reduce(draft, { type: "removeTier", key: draft.tiers[0]!.key }).tiers).toHaveLength(1);
  });
});

describe("what stands between the draft and Publish", () => {
  it("names each missing thing in page order", () => {
    expect(problemsOf(emptyDraft())).toEqual(["title", "category", "noItems"]);
    const draft = ready();
    expect(problemsOf(draft)).toEqual([]);
    expect(problemsOf({ ...draft, tiers: [] })).toEqual(["noTiers"]);
    expect(
      problemsOf(
        reduce(draft, { type: "renameTier", key: draft.tiers[0]!.key, label: "", caption: "" }),
      ),
    ).toEqual(["tierLabel"]);
  });

  it("builds the backend's request from a draft without problems, cards unranked", () => {
    const body = publishBodyOf(ready());
    expect(body).toEqual({
      title: "Every A24 film, ranked",
      category: "film_tv",
      coverImageUrl: null,
      coverPictureId: null,
      tiers: DEFAULT_TIERS.map((tier) => ({ ...tier })),
      items: [
        { title: "Ex Machina", imageUrl: "https://img/ex.jpg", pictureId: null, tierIndex: null },
        { title: "The Witch", imageUrl: null, pictureId: null, tierIndex: null },
      ],
    });
    expect(publishBodyOf(emptyDraft())).toBeNull();
  });
});

describe("the draft between visits", () => {
  it("survives a reload and is forgotten on request", () => {
    const store = memoryStore();
    const draft = ready();
    saveEditorDraft(store, draft);
    expect(loadEditorDraft(store)).toEqual(draft);
    clearEditorDraft(store);
    expect(loadEditorDraft(store)).toBeNull();
  });

  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ title: 1 }),
    JSON.stringify({ title: "x", tiers: [], items: [] }),
  ])("ignores what it cannot read: %s", (text) => {
    const store = memoryStore();
    store.write("tyl:new", text);
    expect(loadEditorDraft(store)).toBeNull();
  });
});
