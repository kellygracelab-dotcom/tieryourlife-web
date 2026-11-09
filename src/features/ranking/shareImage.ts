import { privatePicturePath } from "../../lib/privatePictureRef";
import { mediaSrc } from "../../../functions/src/publicMedia";
import type { PublishedItem, PublishedList, PublishedTier } from "../../api/types";
import { isEditorial } from "../../lib/editorial";
import { drawnLines, fitText, type Measure } from "../../lib/textFit";
import { plural, strings } from "../../strings";

/**
 * The picture a finished ranking is shared as. 4:5, the tallest ratio feeds
 * show whole. Never scaled down: a long board shows one line of cards per
 * tier with a "+N" chip, as many tiers as fit, then "and N more tiers". One's
 * own board is drawn as the phone draws it instead (see BOARD_SHAPE).
 */
export const SHARE = {
  width: 1080,
  height: 1350,
  pad: 48,
  header: 150,
  footer: 90,
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
  /** The whole picture's. */
  height: number;
}

/**
 * How the picture is laid out. A ranking's: one line a tier on the 4:5 page.
 * A board's, as the phone's picture of a board: every tier and the pool
 * after them, up to six lines a tier, the page as tall as that takes.
 */
export interface ShareShape {
  lines: number;
  grow: boolean;
}
export const RANKING_SHAPE: ShareShape = { lines: 1, grow: false };
export const BOARD_SHAPE: ShareShape = { lines: 6, grow: true };

const rowHeight = SHARE.tile.height + SHARE.rowGap * 2;
const lineStep = SHARE.tile.height + SHARE.rowGap;
const boardTop = SHARE.pad + SHARE.header;
const boardHeight = SHARE.height - boardTop - SHARE.footer - SHARE.pad;
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
): SharePlan {
  const maxRows = Math.floor((boardHeight + SHARE.rowGap) / (rowHeight + SHARE.rowGap));
  const shown = shape.grow ? tierCount : Math.min(tierCount, maxRows);
  const room = cardsPerRow * shape.lines;

  const planned: ShareRow[] = [];
  let y = boardTop;
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
  const height = shape.grow
    ? Math.max(SHARE.height, y - SHARE.rowGap + SHARE.footer + SHARE.pad)
    : SHARE.height;
  return { rows: planned, moreTiers: tierCount - shown, cardsPerRow, rowHeight, height };
}

export interface ShareData {
  title: string;
  authorName: string;
  itemCount: number;
  tiers: readonly PublishedTier[];
  items: readonly PublishedItem[];
  rows: readonly (readonly number[])[];
  address: string;
  /** A board's cards still in its pool, drawn after the tiers; a ranking's picture has none. */
  pool?: readonly number[];
}

/** The plan for the data: a board's picture has its pool as one more row, under the tiers. */
export function planOf(data: ShareData): SharePlan {
  if (data.pool === undefined) return planShare(data.tiers.length, data.rows);
  const rows = data.tiers.map((_, tier) => data.rows[tier] ?? []);
  return planShare(data.tiers.length + 1, [...rows, data.pool], BOARD_SHAPE);
}

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
}

export type LoadImage = (url: string) => Promise<CanvasImageSource | null>;

const FONT = "Roboto, system-ui, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const PAPER = "#e9e7e2";
const INK = "#1a1a1a";
const DIM = "rgba(0, 0, 0, 0.62)";
const TILE = "#dad7e0";
const TILE_LABEL = "#5d5c66";

function ellipsize(paint: Paint, text: string, maxWidth: number): string {
  if (paint.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && paint.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

function tint(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) return TILE;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part ?? "0", 16));
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

function rounded(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  paint.fillStyle = fill;
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

function nameTile(paint: Paint, x: number, y: number, title: string) {
  const { width, height } = SHARE.tile;
  rounded(paint, x, y, width, height, SHARE.tileRadius, TILE);
  paint.fillStyle = TILE_LABEL;
  paint.font = `500 14px ${FONT}`;
  paint.textAlign = "center";
  paint.textBaseline = "middle";
  const lines = wrap(paint, title, width - 12, 3);
  lines.forEach((text, index) => {
    const offset = (index - (lines.length - 1) / 2) * 18;
    paint.fillText(text, x + width / 2, y + height / 2 + offset);
  });
}

export async function drawShare(
  paint: Paint,
  data: ShareData,
  loadImage: LoadImage,
): Promise<SharePlan> {
  const plan = planOf(data);
  const { width, pad, band, tile } = SHARE;
  const height = plan.height;
  // The pool's row: its band in the pool's own grey, its word smaller than a tier's letter.
  const pool: PublishedTier = {
    label: strings.export.unranked,
    caption: null,
    colorLight: TILE,
    colorDark: TILE,
  };

  paint.fillStyle = PAPER;
  paint.fillRect(0, 0, width, height);

  paint.textAlign = "left";
  paint.textBaseline = "alphabetic";
  paint.fillStyle = INK;
  paint.font = `500 44px ${FONT}`;
  paint.fillText(ellipsize(paint, data.title, width - pad * 2), pad, pad + 52);
  paint.fillStyle = DIM;
  paint.font = `400 26px ${FONT}`;
  const count = plural(strings.card.items, data.itemCount);
  // A list without an author says how long it is, and names nobody.
  const line = [data.authorName.trim(), count].filter((part) => part.length > 0).join(" · ");
  paint.fillText(ellipsize(paint, line, width - pad * 2), pad, pad + 98);

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
    const isPool = row.tier === data.tiers.length;
    const meta = isPool ? pool : data.tiers[row.tier];
    if (meta === undefined) continue;
    rounded(
      paint,
      pad,
      row.y,
      width - pad * 2,
      row.height,
      SHARE.radius,
      isPool ? "rgba(0, 0, 0, 0.04)" : tint(meta.colorLight),
    );
    rounded(paint, pad, row.y, band, row.height, SHARE.radius, meta.colorLight);
    paint.fillStyle = isPool ? TILE_LABEL : "#ffffff";
    bandWords(paint, meta, isPool ? 18 : 40, pad + band / 2, row.y, row.height);

    const lineY = (index: number) => row.y + SHARE.rowGap + index * lineStep;
    for (const card of row.cards) {
      const item = data.items[card.item];
      const picture = loaded.get(card.item) ?? null;
      const y = lineY(card.line);
      if (item === undefined) continue;
      if (picture === null) {
        nameTile(paint, card.x, y, item.title);
        continue;
      }
      paint.save();
      paint.beginPath();
      paint.roundRect(card.x, y, tile.width, tile.height, SHARE.tileRadius);
      paint.clip();
      paint.drawImage(picture, card.x, y, tile.width, tile.height);
      paint.restore();
    }
    if (row.overflow > 0) {
      const chip = slot(row.cards.length);
      const x = chip.x;
      const y = lineY(chip.line);
      rounded(paint, x, y, tile.width, tile.height, SHARE.tileRadius, "rgba(0, 0, 0, 0.08)");
      paint.fillStyle = INK;
      paint.font = `500 26px ${FONT}`;
      paint.textAlign = "center";
      paint.textBaseline = "middle";
      paint.fillText(`+${row.overflow}`, x + tile.width / 2, y + tile.height / 2);
    }
  }

  paint.textAlign = "left";
  paint.textBaseline = "alphabetic";
  if (plan.moreTiers > 0) {
    const last = plan.rows[plan.rows.length - 1];
    const y = (last?.y ?? boardTop) + (last?.height ?? plan.rowHeight) + 34;
    paint.fillStyle = DIM;
    paint.font = `400 22px ${FONT}`;
    paint.fillText(plural(strings.card.moreTiers, plan.moreTiers), pad, y);
  }

  const footerY = height - pad - 24;
  paint.fillStyle = INK;
  paint.font = `500 28px ${FONT}`;
  paint.fillText(strings.brand, pad, footerY);
  paint.textAlign = "right";
  paint.font = `500 26px ${MONO}`;
  paint.fillText(data.address, width - pad, footerY);

  return plan;
}

const fetchImage = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
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
  canvas.height = planOf(data).height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
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

export type Share = (
  list: PublishedList,
  rows: readonly (readonly number[])[],
  address: string,
) => Promise<void>;

/** The share sheet's part of a navigator: a test hands in its own. */
export type ShareSheet = Partial<Pick<Navigator, "canShare" | "share">>;

/** A phone hands a picture to its share sheet; a computer saves the file. */
const onPhone = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/**
 * One's own board as a picture, as the phone shares it: every tier and the
 * pool, handed to the share sheet with the link beside it, or saved as a file
 * where there is no sheet. A sheet closed without sharing is no failure.
 */
export async function shareBoardPicture(
  list: PublishedList,
  rows: readonly (readonly number[])[],
  address: string,
  render: typeof renderShare = renderShare,
  save: typeof saveBlob = saveBlob,
  sheet: ShareSheet | null = onPhone() ? navigator : null,
): Promise<void> {
  const placed = new Set(rows.flat());
  const blob = await render({
    title: list.title,
    authorName: isEditorial(list) ? "" : list.authorName,
    itemCount: list.items.length,
    tiers: list.tiers,
    items: list.items,
    rows,
    address,
    pool: list.items.flatMap((_, index) => (placed.has(index) ? [] : [index])),
  });
  const name = fileNameFor(list.title);
  const files = [new File([blob], name, { type: "image/png" })];
  if (sheet?.share !== undefined && sheet.canShare?.({ files }) === true) {
    try {
      await sheet.share({ files, title: list.title, text: `${list.title}\n${address}` });
      return;
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      // The sheet refused (the press too long ago, say): the file is saved instead.
    }
  }
  save(blob, name);
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
  });
  save(blob, fileNameFor(list.title));
}
