import { describe, expect, it } from "vitest";
import type { ApiError } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { builtInSection, sectionOf, type Section } from "./model";
import {
  changesOf,
  fileUnderChoices,
  forgetProposal,
  isSectionName,
  KEPT_KEY,
  KEPT_PICTURE_KEY,
  keepProposal,
  myWaiting,
  readKeptProposal,
  shortOf,
  tidySectionName,
  translationsOf,
  troubleOf,
  wordsOf,
} from "./proposal";

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

const ids = (sections: readonly Section[]) => sections.map((one) => one.id);

describe("a proposal's name", () => {
  it("is kept with its spaces collapsed and trimmed", () => {
    expect(tidySectionName("  Street   food \n")).toBe("Street food");
  });

  it("follows the backend: 2 to 24 characters, a letter or a digit among them", () => {
    expect(isSectionName("Go")).toBe(true);
    expect(isSectionName("  G  ")).toBe(false);
    expect(isSectionName("--")).toBe(false);
    expect(isSectionName("a".repeat(24))).toBe(true);
    expect(isSectionName("a".repeat(25))).toBe(false);
    // Characters, not UTF-16 units: twelve emoji and a letter are thirteen.
    expect(isSectionName(`${"🍜".repeat(12)}a`)).toBe(true);
    expect(isSectionName("Їжа")).toBe(true);
  });
});

describe("what a proposer sees", () => {
  const sections = [
    sectionOf(stats("mine", { name: "Mine", status: "pending", proposerUid: "u1" })),
    sectionOf(stats("theirs", { name: "Theirs", status: "pending", proposerUid: "u2" })),
    sectionOf(stats("unsaid", { name: "Unsaid", status: "pending" })),
    builtInSection("food"),
  ];

  it("counts only the person's own waiting proposals", () => {
    expect(ids(myWaiting(sections, "u1"))).toEqual(["mine", "unsaid"]);
  });

  it("files lists under approved sections in the owner's order, Other last", () => {
    const choices = fileUnderChoices([
      builtInSection("other"),
      sectionOf(stats("late", { name: "Late", status: "approved", approvedAt: 9 })),
      builtInSection("games"),
      sectionOf(stats("pinned", { name: "Pinned", status: "approved", rank: 0 })),
      builtInSection("anime"),
      ...sections,
    ]);
    expect(ids(choices)).toEqual(["pinned", "anime", "games", "food", "late", "other"]);
  });

  it("names a picture too small by its width, or by its 16:10 width when it is too low", () => {
    expect(shortOf({ width: 720, height: 1000 })).toBe(720);
    expect(shortOf({ width: 4000, height: 400 })).toBe(640);
    expect(shortOf({ width: 960, height: 600 })).toBeNull();
    expect(shortOf({ width: 3000, height: 2000 })).toBeNull();
  });
});

describe("a refusal, placed", () => {
  const invalid = (code: string, more: { id?: string; why?: string } = {}): ApiError => ({
    kind: "invalid",
    detail: null,
    code,
    ...more,
  });

  it.each([
    [invalid("NAME_TAKEN", { id: "food" }), { kind: "nameTaken", id: "food" }],
    [invalid("NAME_TAKEN"), { kind: "nameTaken", id: null }],
    [invalid("BAD_NAME"), { kind: "badName" }],
    [invalid("TOO_MANY_PENDING"), { kind: "tooMany" }],
    [invalid("BAD_PICTURE", { why: "too_small" }), { kind: "tooSmall" }],
    [invalid("BAD_PICTURE", { why: "not_16_10" }), { kind: "notCropped" }],
    [invalid("BAD_PICTURE", { why: "not_image" }), { kind: "notImage" }],
    // A picture that went missing on the way goes again with the next try.
    [invalid("BAD_PICTURE", { why: "missing" }), { kind: "failed" }],
    [invalid("BAD_ICON"), { kind: "failed" }],
    [invalid("BAD_FILE_UNDER"), { kind: "failed" }],
    [{ kind: "tooManyRequests", code: "TOO_MANY_PROPOSALS" }, { kind: "tooManyToday" }],
    [{ kind: "banned", until: null }, { kind: "banned" }],
    [{ kind: "notSignedIn" }, { kind: "failed" }],
    [{ kind: "offline" }, { kind: "failed" }],
    [{ kind: "unknown", status: 500 }, { kind: "failed" }],
  ] as [ApiError, unknown][])("%o is %o", (error, trouble) => {
    expect(troubleOf(error)).toEqual(trouble);
  });
});

describe("a proposal kept for the next try", () => {
  const kept = {
    name: "Street food",
    icon: "restaurant",
    fileUnder: "food",
    picture: "data:image/webp;base64,AAAA",
  } as const;

  it("comes back as it was kept, and goes when forgotten", () => {
    const store = memoryStore();
    expect(readKeptProposal(store)).toBeNull();
    keepProposal(store, kept);
    expect(readKeptProposal(store)).toEqual(kept);
    forgetProposal(store);
    expect(readKeptProposal(store)).toBeNull();
    expect(store.read(KEPT_PICTURE_KEY)).toBeNull();
  });

  it("keeps its words when the picture will not fit, and reads nothing it does not trust", () => {
    // The tab's storage swallows a write over its quota: the picture is simply not there.
    const data = new Map<string, string>();
    const full: KeyValueStore = {
      read: (key) => data.get(key) ?? null,
      write: (key, value) => {
        if (key !== KEPT_PICTURE_KEY) data.set(key, value);
      },
      remove: (key) => void data.delete(key),
    };
    keepProposal(full, kept);
    expect(readKeptProposal(full)).toEqual({ ...kept, picture: null });

    const store = memoryStore();
    store.write(KEPT_KEY, "{not json");
    expect(readKeptProposal(store)).toBeNull();
    store.write(KEPT_KEY, JSON.stringify({ name: 3 }));
    expect(readKeptProposal(store)).toBeNull();
    store.write(KEPT_KEY, JSON.stringify({ name: "X", icon: "ramen", fileUnder: "food" }));
    store.write(KEPT_PICTURE_KEY, "javascript:alert(1)");
    expect(readKeptProposal(store)).toEqual({
      name: "X",
      icon: "category",
      fileUnder: "food",
      picture: null,
    });
  });
});

describe("an edit", () => {
  it("starts from the section as stored, or as the site draws one not named yet", () => {
    expect(
      wordsOf(
        stats("street-food", { name: "Street food", names: { uk: " Їжа ", de: "" }, icon: "pets" }),
        {
          name: "x",
          icon: "category",
        },
      ),
    ).toEqual({ name: "Street food", names: { uk: "Їжа" }, icon: "pets" });
    expect(wordsOf(stats("anime"), builtInSection("anime"))).toEqual({
      name: "Anime",
      names: {},
      icon: "animation",
    });
  });

  it("sends only what changed, translations left empty dropped", () => {
    const start = { name: "Street food", names: { uk: "Їжа" }, icon: "restaurant" } as const;
    expect(changesOf(start, { ...start, name: " Street food " })).toEqual({});
    expect(changesOf(start, { ...start, name: "Street eats", icon: "pets" })).toEqual({
      name: "Street eats",
      icon: "pets",
    });
    expect(changesOf(start, { ...start, names: { uk: "Їжа", de: "Streetfood", fr: " " } })).toEqual(
      {
        names: { uk: "Їжа", de: "Streetfood" },
      },
    );
    expect(translationsOf({ en: "", ja: undefined, ar: " طعام " })).toEqual({ ar: "طعام" });
  });
});
