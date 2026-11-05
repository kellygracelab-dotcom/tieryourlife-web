/**
 * What a link to a list or a ranking looks like in a chat. Pure: web.ts
 * fetches the page shell and the documents, this decides the words.
 */

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
}

/**
 * A section's name, or null for one approved after these nine: the function
 * knows no other names, and calling a section "Other" when it is not is
 * worse than not naming it.
 */
export const categoryLabel = (category: unknown): string | null =>
  (typeof category === "string" && CATEGORY_LABELS[category]) || null;

/** " · Film & TV" after a line, or nothing for a section without a name here. */
const inSection = (category: unknown): string => {
  const label = categoryLabel(category);
  return label === null ? "" : ` · ${label}`;
};

const plural = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

/** An editorial list stands without an author: it is a list to rank, and says how long it is. */
export function describeList(list: {
  itemCount: number;
  authorName: string;
  category: unknown;
  editorial?: boolean;
}): string {
  const items = plural(list.itemCount, "item", "items");
  if (list.editorial === true) return `${items} to rank${inSection(list.category)}`;
  const author = list.authorName.trim() || "someone";
  return `${items} ranked by ${author}${inSection(list.category)}`;
}

export function describeRanking(ranking: {
  placed: number;
  itemCount: number;
  authorName: string;
  category: unknown;
  editorial?: boolean;
}): string {
  const ranked = `A visitor ranked ${ranking.placed} of ${plural(ranking.itemCount, "item", "items")}`;
  if (ranking.editorial === true) return `${ranked}${inSection(ranking.category)}`;
  const author = ranking.authorName.trim() || "someone";
  return `${ranked} on ${author}’s list${inSection(ranking.category)}`;
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
    page.image === null ? "" : meta("property", "og:image", page.image),
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
