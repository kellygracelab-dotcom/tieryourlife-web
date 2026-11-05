/**
 * What a link to a list or a ranking looks like in a chat. Pure: web.ts
 * fetches the page shell and the documents, this decides the words.
 */

import { AS_WRITTEN, say, wordsFor } from "./previewWords";

export const SITE_NAME = "TierYourLife";

export const CATEGORY_LABELS: Record<string, string> = {
  anime: "Anime",
  film_tv: "Film & TV",
  games: "Games",
  music: "Music",
  books: "Books",
  food: "Food",
  sport: "Sport",
  people: "People",
  other: "Other",
};

export interface PageMeta {
  title: string;
  description: string;
  image: string | null;
  /** Set when the image is the site's own card, so a chat lays it out before fetching it. */
  imageSize?: { width: number; height: number };
  url: string;
  /** The language the words are in, as OpenGraph names it (`ru_RU`). */
  locale?: string;
}

/**
 * One of the first nine sections' English names, or null for one approved
 * after them: calling a section "Other" when it is not is worse than not
 * naming it. A section's own document names it better (sectionLabelOf).
 */
export const categoryLabel = (category: unknown): string | null =>
  (typeof category === "string" && CATEGORY_LABELS[category]) || null;

/** What a section's document says of its name: as the proxy keeps it in `sections/{id}`. */
export interface SectionNames {
  name?: unknown;
  names?: unknown;
}

const nameOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/**
 * A section's name in [locale], from its document when it could be read:
 * its translation, else its own name; else one of the first nine's; else
 * none, rather than a wrong one.
 */
export function sectionLabelOf(
  category: unknown,
  section: SectionNames | null,
  locale = "en",
): string | null {
  const names = section?.names;
  const translated =
    locale !== "en" && names !== null && typeof names === "object"
      ? nameOf((names as Record<string, unknown>)[locale])
      : null;
  return translated ?? nameOf(section?.name) ?? categoryLabel(category);
}

/** " · Film & TV" after a line, or nothing for a section without a name. */
const inSection = (label: string | null): string => (label === null ? "" : ` · ${label}`);

const plural = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

/**
 * An editorial list stands without an author: it is a list to rank, and says
 * how long it is, in [locale] (a house list's reader's). `section` is the
 * section's name as read; left out, the first nine's are known.
 */
export function describeList(list: {
  itemCount: number;
  authorName: string;
  category: unknown;
  editorial?: boolean;
  section?: string | null;
  locale?: string;
}): string {
  const section = inSection(
    list.section === undefined ? categoryLabel(list.category) : list.section,
  );
  if (list.editorial === true) {
    const locale = list.locale ?? AS_WRITTEN;
    return `${say(locale, wordsFor(locale).toRank, list.itemCount)}${section}`;
  }
  const items = plural(list.itemCount, "item", "items");
  const author = list.authorName.trim() || "someone";
  return `${items} ranked by ${author}${section}`;
}

export function describeRanking(ranking: {
  placed: number;
  itemCount: number;
  authorName: string;
  category: unknown;
  editorial?: boolean;
  section?: string | null;
  locale?: string;
}): string {
  const section = inSection(
    ranking.section === undefined ? categoryLabel(ranking.category) : ranking.section,
  );
  if (ranking.editorial === true) {
    const locale = ranking.locale ?? AS_WRITTEN;
    const ranked = say(locale, wordsFor(locale).visitorRanked, ranking.itemCount, {
      placed: ranking.placed,
    });
    return `${ranked}${section}`;
  }
  const ranked = `A visitor ranked ${ranking.placed} of ${plural(ranking.itemCount, "item", "items")}`;
  const author = ranking.authorName.trim() || "someone";
  return `${ranked} on ${author}’s list${section}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON that is safe inside a <script>: no way to close the tag from within. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const meta = (attr: string, name: string, content: string): string =>
  `<meta ${attr}="${name}" content="${escapeHtml(content)}" />`;

export const PRELOAD_ID = "tyl-preload";

/**
 * The page shell with a title, a description and OpenGraph tags for this one
 * page, and the data it will draw tucked in as JSON so the board can appear
 * before any token has been fetched.
 */
export function renderPage(shell: string, page: PageMeta, preload: unknown): string {
  const title = `${page.title} · ${SITE_NAME}`;
  const head = [
    meta("property", "og:title", page.title),
    meta("property", "og:description", page.description),
    meta("property", "og:type", "article"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:url", page.url),
    page.locale === undefined ? "" : meta("property", "og:locale", page.locale),
    page.image === null ? "" : meta("property", "og:image", page.image),
    // The card shows the list's title; a reader who cannot see it is told that much.
    page.image === null ? "" : meta("property", "og:image:alt", page.title),
    page.image === null || page.imageSize === undefined
      ? ""
      : meta("property", "og:image:width", String(page.imageSize.width)),
    page.image === null || page.imageSize === undefined
      ? ""
      : meta("property", "og:image:height", String(page.imageSize.height)),
    meta("name", "twitter:card", page.image === null ? "summary" : "summary_large_image"),
    `<script id="${PRELOAD_ID}" type="application/json">${scriptJson(preload)}</script>`,
  ]
    .filter((line) => line.length > 0)
    .join("\n    ");

  // Replacers, not replacement strings: in a string "$&" or "$'" from a title
  // would pull pieces of the shell into the page.
  return shell
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, () =>
      meta("name", "description", page.description),
    )
    .replace("</head>", () => `    ${head}\n  </head>`);
}
