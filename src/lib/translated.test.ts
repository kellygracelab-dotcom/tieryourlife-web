import { describe, expect, it } from "vitest";
import type { PublishedList } from "../api/types";
import { listIn, titleIn } from "./translated";

const list = {
  id: "h1",
  title: "Studio Ghibli films",
  anonymous: true,
  authorUid: "tyl-editorial",
  authorName: "",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 2,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 1,
  takeCount: 0,
  names: { ru: "Фильмы студии Ghibli" },
  tiers: [
    { label: "S", caption: "Masterpiece", colorLight: "#f00", colorDark: "#f00" },
    { label: "A", caption: null, colorLight: "#0f0", colorDark: "#0f0" },
  ],
  items: [
    { title: "Spirited Away", imageUrl: null },
    { title: "Porco Rosso", imageUrl: null },
  ],
  translations: {
    ru: {
      "Studio Ghibli films": "Фильмы студии Ghibli",
      Masterpiece: "Шедевр",
      "Spirited Away": "Унесённые призраками",
      "Porco Rosso": "",
    },
  },
} satisfies PublishedList;

describe("a house list in the reader's language", () => {
  it("names a card in that language, or as written", () => {
    expect(titleIn(list, "ru")).toBe("Фильмы студии Ghibli");
    expect(titleIn(list, "de")).toBe("Studio Ghibli films");
    expect(titleIn({ title: "Ramen" }, "ru")).toBe("Ramen");
  });

  it("says its title, tiers and cards in that language, and the rest as written", () => {
    const ru = listIn(list, "ru");
    expect(ru.title).toBe("Фильмы студии Ghibli");
    expect(ru.tiers.map((tier) => [tier.label, tier.caption])).toEqual([
      ["S", "Шедевр"],
      ["A", null],
    ]);
    // An empty translation is no translation.
    expect(ru.items.map((item) => item.title)).toEqual(["Унесённые призраками", "Porco Rosso"]);
  });

  it("leaves a list with nothing for the language as it is", () => {
    expect(listIn(list, "ja")).toBe(list);
    const { translations: _, ...plain } = list;
    expect(listIn(plain, "ru")).toBe(plain);
  });
});
