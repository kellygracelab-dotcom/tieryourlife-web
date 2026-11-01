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
  sectionName,
  sectionOf,
  sectionPath,
  sectionsFrom,
  sectionStyle,
  servedPicture,
  topicPath,
  topicPicture,
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

  it("names any section: the backend's in this language, the nine by the site's words, the rest as Other", () => {
    const sections = [
      sectionOf(stats("street-food", { name: "Street food", names: { uk: "Вулична їжа" } }), "uk"),
      sectionOf(stats("s-k3j9x2ab", { name: "Ramen" }), "uk"),
      sectionOf(stats("music", { name: "Music", names: { uk: "Музика" } }), "uk"),
      sectionOf(stats("other", { name: "Other", names: { uk: "Інше" } }), "uk"),
    ];
    expect(sectionName("street-food", sections)).toBe("Вулична їжа");
    expect(sectionName("s-k3j9x2ab", sections)).toBe("Ramen");
    expect(sectionName("music", sections)).toBe("Музика");
    // One of the nine the backend did not send, hidden say: the site's own word for it.
    expect(sectionName("food", sections)).toBe("Food");
    // An id nobody here knows yet reads as Other, by the name Other has here.
    expect(sectionName("k-dramas", sections)).toBe("Інше");
    expect(sectionName("k-dramas", [])).toBe("Other");
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

  it("leaves the phone's row out when the tiles pair up, and leads to all of them past twenty", () => {
    expect(homeSlots(many(8), "compact")).toMatchObject({ row: null, allTile: false });
    expect(homeSlots(many(20), "compact")).toMatchObject({ row: null, allTile: false });
    expect(homeSlots(many(19), "compact").row).toMatchObject({ id: "s-18" });
    const crowded = homeSlots(many(21), "compact");
    expect(crowded.tiles).toHaveLength(20);
    expect(crowded.row).toBe("all");
  });

  it("shows the first twenty on a tablet and a wide screen, then a tile leading to all of them", () => {
    for (const width of ["medium", "expanded"] as const) {
      expect(homeSlots(many(12), width)).toMatchObject({ allTile: false });
      expect(homeSlots(many(12), width).tiles).toHaveLength(12);
      expect(homeSlots(many(20), width)).toMatchObject({ allTile: false });
      expect(homeSlots(many(21), width).tiles).toHaveLength(20);
      expect(homeSlots(many(21), width).allTile).toBe(true);
    }
  });

  it("draws a stored section or topic picture through the site's address at the width drawn", () => {
    const stored = (path: string) =>
      `https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/${path}?alt=media&token=t`;
    expect(servedPicture(stored("sections%2Ffilm_tv%2F579c-14"))).toBe(
      "/img/480/sections/film_tv/579c-14",
    );
    expect(servedPicture(stored("topics%2FpFy4%2Fp_1"), 1600)).toBe("/img/1600/topics/pFy4/p_1");
    // A proposal's private copy, somebody's upload or another host is drawn as it is.
    for (const other of [
      stored("proposals%2Fx%2Fp"),
      stored("sections%2F..%2Fp"),
      "https://image.tmdb.org/t/p/w342/a.jpg",
    ]) {
      expect(servedPicture(other)).toBe(other);
    }
    const look = sectionOf(stats("film_tv", { pictureUrl: stored("sections%2Ffilm_tv%2Fp1") }));
    expect(sectionStyle(look)).toMatchObject({
      "--section-picture": 'url("/img/480/sections/film_tv/p1")',
    });
    expect(sectionStyle(look, 1600)).toMatchObject({
      "--section-picture": 'url("/img/1600/sections/film_tv/p1")',
    });
  });

  it("addresses a section and a topic the way the app's links do", () => {
    expect(sectionPath("film_tv")).toBe("/s/film_tv");
    expect(topicPath("games", "abc 1")).toBe("/s/games/t/abc%201");
  });

  it("draws a topic's own picture only from an https address", () => {
    expect(topicPicture({ pictureUrl: "https://pictures.test/t.webp" })).toBe(
      "https://pictures.test/t.webp",
    );
    expect(topicPicture({ pictureUrl: "http://pictures.test/t.webp" })).toBeNull();
    expect(topicPicture({ pictureUrl: null })).toBeNull();
    expect(topicPicture({})).toBeNull();
  });
});
