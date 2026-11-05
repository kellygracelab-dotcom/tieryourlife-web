/**
 * The picture a chat shows for a link: a 1200×630 card with the list's title,
 * its author and its tiers, drawn with the pictures the list already has.
 * Pure: shareImage.ts fetches the pictures and turns the tree into pixels.
 */

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
}

export interface ShareItem {
  title: string;
  imageUrl: string | null;
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
  if (card.kind === "list") {
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

const band = (tier: ShareTier, size: number): Node =>
  el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      borderRadius: 10,
      background: tier.colorLight,
      color: SURFACE,
      flexShrink: 0,
    },
    [
      el(
        "div",
        { fontSize: Math.round(size * 0.44), fontWeight: 500, lineHeight: 1 },
        tier.label.slice(0, 3),
      ),
      ...(tier.caption
        ? [
            el(
              "div",
              { fontSize: 11, lineHeight: 1, marginTop: 4, opacity: 0.85, overflow: "hidden" },
              tier.caption.slice(0, 14),
            ),
          ]
        : []),
    ],
  );

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

const MARK_BANDS = ["#b03a32", "#c06a25", "#a98b1f", "#3f7f55", "#3c6e99"];

/** The app's icon at the size of a line of text: five tier bands behind a dark tile with the S. */
const mark = (size: number): Node =>
  el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      position: "relative",
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.22),
      overflow: "hidden",
      flexShrink: 0,
    },
    [
      ...MARK_BANDS.map((color) => el("div", { display: "flex", flex: 1, background: color })),
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "absolute",
          left: Math.round(size * 0.21),
          top: Math.round(size * 0.21),
          width: Math.round(size * 0.58),
          height: Math.round(size * 0.58),
          borderRadius: Math.round(size * 0.17),
          background: "#121318",
          color: "#f7f5fa",
          fontSize: Math.round(size * 0.46),
          fontWeight: 500,
          lineHeight: 1,
        },
        "S",
      ),
    ],
  );

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
export const shareCardOf = (card: ShareCard, pictures: Pictures): Node =>
  card.kind === "list" ? listCard(card, pictures) : rankingCard(card, pictures);

/** Where a chat fetches the picture from; versioned, so a republish gets a new one. */
/**
 * The look of the card. A copy is kept for good per version of a list, and a
 * chat keeps a picture by its address, so a change in the drawing has to
 * change both or nobody ever sees it. 4: the footer inside the card, every
 * script's letters, the author's name apart. 5: no count of rankings, and no
 * "Other" for a section approved after the first nine. 6: a newer section by
 * its own name, and a house list's card in its reader's language.
 */
export const SHARE_LOOK = 6;

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
