import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { translationsToSave, wordsOf } from "./HouseTranslations";

const list = {
  id: "h1",
  title: "Ramen",
  authorUid: "tyl-editorial",
  authorName: "",
  authorPhotoUrl: null,
  category: "food",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 1,
  takeCount: 0,
  tiers: [
    { label: "S", caption: "Worth the trip", colorLight: "#f00", colorDark: "#f00" },
    { label: "A", caption: null, colorLight: "#0f0", colorDark: "#0f0" },
  ],
  items: [
    { title: "Miso", imageUrl: null },
    { title: "Ramen", imageUrl: null },
    { title: " ", imageUrl: null },
  ],
} satisfies PublishedList;

describe("a house list's words", () => {
  it("are every text a reader sees, once each, in the page's order", () => {
    expect(wordsOf(list)).toEqual(["Ramen", "S", "Worth the trip", "A", "Miso"]);
  });

  it("go out tidied: no empty ones, none the list no longer has, no English", () => {
    expect(
      translationsToSave(list, {
        en: { Ramen: "Ramen" },
        ru: { Ramen: " Рамен ", Miso: "", Shoyu: "Сёю" },
        ja: { Miso: "" },
      }),
    ).toEqual({ ru: { Ramen: "Рамен" } });
  });
});
