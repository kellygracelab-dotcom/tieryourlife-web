/**
 * The picture a chat shows for a link: a 1200×630 card with the list's title,
 * its author and its tiers, drawn with the pictures the list already has.
 * Pure: shareImage.ts fetches the pictures and turns the tree into pixels.
 */

import { SITE_LOGO_SRC } from "./siteLogo";
import { categoryLabel, SITE_NAME } from "./og";
import { AS_WRITTEN, say, wordsFor } from "./previewWords";

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;

/** Tiers drawn on a ranking card; the rest are counted. */
export const SHARE_TIERS = 5;
/** Pictures per tier row on a ranking card. */
export const ROW_TILES = 9;
/** Pictures on a list card, in two rows of five. */
export const LIST_TILES = 10;
/** Pictures fetched for one card, at most. */
export const SHARE_PICTURES = 24;

const PAPER = "#e9e7e2";

/** B's old light colour is drawn as the new gold, as the site and the app draw it (artboard 54, 18.11.2026). */
const shownLight = (hex: string): string =>
  hex.trim().toLowerCase() === "#a98b1f" ? "#B88A00" : hex;
const SURFACE = "#ffffff";
const INK = "#1a1a1a";
const INK_DIM = "#5d5c66";
const INK_FAINT = "#8a8a99";
const POOL = "#dad7e0";
const FONT = "Roboto";

export interface ShareTier {
  label: string;
  caption: string | null;
  colorLight: string;
  /** The tier's colour on a dark page, as the list keeps it; a person's list's card is dark. */
  colorDark?: string;
}

export interface ShareItem {
  title: string;
  imageUrl: string | null;
  /** The author's tier for the card on a published list; null or absent, unplaced. */
  tierIndex?: number | null;
}

export interface ShareList {
  kind: "list";
  title: string;
  /** An editorial list names nobody on its card. */
  editorial?: boolean;
  authorName: string;
  category: string;
  itemCount: number;
  tiers: ShareTier[];
  items: ShareItem[];
  /** The section's name as read; left out, only the first nine's are known. */
  section?: string | null;
  /** The language of a house list's card, its words translated already; as written by default. */
  locale?: string;
}

export interface ShareRanking {
  kind: "ranking";
  title: string;
  editorial?: boolean;
  authorName: string;
  category: string;
  tiers: ShareTier[];
  items: ShareItem[];
  /** Item indexes per tier, in order. */
  rows: number[][];
  locale?: string;
}

export type ShareCard = ShareList | ShareRanking;

/** What the renderer resolves before drawing: an address to a data URI, or nothing. */
export type Pictures = ReadonlyMap<string, string>;

/** A satori element: a tag, its style and children. */
export interface Node {
  type: string;
  props: {
    style?: Record<string, string | number>;
    src?: string;
    children?: Node | string | (Node | string)[];
  };
}

const el = (
  type: string,
  style: Record<string, string | number>,
  children?: Node | string | (Node | string)[],
  extra: Record<string, string> = {},
): Node => ({ type, props: { style, ...extra, ...(children === undefined ? {} : { children }) } });

/** The addresses a card will need, in drawing order, capped. */
export function picturesWanted(card: ShareCard): string[] {
  const wanted: string[] = [];
  const take = (item: ShareItem | undefined) => {
    if (item?.imageUrl && !wanted.includes(item.imageUrl) && wanted.length < SHARE_PICTURES) {
      wanted.push(item.imageUrl);
    }
  };
  const top = card.kind === "list" ? authorTop(card) : null;
  if (top !== null) {
    // Only the top row's cells are drawn with pictures: seven at most.
    topCells(top.row.items).shown.forEach((index) => take(card.items[index]));
  } else if (card.kind === "list") {
    card.items
      .filter((item) => item.imageUrl !== null)
      .slice(0, LIST_TILES)
      .forEach(take);
  } else {
    for (const row of card.rows.slice(0, SHARE_TIERS)) {
      row.slice(0, ROW_TILES).forEach((index) => take(card.items[index]));
    }
  }
  return wanted;
}

/** The catalogue's smaller size is plenty for a tile; a full poster is slow to fetch. */
export const tileSizeOf = (url: string): string => url.replace("/t/p/w500/", "/t/p/w185/");

const tile = (item: ShareItem, pictures: Pictures, width: number, height: number): Node => {
  const src = item.imageUrl === null ? undefined : pictures.get(item.imageUrl);
  if (src !== undefined) {
    return el("img", { width, height, borderRadius: 6, objectFit: "cover" }, undefined, { src });
  }
  return el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width,
      height,
      padding: 4,
      borderRadius: 6,
      background: POOL,
      color: INK_DIM,
      overflow: "hidden",
    },
    el(
      "div",
      {
        display: "block",
        fontSize: Math.round(height / 6.5),
        lineHeight: 1.2,
        textAlign: "center",
        // One long word is wider than a tile and used to lose its last letters.
        wordBreak: "break-word",
        lineClamp: height > 100 ? 4 : 3,
      },
      item.title.slice(0, 40),
    ),
  );
};

/** Roboto's letters are some 0.6 of the size wide: with nothing here to measure, a guess that errs wide. */
const widthOf = (text: string, size: number): number => Array.from(text).length * size * 0.6;

const wordsOf = (text: string): string[] => text.split(/\s+/).filter((part) => part.length > 0);

/** How many lines the text takes at a size, broken between words only. */
function lineCount(text: string, room: number, size: number): number {
  let lines = 0;
  let line = "";
  for (const word of wordsOf(text)) {
    const longer = line.length === 0 ? word : `${line} ${word}`;
    if (line.length > 0 && widthOf(longer, size) > room) {
      lines++;
      line = word;
    } else {
      line = longer;
    }
  }
  return lines + (line.length > 0 ? 1 : 0);
}

/** The smallest a band's name goes; the name's line; a caption's type, at most two lines. */
export const BAND_FLOOR = 9;
const LABEL_LINE = 1.1;
const CAPTION = { size: 9, line: 11, lines: 2, gap: 2 } as const;

/**
 * A tier's name on its square, as the site's board sets it: the largest
 * size, from the letter's own down to the floor, at which every word fits
 * the square whole and the lines fit above the caption; and how many lines
 * the square holds at that size. Only a name too long even at the floor
 * ends in an ellipsis.
 */
export function bandLabel(
  label: string,
  caption: string | null,
  size: number,
): { size: number; lines: number } {
  const room = size - 8;
  const captionLines =
    caption === null ? 0 : Math.min(CAPTION.lines, lineCount(caption, room, CAPTION.size));
  const height = room - (captionLines === 0 ? 0 : captionLines * CAPTION.line + CAPTION.gap);
  const most = (at: number) => Math.max(1, Math.floor(height / (at * LABEL_LINE)));
  for (let at = Math.round(size * 0.44); at > BAND_FLOOR; at--) {
    if (wordsOf(label).some((word) => widthOf(word, at) > room)) continue;
    if (lineCount(label, room, at) <= most(at)) return { size: at, lines: most(at) };
  }
  return { size: BAND_FLOOR, lines: most(BAND_FLOOR) };
}

const band = (tier: ShareTier, size: number): Node => {
  const caption = tier.caption?.trim() ? tier.caption.trim() : null;
  const fit = bandLabel(tier.label, caption, size);
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      padding: 4,
      borderRadius: 10,
      background: shownLight(tier.colorLight),
      color: SURFACE,
      flexShrink: 0,
      overflow: "hidden",
    },
    [
      el(
        "div",
        {
          display: "block",
          maxWidth: "100%",
          fontSize: fit.size,
          fontWeight: 500,
          lineHeight: LABEL_LINE,
          textAlign: "center",
          // Only a word wider than the square even at the floor is broken.
          wordBreak: "break-word",
          lineClamp: fit.lines,
        },
        tier.label,
      ),
      ...(caption !== null
        ? [
            el(
              "div",
              {
                display: "block",
                maxWidth: "100%",
                fontSize: CAPTION.size,
                lineHeight: `${CAPTION.line}px`,
                marginTop: CAPTION.gap,
                opacity: 0.85,
                textAlign: "center",
                wordBreak: "break-word",
                lineClamp: CAPTION.lines,
              },
              caption,
            ),
          ]
        : []),
    ],
  );
};

/**
 * The line under the title, with the author's name laid out on its own. In
 * one run of text an Arabic or Hebrew name pulled the English beside it into
 * its direction: the card read "’احمدs list".
 */
interface Byline {
  before: string;
  name: string | null;
  after: string;
}

const heading = (card: ShareCard, line: Byline): Node =>
  el("div", { display: "flex", flexDirection: "column", gap: 8 }, [
    el(
      "div",
      { fontSize: 44, fontWeight: 500, lineHeight: 1.15, color: INK, lineClamp: 2 },
      card.title.trim() || wordsFor(card.locale ?? AS_WRITTEN).untitled,
    ),
    line.name === null
      ? el("div", { fontSize: 22, color: INK_DIM, lineClamp: 1 }, line.before + line.after)
      : el(
          "div",
          {
            display: "flex",
            alignItems: "baseline",
            fontSize: 22,
            color: INK_DIM,
            whiteSpace: "pre",
          },
          [
            ...(line.before === "" ? [] : [line.before]),
            el(
              "div",
              { flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              line.name,
            ),
            ...(line.after === "" ? [] : [line.after]),
          ],
        ),
  ]);

/** The site's own icon (public/favicon.svg) at the size of a line of text. */
const mark = (size: number): Node =>
  el("img", { width: size, height: size, flexShrink: 0 }, undefined, { src: SITE_LOGO_SRC });

const brand = (): Node =>
  el("div", { display: "flex", alignItems: "center", gap: 10, color: INK_FAINT, fontSize: 18 }, [
    mark(28),
    SITE_NAME,
  ]);

const frame = (children: (Node | string)[]): Node =>
  el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      // Satori adds padding outside the box by default: the card came out
      // 1296×710 and was cut to 1200×630, footer and all.
      boxSizing: "border-box",
      width: SHARE_WIDTH,
      height: SHARE_HEIGHT,
      padding: "44px 48px 36px",
      background: PAPER,
      fontFamily: FONT,
    },
    children,
  );

function listCard(card: ShareList, pictures: Pictures): Node {
  const author = card.authorName.trim() || "someone";
  const locale = card.locale ?? AS_WRITTEN;
  const section = card.section === undefined ? categoryLabel(card.category) : card.section;
  // No count of rankings: the card is kept until the list changes, and a
  // count drawn on its first day said "0 rankings" for good.
  const rest = [say(locale, wordsFor(locale).cards, card.itemCount), section]
    .filter((part) => part !== null)
    .join(" · ");
  const line: Byline =
    card.editorial === true
      ? { before: rest, name: null, after: "" }
      : { before: "by ", name: author, after: ` · ${rest}` };
  const shown = card.items.filter((item) => item.imageUrl !== null).slice(0, LIST_TILES);
  const tiles = (shown.length > 0 ? shown : card.items.slice(0, LIST_TILES)).map((item) =>
    tile(item, pictures, 96, 140),
  );
  return frame([
    heading(card, line),
    el("div", { display: "flex", alignItems: "flex-start", gap: 48 }, [
      el(
        "div",
        { display: "flex", flexDirection: "column", gap: 8 },
        card.tiers.slice(0, SHARE_TIERS).map((tier) => band(tier, 56)),
      ),
      el("div", { display: "flex", flexWrap: "wrap", gap: 10, width: 5 * 96 + 4 * 10 }, tiles),
    ]),
    // At the bottom right, where the ranking card has it.
    el("div", { display: "flex", justifyContent: "flex-end" }, brand()),
  ]);
}

/*
 * A person's list (Designer, 23.11.2026): the author's own top row on the
 * app's dark page, so the picture reads as their ranking, not a list to rank.
 */

/** Cells in a person's top row; past it, the last cell counts the rest. */
export const TOP_TILES = 7;

/** The site's address, as pages.ts names it; written here so the card needs no page code. */
const SITE_ADDRESS = "tieryourlife.com";
const NIGHT = "#12151c";
const NIGHT_PANEL = "#1b1f29";
const NIGHT_CELL = "#2a2f3b";
const NIGHT_INK = "#f4f5f8";
const NIGHT_DIM = "#a3a8b5";
const PILL = "#a8c7fa";
const PILL_INK = "#0b1d3a";
const TOP = { width: 134, height: 188, gap: 8, pad: 12, label: 92 } as const;
const STRIP = { height: 56, label: 92 } as const;

/** One of the author's tiers with the positions of its cards, in the list's order. */
export interface AuthorRow {
  tier: number;
  items: number[];
}

/**
 * The author's top row, the first ranked tier with cards (S, unless S is
 * empty), and the next tier with cards after it; null when the list places
 * nothing, as one published before arrangements travelled.
 */
export function authorTop(card: ShareList): { row: AuthorRow; next: AuthorRow | null } | null {
  if (card.editorial === true) return null;
  const rows: number[][] = card.tiers.map(() => []);
  card.items.forEach((item, position) => {
    const index = item.tierIndex;
    if (typeof index === "number") rows[index]?.push(position);
  });
  const filled = rows.map((items, tier) => ({ tier, items })).filter((row) => row.items.length > 0);
  const [row, next] = filled;
  return row === undefined ? null : { row, next: next ?? null };
}

/** The cells drawn: every card when they fit, else one fewer and a cell for the rest. */
export function topCells(row: readonly number[]): { shown: number[]; more: number } {
  if (row.length <= TOP_TILES) return { shown: [...row], more: 0 };
  return { shown: row.slice(0, TOP_TILES - 1), more: row.length - (TOP_TILES - 1) };
}

/**
 * What the count says the cards are, by section, in English: a person's list
 * is drawn as written. A section with no clear noun says "cards".
 */
const NOUNS: Record<string, readonly [string, string]> = {
  games: ["game", "games"],
  "video games": ["game", "games"],
  "board games": ["game", "games"],
  film_tv: ["film or show", "films & shows"],
  films: ["film", "films"],
  movies: ["film", "films"],
  shows: ["show", "shows"],
  "tv shows": ["show", "shows"],
  series: ["series", "series"],
  anime: ["anime", "anime"],
  manga: ["manga", "manga"],
  books: ["book", "books"],
  albums: ["album", "albums"],
  songs: ["song", "songs"],
  artists: ["artist", "artists"],
  people: ["person", "people"],
  cars: ["car", "cars"],
  countries: ["country", "countries"],
  cities: ["city", "cities"],
  animals: ["animal", "animals"],
};

/** "149 games", "1 book", "12 cards": the count with the section's own noun. */
export function rankedCount(category: string, section: string | null | undefined, n: number) {
  const noun = NOUNS[category] ?? NOUNS[(section ?? "").trim().toLowerCase()] ?? ["card", "cards"];
  return `${new Intl.NumberFormat("en").format(n)} ${n === 1 ? noun[0] : noun[1]}`;
}

/** The colour a tier is drawn in on the dark card: its dark one, else its light one. */
const nightColour = (tier: ShareTier): string =>
  typeof tier.colorDark === "string" && /^#[0-9a-f]{6}$/i.test(tier.colorDark.trim())
    ? tier.colorDark.trim()
    : shownLight(tier.colorLight);

/** Dark letters on a light tier colour, light ones on a dark colour (a list's own or a light fallback). */
function inkOn(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (match === null) return NIGHT;
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? NIGHT : NIGHT_INK;
}

/** The largest size, down to the floor, at which a tier's name fits its cell whole. */
export function cellLabel(label: string, width: number, height: number, most: number) {
  const room = width - 12;
  for (let at = most; at > BAND_FLOOR; at--) {
    // widthOf errs wide enough for the bold letters as well.
    if (wordsOf(label).some((word) => widthOf(word, at) > room)) continue;
    const lines = lineCount(label, room, at);
    if (lines * at * LABEL_LINE <= height - 8) return { size: at, lines };
  }
  return { size: BAND_FLOOR, lines: Math.max(1, Math.floor((height - 8) / (BAND_FLOOR * 1.1))) };
}

const tierCell = (tier: ShareTier, width: number, height: number, most: number): Node => {
  const colour = nightColour(tier);
  const fit = cellLabel(tier.label, width, height, most);
  return el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      width,
      height,
      padding: 6,
      flexShrink: 0,
      background: colour,
      color: inkOn(colour),
      overflow: "hidden",
    },
    el(
      "div",
      {
        display: "block",
        maxWidth: "100%",
        fontSize: fit.size,
        fontWeight: 700,
        lineHeight: LABEL_LINE,
        textAlign: "center",
        wordBreak: "break-word",
        lineClamp: fit.lines,
      },
      tier.label,
    ),
  );
};

const topTile = (item: ShareItem, pictures: Pictures): Node => {
  const { width, height } = TOP;
  const src = item.imageUrl === null ? undefined : pictures.get(item.imageUrl);
  if (src !== undefined) {
    return el("img", { width, height, borderRadius: 8, objectFit: "cover" }, undefined, { src });
  }
  // No picture, or none in time: the card's name on a dark cell, as a tile without one.
  return el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      width,
      height,
      padding: 10,
      borderRadius: 8,
      background: NIGHT_CELL,
      color: NIGHT_INK,
      overflow: "hidden",
      flexShrink: 0,
    },
    el(
      "div",
      {
        display: "block",
        fontSize: 18,
        lineHeight: 1.25,
        textAlign: "center",
        wordBreak: "break-word",
        lineClamp: 6,
      },
      item.title.trim().slice(0, 60),
    ),
  );
};

const moreTile = (more: number): Node =>
  el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: TOP.width,
      height: TOP.height,
      borderRadius: 8,
      background: NIGHT_CELL,
      color: NIGHT_INK,
      fontSize: 34,
      fontWeight: 700,
      flexShrink: 0,
    },
    `+${new Intl.NumberFormat("en").format(more)}`,
  );

/** «A, B, C, D — open the list to see all 176»: the next tier's first names, or the invitation alone. */
export function stripText(
  card: ShareList,
  next: AuthorRow | null,
): { names: string; rest: string } {
  const all = `open the list to see all ${new Intl.NumberFormat("en").format(card.itemCount)}`;
  const names = (next?.items ?? [])
    .map((index) => card.items[index]?.title.trim() ?? "")
    .filter((title) => title.length > 0)
    .slice(0, 4)
    .join(", ");
  return names === "" ? { names: "", rest: all } : { names, rest: ` — ${all}` };
}

/** «My S tier. What's yours?», with the label of the row shown. */
export const pillText = (tier: ShareTier): string => {
  const label = tier.label.trim();
  const short = label.length > 24 ? `${label.slice(0, 23)}…` : label;
  return `My ${short} tier. What’s yours?`;
};

function authorCard(
  card: ShareList,
  top: { row: AuthorRow; next: AuthorRow | null },
  pictures: Pictures,
): Node {
  const author = card.authorName.trim() || "someone";
  const tier = card.tiers[top.row.tier] as ShareTier;
  const placed = card.items.filter(
    (item) => typeof item.tierIndex === "number" && card.tiers[item.tierIndex] !== undefined,
  ).length;
  const { shown, more } = topCells(top.row.items);
  const nextTier = top.next === null ? undefined : card.tiers[top.next.tier];
  const strip = stripText(card, top.next);
  const panelHeight = TOP.height + 2 * TOP.pad;

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      width: SHARE_WIDTH,
      height: SHARE_HEIGHT,
      padding: "40px 52px 30px",
      backgroundColor: NIGHT,
      // A soft light in the top right corner.
      backgroundImage:
        "radial-gradient(circle at 100% 0%, rgba(150, 170, 220, 0.2) 0%, rgba(18, 21, 28, 0) 55%)",
      fontFamily: FONT,
      color: NIGHT_INK,
    },
    [
      el(
        "div",
        { fontSize: 46, fontWeight: 800, lineHeight: 1.15, color: NIGHT_INK, lineClamp: 2 },
        card.title.trim() || wordsFor(AS_WRITTEN).untitled,
      ),
      el(
        "div",
        {
          display: "flex",
          alignItems: "baseline",
          marginTop: 10,
          fontSize: 24,
          color: NIGHT_DIM,
          whiteSpace: "pre",
        },
        [
          "by ",
          el(
            "div",
            {
              flexShrink: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 700,
              color: NIGHT_INK,
            },
            author,
          ),
          ` · ${rankedCount(card.category, card.section, placed)} ranked`,
        ],
      ),
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          marginTop: 30,
          height: panelHeight,
          borderRadius: 14,
          background: NIGHT_PANEL,
          overflow: "hidden",
        },
        [
          tierCell(tier, TOP.label, panelHeight, 64),
          el("div", { display: "flex", gap: TOP.gap, paddingLeft: 10 }, [
            ...shown.flatMap((index) => {
              const item = card.items[index];
              return item === undefined ? [] : [topTile(item, pictures)];
            }),
            ...(more > 0 ? [moreTile(more)] : []),
          ]),
        ],
      ),
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          marginTop: 10,
          height: STRIP.height,
          borderRadius: 12,
          background: NIGHT_PANEL,
          overflow: "hidden",
        },
        [
          ...(nextTier === undefined ? [] : [tierCell(nextTier, STRIP.label, STRIP.height, 30)]),
          el(
            "div",
            {
              display: "flex",
              flexGrow: 1,
              minWidth: 0,
              paddingLeft: 18,
              paddingRight: 18,
              fontSize: 21,
              fontWeight: 500,
              color: NIGHT_DIM,
              whiteSpace: "pre",
            },
            [
              ...(strip.names === ""
                ? []
                : [
                    el(
                      "div",
                      {
                        flexShrink: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      },
                      strip.names,
                    ),
                  ]),
              el("div", { flexShrink: 0 }, strip.rest),
            ],
          ),
        ],
      ),
      el(
        "div",
        {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "auto",
        },
        [
          el(
            "div",
            {
              display: "flex",
              alignItems: "center",
              height: 46,
              padding: "0 22px",
              borderRadius: 23,
              background: PILL,
              color: PILL_INK,
              fontSize: 21,
              fontWeight: 500,
            },
            pillText(tier),
          ),
          el(
            "div",
            {
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: NIGHT_INK,
              fontSize: 23,
              fontWeight: 500,
            },
            [mark(38), SITE_ADDRESS],
          ),
        ],
      ),
    ],
  );
}

function rankingCard(card: ShareRanking, pictures: Pictures): Node {
  const author = card.authorName.trim() || "someone";
  const locale = card.locale ?? AS_WRITTEN;
  const words = wordsFor(locale);
  const placed = card.rows.reduce((sum, row) => sum + row.length, 0);
  const head = say(locale, words.rankedHead, card.items.length, { placed });
  const line: Byline =
    card.editorial === true
      ? { before: head, name: null, after: "" }
      : { before: `${head} · `, name: author, after: "’s list" };
  const rows = card.tiers.slice(0, SHARE_TIERS).map((tier, index) => {
    const row = card.rows[index] ?? [];
    const items = row
      .slice(0, ROW_TILES)
      .map((position) => card.items[position])
      .filter((item): item is ShareItem => item !== undefined);
    const more = row.length - items.length;
    return el("div", { display: "flex", alignItems: "center", gap: 8, height: 64 }, [
      band(tier, 64),
      ...items.map((item) => tile(item, pictures, 43, 64)),
      ...(more > 0
        ? [
            el(
              "div",
              {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 43,
                height: 64,
                borderRadius: 6,
                background: POOL,
                color: INK_DIM,
                fontSize: 14,
              },
              `+${more}`,
            ),
          ]
        : []),
    ]);
  });
  const hidden = card.tiers.length - SHARE_TIERS;
  return frame([
    heading(card, line),
    el("div", { display: "flex", flexDirection: "column", gap: 6 }, rows),
    el("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, [
      el(
        "div",
        { fontSize: 16, color: INK_FAINT },
        hidden > 0 ? say(locale, words.moreTiers, hidden) : "",
      ),
      brand(),
    ]),
  ]);
}

/** The card as a tree satori can draw, given the pictures that came. */
export function shareCardOf(card: ShareCard, pictures: Pictures): Node {
  if (card.kind === "ranking") return rankingCard(card, pictures);
  // A person's list shows its own ranking; a house list, or one that places
  // nothing, stays a list to rank.
  const top = authorTop(card);
  return top === null ? listCard(card, pictures) : authorCard(card, top, pictures);
}

/**
 * The look of the card. A copy is kept for good per version of a list, and a
 * chat keeps a picture by its address, so a change in the drawing has to
 * change both or nobody ever sees it. 4: the footer inside the card, every
 * script's letters, the author's name apart. 5: no count of rankings, and no
 * "Other" for a section approved after the first nine. 6: a newer section by
 * its own name, a house list's card in its reader's language, and a tier's
 * whole name on its band, smaller and between words, not its first three
 * letters. 7: a person's list as their own top row on the app's dark page.
 */
export const SHARE_LOOK = 7;

/** Where a chat fetches the picture from; versioned, so a republish (?v=its updatedAt) gets a new one. */
export const shareImageUrl = (
  host: string,
  kind: "l" | "r",
  id: string,
  version: number | string,
  locale: string = AS_WRITTEN,
): string =>
  `https://${host}/og/${kind}/${encodeURIComponent(id)}.png?v=${version}.${SHARE_LOOK}` +
  (locale === AS_WRITTEN ? "" : `&hl=${encodeURIComponent(locale)}`);

/** The one copy kept per version of a list or ranking, and per look of the card. */
export const shareImagePath = (kind: "l" | "r", id: string, version: number | string): string =>
  `${shareImageFolder(kind, id)}${version}.${SHARE_LOOK}.png`;

/** Where every copy of one list's or ranking's card lives. The slash keeps `abc` out of `abcd`. */
export const shareImageFolder = (kind: "l" | "r", id: string): string => `share/${kind}/${id}/`;
