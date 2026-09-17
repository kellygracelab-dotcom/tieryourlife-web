import { describe, expect, it } from "vitest";
import {
  clearEditorDraft,
  DEFAULT_TIERS,
  draftOf,
  editDraftKey,
  emptyDraft,
  LIMITS,
  isBlankDraft,
  loadEditorDraft,
  ownPicturesOf,
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
    expect(draft.items.every((item) => item.pictureId === null)).toBe(true);
  });

  it("takes an own picture without a name, and publishes it by id alone", () => {
    const draft = apply(
      ready(),
      { type: "addItem", title: "", imageUrl: "https://dl/preview", pictureId: "pic-1" },
      { type: "addItem", title: "Same again", imageUrl: "https://dl/preview", pictureId: "pic-1" },
    );
    expect(draft.items.at(-1)).toMatchObject({
      pictureId: "pic-1",
      imageUrl: "https://dl/preview",
    });
    expect(ownPicturesOf(draft)).toEqual(["pic-1"]);
    expect(publishBodyOf(draft)?.items.slice(2)).toEqual([
      { title: "", imageUrl: null, pictureId: "pic-1", tierIndex: null },
      { title: "Same again", imageUrl: null, pictureId: "pic-1", tierIndex: null },
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
        pictureId: null,
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
    expect(reduce(draft, { type: "placeTier", key: a, index: 0 })).toBe(draft);
    expect(reduce(draft, { type: "placeTier", key: a, index: 99 })).toBe(draft);
    expect(reduce(draft, { type: "placeTier", key: a, index: 4 }).tiers.at(-1)?.key).toBe(a);

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

  it("puts a published list back into the editor with keys of its own, and replaces a draft whole", () => {
    const draft = draftOf({
      id: "l1",
      title: "Ghibli, ranked",
      authorUid: "u1",
      authorName: "Danylo",
      authorPhotoUrl: null,
      category: "anime",
      itemCount: 2,
      coverImageUrl: null,
      previewImages: [],
      tierColors: [],
      updatedAt: 0,
      takeCount: 0,
      tiers: [{ label: "Top", caption: null, colorLight: "#B03A32", colorDark: "#F1948C" }],
      items: [
        { title: "Totoro", imageUrl: "https://img/t.jpg" },
        { title: "", imageUrl: "https://dl/published" },
      ],
    });
    expect(draft).toEqual({
      title: "Ghibli, ranked",
      category: "anime",
      tiers: [
        { key: "t0", label: "Top", caption: null, colorLight: "#B03A32", colorDark: "#F1948C" },
      ],
      items: [
        { key: "p0", title: "Totoro", imageUrl: "https://img/t.jpg", pictureId: null },
        { key: "p1", title: "", imageUrl: "https://dl/published", pictureId: null },
      ],
      serial: 3,
    });
    expect(problemsOf(draft)).toEqual([]);
    expect(reduce(emptyDraft(), { type: "replace", draft })).toBe(draft);
  });

  it("keeps each edit under its own key, apart from the new list", () => {
    const store = memoryStore();
    const draft = reduce(emptyDraft(), { type: "title", title: "Edited" });
    saveEditorDraft(store, draft, editDraftKey("l1"));
    expect(loadEditorDraft(store)).toBeNull();
    expect(loadEditorDraft(store, editDraftKey("l1"))).toEqual(draft);
    expect(store.read("tyl:edit:l1")).not.toBeNull();
    clearEditorDraft(store, editDraftKey("l1"));
    expect(loadEditorDraft(store, editDraftKey("l1"))).toBeNull();
  });

  it("is blank until a title or a card is in", () => {
    expect(isBlankDraft(emptyDraft())).toBe(true);
    expect(isBlankDraft(reduce(emptyDraft(), { type: "title", title: "  " }))).toBe(true);
    expect(isBlankDraft(reduce(emptyDraft(), { type: "title", title: "T" }))).toBe(false);
    expect(
      isBlankDraft(reduce(emptyDraft(), { type: "addItem", title: "One", imageUrl: null })),
    ).toBe(false);
  });

  it("reads a draft kept before own pictures existed", () => {
    const store = memoryStore();
    store.write(
      "tyl:new",
      JSON.stringify({
        title: "Old",
        category: "anime",
        tiers: [],
        items: [{ key: "i1", title: "Card", imageUrl: null }],
        serial: 6,
      }),
    );
    expect(loadEditorDraft(store)?.items).toEqual([
      { key: "i1", title: "Card", imageUrl: null, pictureId: null },
    ]);
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
