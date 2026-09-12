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
  url: string;
}

export const categoryLabel = (category: unknown): string =>
  (typeof category === "string" && CATEGORY_LABELS[category]) || CATEGORY_LABELS.other!;

const plural = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

export function describeList(list: {
  itemCount: number;
  authorName: string;
  category: unknown;
}): string {
  const author = list.authorName.trim() || "someone";
  return `${plural(list.itemCount, "item", "items")} ranked by ${author} · ${categoryLabel(list.category)}`;
}

export function describeRanking(ranking: {
  placed: number;
  itemCount: number;
  authorName: string;
  category: unknown;
}): string {
  const author = ranking.authorName.trim() || "someone";
  return `A visitor ranked ${ranking.placed} of ${plural(ranking.itemCount, "item", "items")} on ${author}’s list · ${categoryLabel(ranking.category)}`;
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
    meta("name", "twitter:card", page.image === null ? "summary" : "summary_large_image"),
    `<script id="${PRELOAD_ID}" type="application/json">${scriptJson(preload)}</script>`,
  ]
    .filter((line) => line.length > 0)
    .join("\n    ");

  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      meta("name", "description", page.description),
    )
    .replace("</head>", `    ${head}\n  </head>`);
}
