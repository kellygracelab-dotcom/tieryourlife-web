import { describe, expect, it } from "vitest";
import type { SectionStats } from "../../api/sections";
import { CATEGORIES } from "../../api/types";
import {
  approvedOnly,
  builtInSection,
  homeSlots,
  isSectionIcon,
  orderSections,
  SECTION_ICONS,
  sectionOf,
  sectionPath,
  sectionsFrom,
  topicPath,
  type Section,
} from "./model";

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

const ids = (sections: readonly Section[]) => sections.map((section) => section.id);

const many = (n: number): Section[] =>
  Array.from({ length: n }, (_, at) => sectionOf(stats(`s-${at}`, { name: `S${at}` })));

describe("sections", () => {
  it("stands in with the nine, in the app's order, before the backend answers", () => {
    expect(ids(sectionsFrom(null))).toEqual([
      "anime",
      "film_tv",
      "games",
      "music",
      "books",
      "food",
      "sport",
      "people",
      "other",
    ]);
    expect(builtInSection("food")).toMatchObject({
      name: "Food",
      icon: "restaurant",
      tint: { light: "#9A5638", dark: "#794732" },
      picture: null,
      builtIn: true,
    });
  });

  it("reads one of the nine with its counts, and a section of somebody's own with its look", () => {
    expect(sectionOf(stats("games", { listCount: 12, newThisWeek: 3 }))).toMatchObject({
      id: "games",
      name: "Games",
      icon: "sports_esports",
      listCount: 12,
      newThisWeek: 3,
    });
    const own = sectionOf(
      stats("street-food", {
        name: "Street food",
        names: { uk: "Вулична їжа" },
        icon: "local_cafe",
        pictureUrl: "https://img/street.jpg",
        tint: { light: "#7A4A33", dark: "#3A2A26" },
        status: "pending",
      }),
      "uk",
    );
    expect(own).toMatchObject({
      name: "Вулична їжа",
      icon: "local_cafe",
      picture: "https://img/street.jpg",
      tint: { light: "#7A4A33", dark: "#3A2A26" },
      status: "pending",
      builtIn: false,
    });
    expect(sectionOf(stats("street-food", { name: "Street food" }), "de").name).toBe("Street food");
  });

  it("wears Other's look for what it cannot draw: an unknown icon, a picture not on https", () => {
    const odd = sectionOf(stats("x-1", { name: "X", icon: "ramen_dining", pictureUrl: "null" }));
    expect(odd).toMatchObject({ icon: "category", picture: null, tint: { light: "#55566A" } });
  });

  it("leaves out what nobody should see a tile of, and waiting sections but one's own", () => {
    const answer = [
      stats("anime"),
      stats("gone", { name: "Gone", status: "merged" }),
      stats("quiet", { name: "Quiet", hidden: true }),
      stats("no", { name: "No", status: "declined", proposerUid: "u1" }),
      stats("mine", { name: "Mine", status: "pending", proposerUid: "u1" }),
      stats("theirs", { name: "Theirs", status: "pending", proposerUid: "u2" }),
      stats("other"),
    ];
    expect(ids(sectionsFrom(answer, "u1"))).toEqual(["anime", "mine", "other"]);
    expect(ids(sectionsFrom(answer, "guest"))).toEqual(["anime", "other"]);
    expect(ids(approvedOnly(sectionsFrom(answer, "u1")))).toEqual(["anime", "other"]);
  });

  it("offers the 24 icons in Claude Design's order, the nine's own among them", () => {
    expect(SECTION_ICONS).toHaveLength(24);
    expect(SECTION_ICONS.slice(0, 3)).toEqual(["category", "movie", "animation"]);
    expect(SECTION_ICONS.at(-1)).toBe("star");
    for (const id of CATEGORIES) expect(isSectionIcon(builtInSection(id).icon)).toBe(true);
    expect(isSectionIcon("ramen_dining")).toBe(false);
  });

  it("orders followed first, then pinned, then the busiest month, then the earlier approved; Other last", () => {
    const sections = [
      sectionOf(stats("other", { following: true })),
      sectionOf(stats("anime")),
      sectionOf(stats("late", { name: "Late", approvedAt: 20 })),
      sectionOf(stats("early", { name: "Early", approvedAt: 10 })),
      sectionOf(stats("busy", { name: "Busy", lists30d: 9, approvedAt: 30 })),
      sectionOf(stats("pinned", { name: "Pinned", rank: 2 })),
      sectionOf(stats("first", { name: "First", rank: 1 })),
      sectionOf(stats("music", { following: true })),
    ];
    expect(ids(orderSections(sections))).toEqual([
      "music",
      "first",
      "pinned",
      "busy",
      "anime",
      "early",
      "late",
      "other",
    ]);
  });

  it("gives the phone eight tiles and Other's full-width row with the nine", () => {
    const slots = homeSlots(sectionsFrom(null), "compact");
    expect(ids(slots.tiles)).toHaveLength(8);
    expect(slots.row).toMatchObject({ id: "other" });
    expect(slots.allTile).toBe(false);
  });

  it("leaves the phone's row out when the tiles pair up, and leads to all of them when they don't fit", () => {
    expect(homeSlots(many(8), "compact")).toMatchObject({ row: null, allTile: false });
    const crowded = homeSlots(many(12), "compact");
    expect(crowded.tiles).toHaveLength(8);
    expect(crowded.row).toBe("all");
  });

  it("fills nine slots on a tablet and ten on a wide screen, the last leading to all when needed", () => {
    expect(homeSlots(many(9), "medium")).toMatchObject({ allTile: false });
    expect(homeSlots(many(9), "medium").tiles).toHaveLength(9);
    expect(homeSlots(many(10), "medium").tiles).toHaveLength(8);
    expect(homeSlots(many(10), "medium").allTile).toBe(true);
    expect(homeSlots(many(10), "expanded")).toMatchObject({ allTile: false });
    expect(homeSlots(many(11), "expanded").tiles).toHaveLength(9);
    expect(homeSlots(many(11), "expanded").allTile).toBe(true);
  });

  it("addresses a section and a topic the way the app's links do", () => {
    expect(sectionPath("film_tv")).toBe("/s/film_tv");
    expect(topicPath("games", "abc 1")).toBe("/s/games/t/abc%201");
  });
});
