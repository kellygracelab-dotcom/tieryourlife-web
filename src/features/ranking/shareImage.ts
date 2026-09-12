import type { PublishedItem, PublishedList, PublishedTier } from "../../api/types";
import { plural, strings } from "../../strings";

/**
 * The picture a finished ranking is shared as. 4:5, the tallest ratio feeds
 * show whole. Never scaled down: a long board shows one line of cards per
 * tier with a "+N" chip, as many tiers as fit, then "and N more tiers".
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
}

export interface ShareRow {
  tier: number;
  y: number;
  cards: ShareCard[];
  /** How many cards the line could not hold. */
  overflow: number;
}

export interface SharePlan {
  rows: ShareRow[];
  moreTiers: number;
  cardsPerRow: number;
  rowHeight: number;
}

const rowHeight = SHARE.tile.height + SHARE.rowGap * 2;
const boardTop = SHARE.pad + SHARE.header;
const boardHeight = SHARE.height - boardTop - SHARE.footer - SHARE.pad;
const cardsLeft = SHARE.pad + SHARE.band + SHARE.gap;

export function planShare(tierCount: number, rows: readonly (readonly number[])[]): SharePlan {
  const step = SHARE.tile.width + SHARE.gap;
  const cardsPerRow = Math.floor((SHARE.width - cardsLeft - SHARE.pad + SHARE.gap) / step);
  const maxRows = Math.floor((boardHeight + SHARE.rowGap) / (rowHeight + SHARE.rowGap));
  const shown = Math.min(tierCount, maxRows);

  const planned: ShareRow[] = [];
  for (let tier = 0; tier < shown; tier++) {
    const row = rows[tier] ?? [];
    // The last slot goes to the chip when there is more than one card left over.
    const keep = row.length > cardsPerRow ? cardsPerRow - 1 : row.length;
    planned.push({
      tier,
      y: boardTop + tier * (rowHeight + SHARE.rowGap),
      cards: row.slice(0, keep).map((item, index) => ({ item, x: cardsLeft + index * step })),
      overflow: row.length - keep,
    });
  }
  return { rows: planned, moreTiers: tierCount - shown, cardsPerRow, rowHeight };
}

export interface ShareData {
  title: string;
  authorName: string;
  itemCount: number;
  tiers: readonly PublishedTier[];
  items: readonly PublishedItem[];
  rows: readonly (readonly number[])[];
  address: string;
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
        lines[maxLines - 1] = ellipsize(paint, rest, maxWidth);
        return lines;
      }
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines.map((text) => ellipsize(paint, text, maxWidth));
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
  const plan = planShare(data.tiers.length, data.rows);
  const { width, height, pad, band, tile, gap } = SHARE;

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
  paint.fillText(ellipsize(paint, `${data.authorName} · ${count}`, width - pad * 2), pad, pad + 98);

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
    rounded(
      paint,
      pad,
      row.y,
      width - pad * 2,
      plan.rowHeight,
      SHARE.radius,
      tint(meta.colorLight),
    );
    rounded(paint, pad, row.y, band, plan.rowHeight, SHARE.radius, meta.colorLight);
    paint.fillStyle = "#ffffff";
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.font = `500 40px ${FONT}`;
    const labelY =
      meta.caption === null ? row.y + plan.rowHeight / 2 : row.y + plan.rowHeight / 2 - 12;
    paint.fillText(ellipsize(paint, meta.label, band - 16), pad + band / 2, labelY);
    if (meta.caption !== null) {
      paint.font = `500 15px ${FONT}`;
      paint.fillText(ellipsize(paint, meta.caption, band - 16), pad + band / 2, labelY + 34);
    }

    const y = row.y + SHARE.rowGap;
    for (const card of row.cards) {
      const item = data.items[card.item];
      const picture = loaded.get(card.item) ?? null;
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
      const x = cardsLeft + row.cards.length * (tile.width + gap);
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
    const y = (last?.y ?? boardTop) + plan.rowHeight + 34;
    paint.fillStyle = DIM;
    paint.font = `400 22px ${FONT}`;
    paint.fillText(`and ${plan.moreTiers} more ${plan.moreTiers === 1 ? "tier" : "tiers"}`, pad, y);
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
    image.src = url;
  });

// A picture the page has already shown may sit in the cache without CORS
// headers, which makes that same URL unusable on a canvas. A fresh URL goes
// around the cached copy.
export const loadCanvasImage: LoadImage = async (url) =>
  (await fetchImage(url)) ?? fetchImage(`${url}${url.includes("?") ? "&" : "?"}canvas=1`);

export async function renderShare(
  data: ShareData,
  loadImage: LoadImage = loadCanvasImage,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Promise<Blob> {
  const canvas = makeCanvas();
  canvas.width = SHARE.width;
  canvas.height = SHARE.height;
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

export async function downloadShare(
  list: PublishedList,
  rows: readonly (readonly number[])[],
  address: string,
  render: typeof renderShare = renderShare,
  save: typeof saveBlob = saveBlob,
): Promise<void> {
  const blob = await render({
    title: list.title,
    authorName: list.authorName,
    itemCount: list.items.length,
    tiers: list.tiers,
    items: list.items,
    rows,
    address,
  });
  save(blob, fileNameFor(list.title));
}
