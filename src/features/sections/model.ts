import type { CSSProperties } from "react";
import type { SectionStats, SectionStatus, ThemePair } from "../../api/sections";
import { CATEGORIES, isCategory, type Category } from "../../api/types";
import { BUILT_IN_NAMES } from "./builtInNames";
import type { WidthClass } from "../../lib/useWidthClass";
import { currentLocale, strings } from "../../strings";
import { ICONS, type IconName } from "../../ui/icons";

/** How a section looks: its tint, the colours of its topics, and its icon. */
export interface SectionLook {
  icon: IconName;
  tint: ThemePair;
  topicBg: ThemePair;
  topicIcon: ThemePair;
}

/**
 * The nine the app draws itself, colour for colour (the app's SectionLook.kt,
 * Claude Design's Community §12). A section the backend describes brings its
 * own; one it does not yet describe wears Other's.
 */
export const BUILT_IN_LOOKS: Record<Category, SectionLook> = {
  anime: look("animation", ["#7E4E74", "#64405E"], ["#DFD0DF", "#322533"], ["#7E4E74", "#E7B0DA"]),
  film_tv: look("movie", ["#3E4A6C", "#343D58"], ["#CECFDD", "#1F2431"], ["#3E4A6C", "#B4C3EC"]),
  games: look(
    "sports_esports",
    ["#3D6B58", "#345649"],
    ["#CFD8D8", "#202D2B"],
    ["#3D6B58", "#A0D1BB"],
  ),
  music: look("music_note", ["#62508A", "#4F426F"], ["#D7D1E5", "#292539"], ["#62508A", "#CAB8FA"]),
  books: look("menu_book", ["#7A5B3F", "#614A37"], ["#DED4D2", "#302925"], ["#7A5B3F", "#E0BD9E"]),
  food: look("restaurant", ["#9A5638", "#794732"], ["#E7D3D1", "#3A2824"], ["#9A5638", "#FBAF8F"]),
  sport: look(
    "sports_soccer",
    ["#2F6A76", "#2A5560"],
    ["#CDD7DF", "#1D2D34"],
    ["#2F6A76", "#94D0DD"],
  ),
  people: look("person", ["#76586A", "#5E4857"], ["#DDD3DC", "#2F2830"], ["#76586A", "#DBB9CD"]),
  other: look("category", ["#55566A", "#454656"], ["#D4D2DC", "#262730"], ["#55566A", "#C0C2D9"]),
};

function look(
  icon: IconName,
  tint: [string, string],
  topicBg: [string, string],
  topicIcon: [string, string],
): SectionLook {
  const pair = ([light, dark]: [string, string]) => ({ light, dark });
  return { icon, tint: pair(tint), topicBg: pair(topicBg), topicIcon: pair(topicIcon) };
}

/**
 * The icons a section may wear, in the order the picker shows them (Claude
 * Design, 2.3): the nine's own first. The backend takes no other.
 */
export const SECTION_ICONS = [
  "category",
  "movie",
  "animation",
  "sports_esports",
  "music_note",
  "menu_book",
  "restaurant",
  "sports_soccer",
  "person",
  "pets",
  "flight",
  "directions_car",
  "palette",
  "checkroom",
  "science",
  "computer",
  "local_cafe",
  "park",
  "theater_comedy",
  "mic",
  "photo_camera",
  "sports_basketball",
  "celebration",
  "star",
] as const satisfies readonly IconName[];

export type SectionIcon = (typeof SECTION_ICONS)[number];

export const isSectionIcon = (value: unknown): value is SectionIcon =>
  typeof value === "string" && (SECTION_ICONS as readonly string[]).includes(value);

/** The section every list falls back to, and the one that always comes last. */
export const OTHER = "other";

/** A section as the site draws it: its look, its name in this language, and its numbers. */
export interface Section extends SectionLook {
  id: string;
  name: string;
  /** A picture of somebody's own; the nine have none and draw their hatch. */
  picture: string | null;
  status: SectionStatus;
  builtIn: boolean;
  rank: number | null;
  approvedAt: number;
  listCount: number;
  lists30d: number;
  newThisWeek: number;
  followerCount: number;
  following: boolean;
  collage: string[];
  /** Where a waiting section's lists sit until it is approved. */
  fileUnder: string | null;
  /** Who proposed a waiting one, when the backend says. */
  proposerUid: string | null;
  /** Every name it goes by, in every language: what a search matches. Its own name when left out. */
  names?: readonly string[];
}

const isIcon = (value: unknown): value is IconName =>
  typeof value === "string" && (ICONS as readonly string[]).includes(value);

/** One of the nine, as it is before anything is counted. */
export function builtInSection(id: Category): Section {
  return {
    id,
    name: strings.category[id],
    names: BUILT_IN_NAMES[id],
    ...BUILT_IN_LOOKS[id],
    picture: null,
    status: "approved",
    builtIn: true,
    rank: null,
    approvedAt: 0,
    listCount: 0,
    lists30d: 0,
    newThisWeek: 0,
    followerCount: 0,
    following: false,
    collage: [],
    fileUnder: null,
    proposerUid: null,
  };
}

/**
 * A section from what the backend says of it. Its name is the translation for
 * this language, then its own; the nine keep the site's words until the
 * backend has its own for them.
 */
export function sectionOf(stats: SectionStats, locale: string = currentLocale()): Section {
  const base = isCategory(stats.id) ? builtInSection(stats.id) : builtInSection(OTHER);
  const named = stats.names?.[locale] ?? stats.name;
  return {
    ...base,
    id: stats.id,
    names: [
      ...(isCategory(stats.id) ? BUILT_IN_NAMES[stats.id] : []),
      ...(stats.name === undefined ? [] : [stats.name]),
      ...Object.values(stats.names ?? {}).filter((one): one is string => one !== undefined),
    ],
    name:
      named !== undefined && named.trim() !== ""
        ? named
        : isCategory(stats.id)
          ? base.name
          : stats.id,
    icon: isIcon(stats.icon) ? stats.icon : base.icon,
    tint: stats.tint ?? base.tint,
    topicBg: stats.topicBg ?? base.topicBg,
    topicIcon: stats.topicIcon ?? base.topicIcon,
    picture:
      typeof stats.pictureUrl === "string" && stats.pictureUrl.startsWith("https://")
        ? stats.pictureUrl
        : null,
    status: stats.status ?? "approved",
    builtIn: stats.builtIn ?? isCategory(stats.id),
    rank: stats.rank ?? null,
    approvedAt: stats.approvedAt ?? 0,
    listCount: stats.listCount,
    lists30d: stats.lists30d ?? 0,
    newThisWeek: stats.newThisWeek,
    followerCount: stats.followerCount,
    following: stats.following,
    collage: stats.collage.filter((url) => url.startsWith("https://")),
    fileUnder: stats.fileUnder ?? null,
    proposerUid: stats.proposerUid ?? null,
  };
}

/**
 * Every section worth showing to this person: what the backend sent, or the
 * nine when it has not answered. Hidden, merged and declined ones are left
 * out, and so is a waiting one somebody else proposed: a moderator is sent
 * them all, but sees them in the admin page, not among the tiles.
 */
export function sectionsFrom(
  answer: readonly SectionStats[] | null,
  who: string | null = null,
): Section[] {
  if (answer === null) return CATEGORIES.map(builtInSection);
  return answer
    .filter(
      (stats) =>
        stats.hidden !== true &&
        stats.status !== "merged" &&
        stats.status !== "declined" &&
        (stats.status !== "pending" || (who !== null && stats.proposerUid === who)),
    )
    .map((stats) => sectionOf(stats));
}

/** The sections everybody sees: approved ones, without anybody's waiting proposal. */
export const approvedOnly = (sections: readonly Section[]): Section[] =>
  sections.filter((section) => section.status === "approved");

/**
 * The name of whatever section a list or a board is filed under: the one the
 * backend sent, in this language; one of the nine by the site's own words;
 * and an id nobody here knows yet (hidden, or approved since the sections
 * were read) as Other, the way the app draws it (docs/sections-api.md, 6).
 */
export function sectionName(id: string, sections: readonly Section[]): string {
  const known = sections.find((section) => section.id === id);
  if (known !== undefined) return known.name;
  return isCategory(id) ? strings.category[id] : sectionName(OTHER, sections);
}

/**
 * The order the app draws sections in, so a follow made here moves its tile
 * at once: followed first, then the ones pinned by a moderator, then the
 * busiest of the last thirty days, then the earlier approved, the nine
 * keeping their own order among themselves. Other always comes last.
 */
export function orderSections(sections: readonly Section[]): Section[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => compareSections(a.section, b.section) || a.index - b.index)
    .map(({ section }) => section);
}

function compareSections(a: Section, b: Section): number {
  if ((a.id === OTHER) !== (b.id === OTHER)) return a.id === OTHER ? 1 : -1;
  if (a.following !== b.following) return a.following ? -1 : 1;
  if ((a.rank === null) !== (b.rank === null)) return a.rank === null ? 1 : -1;
  if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
  if (a.lists30d !== b.lists30d) return b.lists30d - a.lists30d;
  return a.approvedAt - b.approvedAt;
}

/** How many sections the front page has room for at each width (Claude Design). */
/** How many sections the front page shows before the way to all of them, as the app does. */
export const HOME_TOP = 20;

export interface HomeSlots {
  /** The tiles of the grid, in order. */
  tiles: Section[];
  /** On a phone, the full-width row under the grid: a section, or the way to all of them. */
  row: Section | "all" | null;
  /** Elsewhere, the last tile leads to all of them. */
  allTile: boolean;
}

/**
 * What the front page shows of the sections: the first twenty, and past them
 * the way to the page with every section. A phone lays tiles two by two, so an
 * odd one out takes the full-width row, and so does the way to all of them.
 */
export function homeSlots(ordered: readonly Section[], width: WidthClass): HomeSlots {
  if (ordered.length > HOME_TOP) {
    const tiles = ordered.slice(0, HOME_TOP);
    return width === "compact"
      ? { tiles, row: "all", allTile: false }
      : { tiles, row: null, allTile: true };
  }
  if (width === "compact" && ordered.length % 2 === 1) {
    return {
      tiles: ordered.slice(0, -1),
      row: ordered[ordered.length - 1] ?? null,
      allTile: false,
    };
  }
  return { tiles: [...ordered], row: null, allTile: false };
}

export const sectionPath = (id: string): string => `/s/${encodeURIComponent(id)}`;

export const topicPath = (section: string, topic: string): string =>
  `${sectionPath(section)}/t/${encodeURIComponent(topic)}`;

export const ALL_SECTIONS_PATH = "/s";

/** All sections with one's own waiting proposal opened, as its tile opens it. */
export const waitingPath = (id: string): string =>
  `${ALL_SECTIONS_PATH}?waiting=${encodeURIComponent(id)}`;

/** The widths the site's own address makes a picture at: a tile, and a section's header. */
export type PictureWidth = 480 | 1600;

const STORED_PICTURE =
  /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/(sections|topics)%2F([A-Za-z0-9_-]{1,64})%2F([A-Za-z0-9_-]{1,64})(?:\?|$)/;

/**
 * A section's or topic's stored picture through the site's own address, which
 * Hosting's CDN keeps near the visitor at the width the page draws it
 * (functions/src/pictures.ts): Storage itself took up to a second for each and
 * was never kept. Any other address is drawn as it is.
 */
export function servedPicture(url: string, width: PictureWidth = 480): string {
  const stored = STORED_PICTURE.exec(url);
  return stored === null ? url : `/img/${width}/${stored[1]}/${stored[2]}/${stored[3]}`;
}

/** The tile's own colours, light and dark, and its picture when it has one, at the width drawn. */
export function sectionStyle(section: Section, width: PictureWidth = 480): CSSProperties {
  const picture = section.picture === null ? null : servedPicture(section.picture, width);
  return {
    "--tint-light": section.tint.light,
    "--tint-dark": section.tint.dark,
    ...(picture === null ? {} : { "--section-picture": `url("${picture.replace(/"/g, "%22")}")` }),
  } as CSSProperties;
}

/**
 * A topic's own picture, when it has one the page may draw: an https address,
 * as a section's picture must be. Without one it wears its section's colours.
 */
export const topicPicture = (topic: { pictureUrl?: string | null }): string | null =>
  typeof topic.pictureUrl === "string" && topic.pictureUrl.startsWith("https://")
    ? topic.pictureUrl
    : null;

/** A topic wears its section's topic colours. */
export function topicStyle(section: Section | undefined): CSSProperties | undefined {
  return section === undefined
    ? undefined
    : ({
        "--topic-bg-light": section.topicBg.light,
        "--topic-bg-dark": section.topicBg.dark,
        "--topic-icon-light": section.topicIcon.light,
        "--topic-icon-dark": section.topicIcon.dark,
      } as CSSProperties);
}

export const FOLLOWING_PATH = "/following";

export const MANAGE_PATH = "/following/manage";

/** Between words: anything that is not a letter or a digit. */
const BETWEEN_WORDS = /[^\p{L}\p{N}]+/u;

/**
 * Text as a search compares it, the way the backend folds it (proxy #56):
 * lower case, no accents, ё as е.
 */
export const fold = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const wordsOf = (text: string): string[] => fold(text).split(BETWEEN_WORDS).filter(Boolean);

/** Whether every word typed starts a word of the name, in any order: "wars" finds Star Wars. */
export function namedLike(query: string, name: string): boolean {
  const asked = wordsOf(query);
  const words = wordsOf(name);
  return asked.length > 0 && asked.every((one) => words.some((word) => word.startsWith(one)));
}

/** The approved sections a search names, by any of their names in any language. */
export const sectionsNamed = (sections: readonly Section[], query: string): Section[] =>
  approvedOnly(sections).filter((section) =>
    (section.names ?? [section.name]).concat(section.name).some((name) => namedLike(query, name)),
  );
