import { privatePicturePath } from "../../lib/privatePictureRef";
import { mediaSrc } from "../../../functions/src/publicMedia";
import type { PublishedItem, PublishedList, PublishedTier } from "../../api/types";
import { isEditorial } from "../../lib/editorial";
import { drawnLines, fitText, type Measure } from "../../lib/textFit";
import { fill, plural, strings } from "../../strings";
import { cardNamesOn } from "../../lib/cardNames";
import { shownScheme } from "../../lib/theme";
import { shownLight } from "../../lib/tierColour";
import { shared } from "../../lib/usageEvents";

/**
 * The picture a finished ranking is shared as. 4:5, the tallest ratio feeds
 * show whole. Never scaled down: a long board shows one line of cards per
 * tier with a "+N" chip, as many tiers as fit, then "and N more tiers". One's
 * own board is drawn as the phone draws it instead (see BOARD_SHAPE). The
 * list's name takes up to two lines, the cards not placed one line under the
 * tiers, and the footer the mark with a pill that leads to the list itself
 * (artboard 40).
 */
export const SHARE = {
  width: 1080,
  height: 1350,
  pad: 48,
  /** The list's name: its size, the step between its lines, and how many it may take. */
  title: { size: 44, line: 56, lines: 2 },
  /** From the foot of the name's last line to the first tier: the counts' line and air. */
  byline: 76,
  /** The gap over the footer and the footer's own height, the mark's and the pill's. */
  footer: 86,
  mark: 54,
  /** One line of words under the tiers: the tiers left out, the cards not placed. */
  note: 40,
  band: 120,
  tile: { width: 96, height: 136 },
  gap: 10,
  rowGap: 10,
  radius: 12,
  tileRadius: 8,
} as const;

export interface ShareCard {
  item: number;
  x: number;
  /** Which of its tier's lines the card is on, from 0. */
  line: number;
}

export interface ShareRow {
  tier: number;
  y: number;
  /** As tall as its lines of cards. */
  height: number;
  cards: ShareCard[];
  /** How many cards the lines could not hold. */
  overflow: number;
}

export interface SharePlan {
  rows: ShareRow[];
  moreTiers: number;
  cardsPerRow: number;
  /** A tier of one line. */
  rowHeight: number;
  /** Where the tiers end and the lines of words under them begin. */
  bottom: number;
  /** The whole picture's. */
  height: number;
}

/**
 * How the picture is laid out. A ranking's: one line a tier on the 4:5 page.
 * A board's, as the phone's picture of a board: every tier, up to six lines
 * a tier, the page as tall as that takes.
 */
export interface ShareShape {
  lines: number;
  grow: boolean;
}
export const RANKING_SHAPE: ShareShape = { lines: 1, grow: false };
export const BOARD_SHAPE: ShareShape = { lines: 6, grow: true };

/** Where the tiers start, under a name of one line or two, and the lines of words known to follow them. */
export interface ShareFrame {
  top: number;
  notes: number;
}

/** Where the first tier starts under a name of so many lines. */
export const topFor = (nameLines: number): number =>
  SHARE.pad + nameLines * SHARE.title.line + SHARE.byline;

const rowHeight = SHARE.tile.height + SHARE.rowGap * 2;
const lineStep = SHARE.tile.height + SHARE.rowGap;
const cardsLeft = SHARE.pad + SHARE.band + SHARE.gap;
const step = SHARE.tile.width + SHARE.gap;
const cardsPerRow = Math.floor((SHARE.width - cardsLeft - SHARE.pad + SHARE.gap) / step);
/** Where the card or the chip in a tier's slot `index` stands. */
const slot = (index: number) => ({
  x: cardsLeft + (index % cardsPerRow) * step,
  line: Math.floor(index / cardsPerRow),
});

export function planShare(
  tierCount: number,
  rows: readonly (readonly number[])[],
  shape: ShareShape = RANKING_SHAPE,
  frame: ShareFrame = { top: topFor(1), notes: 0 },
): SharePlan {
  const fit = (notes: number) =>
    Math.floor(
      (SHARE.height - frame.top - SHARE.footer - SHARE.pad - notes * SHARE.note + SHARE.rowGap) /
        (rowHeight + SHARE.rowGap),
    );
  let shown = shape.grow ? tierCount : Math.min(tierCount, fit(frame.notes));
  // The line that counts the tiers left out needs a line's room of its own.
  if (shown < tierCount) shown = Math.min(shown, fit(frame.notes + 1));
  const room = cardsPerRow * shape.lines;

  const planned: ShareRow[] = [];
  let y = frame.top;
  for (let tier = 0; tier < shown; tier++) {
    const row = rows[tier] ?? [];
    // The last slot goes to the chip when there is more than one card left over.
    const keep = row.length > room ? room - 1 : row.length;
    const slots = keep + (row.length > keep ? 1 : 0);
    const lines = Math.max(1, Math.ceil(slots / cardsPerRow));
    const height = rowHeight + (lines - 1) * lineStep;
    planned.push({
      tier,
      y,
      height,
      cards: row.slice(0, keep).map((item, index) => ({ item, ...slot(index) })),
      overflow: row.length - keep,
    });
    y += height + SHARE.rowGap;
  }
  const bottom = planned.length === 0 ? frame.top : y - SHARE.rowGap;
  const moreTiers = tierCount - shown;
  const notes = frame.notes + (moreTiers > 0 ? 1 : 0);
  const height = shape.grow
    ? Math.max(SHARE.height, bottom + notes * SHARE.note + SHARE.footer + SHARE.pad)
    : SHARE.height;
  return { rows: planned, moreTiers, cardsPerRow, rowHeight, bottom, height };
}

export interface ShareData {
  title: string;
  authorName: string;
  itemCount: number;
  tiers: readonly PublishedTier[];
  items: readonly PublishedItem[];
  rows: readonly (readonly number[])[];
  /**
   * The list's own link, or the site's where the list has none (one not
   * published, or held for a moderator). Drawn without its scheme.
   */
  address: string;
  /** One's own board, drawn as the phone draws it (BOARD_SHAPE); a ranking's picture is 4:5. */
  board?: boolean;
  /** Each pictured card's name on its foot, as the board shows it while names are on (artboard 36). */
  names?: boolean;
  /** In the scheme the person sees the site in: dark paper and the tiers' dark colours. */
  dark?: boolean;
}

/** How many of the list's cards are in no tier: said in one line under the tiers. */
export const notPlacedOf = (data: ShareData): number =>
  Math.max(0, data.itemCount - new Set(data.rows.flat()).size);

/** The plan for the data, under a name of so many lines. */
export function planOf(data: ShareData, nameLines = 1): SharePlan {
  const rows = data.tiers.map((_, tier) => data.rows[tier] ?? []);
  return planShare(data.tiers.length, rows, data.board === true ? BOARD_SHAPE : RANKING_SHAPE, {
    top: topFor(nameLines),
    notes: notPlacedOf(data) > 0 ? 1 : 0,
  });
}

/**
 * The address as the footer shows it, without its scheme. One with a path
 * is a list's own link, which only a list out in the world has.
 */
export const shortAddress = (address: string): string =>
  address.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").replace(/\/+$/, "");

/** The slice of a 2D context the drawing needs, so a test can hand in a recorder. */
export interface Paint {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  roundRect(x: number, y: number, w: number, h: number, radii: number): void;
  fill(): void;
  save(): void;
  restore(): void;
  clip(): void;
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    start: number,
    end: number,
    anticlockwise?: boolean,
  ): void;
}

export type LoadImage = (url: string) => Promise<CanvasImageSource | null>;

const FONT = "Roboto, system-ui, sans-serif";

/**
 * The site's paper and ink in each scheme (src/ui/tokens.css): the picture
 * is drawn in the one the person sees, the tiers in that scheme's colour
 * with its letter, light on the light colours and near-black on the dark.
 */
export interface Scheme {
  paper: string;
  ink: string;
  dim: string;
  tile: string;
  tileLabel: string;
  /** How much of a tier's colour its row takes over the paper. */
  tint: number;
  onBand: string;
  chip: string;
  pill: string;
  onPill: string;
}

export const LIGHT: Scheme = {
  paper: "#e9e7e2",
  ink: "#1a1a1a",
  dim: "rgba(0, 0, 0, 0.62)",
  tile: "#dad7e0",
  tileLabel: "#5d5c66",
  tint: 0.12,
  onBand: "#ffffff",
  chip: "rgba(0, 0, 0, 0.08)",
  pill: "#1b1b1f",
  onPill: "#ffffff",
};

export const DARK: Scheme = {
  paper: "#131318",
  ink: "#e4e1e9",
  dim: "#c7c5d0",
  tile: "#26262c",
  tileLabel: "#c7c5d0",
  tint: 0.2,
  onBand: "#121318",
  chip: "rgba(255, 255, 255, 0.08)",
  pill: "#e4e1e9",
  onPill: "#1b1b21",
};

function ellipsize(paint: Paint, text: string, maxWidth: number): string {
  if (paint.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && paint.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

function tint(hex: string, scheme: Scheme): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) return scheme.tile;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part ?? "0", 16));
  return `rgba(${r}, ${g}, ${b}, ${scheme.tint})`;
}

function rounded(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  colour: string,
) {
  paint.fillStyle = colour;
  paint.beginPath();
  paint.roundRect(x, y, w, h, r);
  paint.fill();
}

function wrap(paint: Paint, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let line = "";
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && paint.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) {
        const rest = `${lines[maxLines - 1] ?? ""} ${words.slice(index).join(" ")}`;
        lines[maxLines - 1] = rest;
        // A word wider than the tile is cut too, on whichever line it fell.
        return lines.map((part) => ellipsize(paint, part, maxWidth));
      }
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines.map((part) => ellipsize(paint, part, maxWidth));
}

/** The band's type: the letter from its size down to the floor, the caption's, and the gap between. */
const BAND_WORDS = {
  floor: 16,
  line: 1.15,
  caption: 15,
  captionLine: 20,
  gap: 6,
  inset: 8,
} as const;

/**
 * A tier's words on its band, as the board sets them: the letter, or a
 * name, as large as fits with every word whole, then the caption, both
 * broken between words and centred in the row. Only a word wider than the
 * band at the smallest size is broken, with a hyphen; only words past the
 * row's height end in an ellipsis.
 */
function bandWords(
  paint: Paint,
  tier: PublishedTier,
  start: number,
  middle: number,
  top: number,
  height: number,
) {
  const { floor, line, caption: captionSize, captionLine, gap, inset } = BAND_WORDS;
  const width = SHARE.band - inset * 2;
  const room = height - inset * 2;
  const measure: Measure = (text, size) => {
    paint.font = `500 ${size}px ${FONT}`;
    return paint.measureText(text).width;
  };
  const caption = tier.caption?.trim() ?? "";
  // The caption takes no more than half the band, so the letter always shows.
  const captionLines = clamped(
    caption === "" ? [] : drawnLines(caption, width, captionSize, measure),
    Math.max(1, Math.floor(room / 2 / captionLine)),
    width,
    captionSize,
    measure,
  );
  const below = captionLines.length === 0 ? 0 : gap + captionLines.length * captionLine;
  const fit = fitText(tier.label, { width, height: room - below }, { start, floor, line }, measure);
  const labelStep = fit.size * line;
  const labelLines = clamped(
    drawnLines(tier.label, width, fit.size, measure),
    Math.max(1, Math.floor((room - below) / labelStep)),
    width,
    fit.size,
    measure,
  );
  const block = labelLines.length * labelStep + below;
  let y = top + (height - block) / 2;
  paint.textAlign = "center";
  paint.textBaseline = "middle";
  paint.font = `500 ${fit.size}px ${FONT}`;
  for (const text of labelLines) {
    paint.fillText(text, middle, y + labelStep / 2);
    y += labelStep;
  }
  y += gap;
  paint.font = `500 ${captionSize}px ${FONT}`;
  for (const text of captionLines) {
    paint.fillText(text, middle, y + captionLine / 2);
    y += captionLine;
  }
}

/** At most so many lines, the last ending in an ellipsis when there were more. */
function clamped(
  lines: string[],
  most: number,
  width: number,
  size: number,
  measure: Measure,
): string[] {
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  let last = kept[most - 1] ?? "";
  while (last.length > 1 && measure(`${last}…`, size) > width) last = last.slice(0, -1);
  kept[most - 1] = `${last.trimEnd()}…`;
  return kept;
}

function nameTile(paint: Paint, x: number, y: number, title: string, scheme: Scheme) {
  const { width, height } = SHARE.tile;
  rounded(paint, x, y, width, height, SHARE.tileRadius, scheme.tile);
  paint.fillStyle = scheme.tileLabel;
  paint.font = `500 14px ${FONT}`;
  paint.textAlign = "center";
  paint.textBaseline = "middle";
  const lines = wrap(paint, title, width - 12, 3);
  lines.forEach((text, index) => {
    const offset = (index - (lines.length - 1) / 2) * 18;
    paint.fillText(text, x + width / 2, y + height / 2 + offset);
  });
}

/**
 * A pictured card's name along its foot, white on a shade, two lines at most,
 * as the board and the app draw it (17.11): broken between words only; a word
 * too wide makes the type smaller by half steps, 13 px down to 10; still too
 * wide, a hyphenated word breaks after its hyphen ("Detroit-" / "style"), and
 * what is still wider than the line ends in an ellipsis.
 */
function nameStrip(paint: Paint, x: number, y: number, title: string) {
  const { width, height } = SHARE.tile;
  const room = width - 8;
  const widest = () =>
    Math.max(0, ...title.split(/\s+/).map((word) => paint.measureText(word).width));
  let size = 13;
  paint.font = `500 ${size}px ${FONT}`;
  while (size > 10 && widest() > room) {
    size -= 0.5;
    paint.font = `500 ${size}px ${FONT}`;
  }
  const words = title
    .split(/\s+/)
    .flatMap((word) => (paint.measureText(word).width > room ? word.split(/(?<=-)(?=.)/) : [word]))
    .join(" ");
  const lines = wrap(paint, words, room, 2);
  if (lines.length === 0) return;
  const strip = 8 + lines.length * 15;
  paint.fillStyle = "rgba(0, 0, 0, 0.66)";
  paint.fillRect(x, y + height - strip, width, strip);
  paint.fillStyle = "#ffffff";
  paint.textAlign = "center";
  paint.textBaseline = "middle";
  lines.forEach((text, index) => {
    paint.fillText(text, x + width / 2, y + height - strip + 4 + 7.5 + index * 15);
  });
}

/** The list's name in its type: the site loads Roboto at 400 and 500 only, so 500 rather than a bold made up. */
const TITLE_FONT = `500 ${SHARE.title.size}px ${FONT}`;

/**
 * The list's name, whole where two lines hold it: broken between words, a
 * word wider than the page (a name in Japanese has no spaces) between its
 * characters, the hyphen left out between two of those. Only a name longer
 * than two lines ends in an ellipsis.
 */
export function titleLines(paint: Paint, title: string): string[] {
  paint.font = TITLE_FONT;
  const width = SHARE.width - SHARE.pad * 2;
  const measure: Measure = (text) => paint.measureText(text).width;
  const lines = drawnLines(title, width, SHARE.title.size, measure).map((line) =>
    line.replace(/([\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}])-$/u, "$1"),
  );
  return clamped(lines, SHARE.title.lines, width, SHARE.title.size, measure);
}

/**
 * The site's mark, as /favicon.svg draws it: the five tiers' stripes in a
 * rounded square, a dark square on them and the S of two rings. Drawn here
 * rather than loaded, so the footer never waits for it. Its units are the
 * favicon's, 72 across from 18.
 */
function drawMark(paint: Paint, x: number, y: number, size: number) {
  const k = size / 72;
  const at = (unit: number) => (unit - 18) * k;
  paint.save();
  paint.beginPath();
  paint.roundRect(x, y, size, size, 16 * k);
  paint.clip();
  const stripes: [string, number][] = [
    ["#B03A32", 18],
    ["#C06A25", 32.4],
    ["#A98B1F", 46.8],
    ["#3F7F55", 61.2],
    ["#3C6E99", 75.6],
  ];
  // Each stripe down to the foot, the next painted over it: no seam of paper between two.
  for (const [colour, from] of stripes) {
    paint.fillStyle = colour;
    paint.fillRect(x, y + at(from), size, (90 - from) * k);
  }
  paint.restore();
  rounded(paint, x + at(33), y + at(33), 42 * k, 42 * k, 12 * k, "#121318");
  // The S: the upper ring open on its right, the lower on its left, the two
  // meeting at the middle, each ring from 2.73 to 8.19 units out.
  const outer = 8.19 * k;
  const inner = 2.73 * k;
  const cx = x + at(54);
  const upper = y + at(48.54);
  const lower = y + at(59.46);
  const turn = Math.PI / 18;
  const down = Math.PI / 2;
  paint.fillStyle = "#F7F5FA";
  paint.beginPath();
  paint.arc(cx, upper, outer, turn, down, true);
  paint.arc(cx, upper, inner, down, turn, false);
  paint.fill();
  paint.beginPath();
  paint.arc(cx, lower, outer, -down, Math.PI + turn, false);
  paint.arc(cx, lower, inner, Math.PI + turn, -down, true);
  paint.fill();
}

/** The pill's type: from its size down to the floor before the invitation gives way to the link alone. */
const PILL = { size: 26, floor: 20, height: 54, inset: 27 } as const;

/**
 * The footer: the mark and the name on the left; on the right the pill that
 * sends people to rank the list themselves, at its own link (the site's
 * where it has none). Too long for its room, the pill's type gets smaller;
 * still too long, the link stands alone, since it is what leads somewhere.
 */
function footer(paint: Paint, height: number, address: string, scheme: Scheme) {
  const { width, pad, mark } = SHARE;
  const top = height - pad - mark;
  const middle = top + mark / 2;
  drawMark(paint, pad, top, mark);
  paint.fillStyle = scheme.ink;
  paint.font = `500 32px ${FONT}`;
  paint.textAlign = "left";
  paint.textBaseline = "middle";
  const nameLeft = pad + mark + 16;
  paint.fillText(strings.brand, nameLeft, middle);
  const room = width - pad - (nameLeft + paint.measureText(strings.brand).width + 24);

  const link = shortAddress(address);
  const fits = (text: string, size: number) => {
    paint.font = `400 ${size}px ${FONT}`;
    return paint.measureText(text).width + PILL.inset * 2 <= room;
  };
  let text = `${strings.shareCard.rankIt} · ${link}`;
  let size: number = PILL.size;
  while (size > PILL.floor && !fits(text, size)) size -= 1;
  if (!fits(text, size)) {
    text = link;
    size = PILL.size;
    while (size > PILL.floor && !fits(text, size)) size -= 1;
    text = ellipsize(paint, text, room - PILL.inset * 2);
  }
  paint.font = `400 ${size}px ${FONT}`;
  const pill = paint.measureText(text).width + PILL.inset * 2;
  const left = width - pad - pill;
  rounded(paint, left, middle - PILL.height / 2, pill, PILL.height, PILL.height / 2, scheme.pill);
  paint.fillStyle = scheme.onPill;
  paint.fillText(text, left + PILL.inset, middle);
}

export async function drawShare(
  paint: Paint,
  data: ShareData,
  loadImage: LoadImage,
): Promise<SharePlan> {
  const title = titleLines(paint, data.title);
  const plan = planOf(data, title.length);
  const { width, pad, band, tile } = SHARE;
  const height = plan.height;
  const scheme = data.dark === true ? DARK : LIGHT;
  const colourOf = (tier: PublishedTier) =>
    data.dark === true ? tier.colorDark : shownLight(tier.colorLight);

  paint.fillStyle = scheme.paper;
  paint.fillRect(0, 0, width, height);

  paint.textAlign = "left";
  paint.textBaseline = "alphabetic";
  paint.fillStyle = scheme.ink;
  paint.font = TITLE_FONT;
  title.forEach((text, index) => {
    paint.fillText(text, pad, pad + 47 + index * SHARE.title.line);
  });
  paint.fillStyle = scheme.dim;
  paint.font = `400 26px ${FONT}`;
  // How long the list is, how much of it is placed, and whose it is: only a
  // list out in the world, the one with a link of its own, names its author.
  const author = data.authorName.trim();
  const byline = [
    plural(strings.card.items, data.itemCount),
    plural(strings.shareCard.placed, data.itemCount - notPlacedOf(data)),
    author.length > 0 && shortAddress(data.address).includes("/")
      ? fill(strings.card.by, { name: author })
      : "",
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
  paint.fillText(
    ellipsize(paint, byline, width - pad * 2),
    pad,
    pad + title.length * SHARE.title.line + 36,
  );

  const pictures = await Promise.all(
    plan.rows.flatMap((row) =>
      row.cards.map(async ({ item }) => {
        const url = data.items[item]?.imageUrl ?? null;
        return [item, url === null ? null : await loadImage(url)] as const;
      }),
    ),
  );
  const loaded = new Map(pictures);

  for (const row of plan.rows) {
    const meta = data.tiers[row.tier];
    if (meta === undefined) continue;
    const colour = colourOf(meta);
    rounded(paint, pad, row.y, width - pad * 2, row.height, SHARE.radius, tint(colour, scheme));
    rounded(paint, pad, row.y, band, row.height, SHARE.radius, colour);
    paint.fillStyle = scheme.onBand;
    bandWords(paint, meta, 40, pad + band / 2, row.y, row.height);

    const lineY = (index: number) => row.y + SHARE.rowGap + index * lineStep;
    for (const card of row.cards) {
      const item = data.items[card.item];
      const picture = loaded.get(card.item) ?? null;
      const y = lineY(card.line);
      if (item === undefined) continue;
      if (picture === null) {
        nameTile(paint, card.x, y, item.title, scheme);
        continue;
      }
      paint.save();
      paint.beginPath();
      paint.roundRect(card.x, y, tile.width, tile.height, SHARE.tileRadius);
      paint.clip();
      paint.drawImage(picture, card.x, y, tile.width, tile.height);
      if (data.names === true) nameStrip(paint, card.x, y, item.title);
      paint.restore();
    }
    if (row.overflow > 0) {
      const chip = slot(row.cards.length);
      const x = chip.x;
      const y = lineY(chip.line);
      rounded(paint, x, y, tile.width, tile.height, SHARE.tileRadius, scheme.chip);
      paint.fillStyle = scheme.ink;
      paint.font = `500 26px ${FONT}`;
      paint.textAlign = "center";
      paint.textBaseline = "middle";
      paint.fillText(`+${row.overflow}`, x + tile.width / 2, y + tile.height / 2);
    }
  }

  // Under the tiers, a line each: the tiers left out, then the cards not
  // placed, which the picture counts rather than shows (artboard 40).
  const notPlaced = notPlacedOf(data);
  const notes = [
    plan.moreTiers > 0 ? plural(strings.card.moreTiers, plan.moreTiers) : "",
    notPlaced > 0 ? plural(strings.shareCard.notPlaced, notPlaced) : "",
  ].filter((note) => note.length > 0);
  paint.textAlign = "left";
  paint.textBaseline = "alphabetic";
  paint.fillStyle = scheme.dim;
  paint.font = `400 24px ${FONT}`;
  notes.forEach((note, index) => {
    const y = plan.bottom + index * SHARE.note + 34;
    paint.fillText(ellipsize(paint, note, width - pad * 2), pad, y);
  });

  footer(paint, height, data.address, scheme);
  return plan;
}

/** How long one picture may take: one that never answers is left out, not waited on forever. */
export const IMAGE_WAIT_MS = 8000;

const fetchImage = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    const late = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      clearTimeout(late);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(late);
      resolve(null);
    };
    image.src = mediaSrc(url);
  });

// A picture the page has already shown may sit in the cache without CORS
// headers, which makes that same URL unusable on a canvas. A fresh URL goes
// around the cached copy.
export const loadCanvasImage: LoadImage = async (url) => {
  const path = privatePicturePath(url);
  if (path) {
    const { privatePictureBytes } = await import("../../lib/privatePictureBytes");
    const bytes = await privatePictureBytes(path);
    if (!bytes) return null;
    const local = URL.createObjectURL(bytes);
    try {
      return await fetchImage(local);
    } finally {
      URL.revokeObjectURL(local);
    }
  }
  return (await fetchImage(url)) ?? fetchImage(`${url}${url.includes("?") ? "&" : "?"}canvas=1`);
};

export async function renderShare(
  data: ShareData,
  loadImage: LoadImage = loadCanvasImage,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Promise<Blob> {
  const canvas = makeCanvas();
  canvas.width = SHARE.width;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  // The page is as tall as the name's lines make it, which only the context can measure.
  canvas.height = planOf(data, titleLines(context, data.title).length).height;
  await drawShare(context, data, loadImage);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("no image")) : resolve(blob)),
      "image/png",
    );
  });
}

export function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "ranking"}-tieryourlife.png`;
}

export function saveBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = fileName;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "saved" when the picture went to a file, which the page says, since a download shows little. */
export type Share = (
  list: PublishedList,
  rows: readonly (readonly number[])[],
  address: string,
) => Promise<"saved" | void>;

/** The share sheet's part of a navigator: a test hands in its own. */
export type ShareSheet = Partial<Pick<Navigator, "canShare" | "share">>;

/** A phone hands a picture to its share sheet; a computer saves the file. */
const onPhone = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/**
 * One's own board as a picture, as the phone shares it: every tier, the
 * cards not placed counted under them, handed to the share sheet with the
 * link beside it, or saved as a file where there is no sheet. A sheet
 * closed without sharing is no failure.
 * Says "saved" when the file was saved, so the page can say where it went.
 */
export async function shareBoardPicture(
  list: PublishedList,
  rows: readonly (readonly number[])[],
  address: string,
  render: typeof renderShare = renderShare,
  save: typeof saveBlob = saveBlob,
  sheet: ShareSheet | null = onPhone() ? navigator : null,
): Promise<"saved" | void> {
  const blob = await render({
    title: list.title,
    authorName: isEditorial(list) ? "" : list.authorName,
    itemCount: list.items.length,
    tiers: list.tiers,
    items: list.items,
    rows,
    address,
    board: true,
    names: cardNamesOn(),
    dark: shownScheme() === "dark",
  });
  const name = fileNameFor(list.title);
  const files = [new File([blob], name, { type: "image/png" })];
  if (sheet?.share !== undefined && sheet.canShare?.({ files }) === true) {
    try {
      await sheet.share({ files, title: list.title, text: `${list.title}\n${address}` });
      shared("image");
      return;
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      // The sheet refused (the press too long ago, say): the file is saved instead.
    }
  }
  save(blob, name);
  // Saved as a file, to be sent on from there: an image shared all the same.
  shared("image");
  return "saved";
}

export async function downloadShare(
  list: PublishedList,
  rows: readonly (readonly number[])[],
  address: string,
  render: typeof renderShare = renderShare,
  save: typeof saveBlob = saveBlob,
): Promise<void> {
  const blob = await render({
    title: list.title,
    authorName: isEditorial(list) ? "" : list.authorName,
    itemCount: list.items.length,
    tiers: list.tiers,
    items: list.items,
    rows,
    address,
    names: cardNamesOn(),
    dark: shownScheme() === "dark",
  });
  save(blob, fileNameFor(list.title));
  shared("image");
}
