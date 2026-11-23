/**
 * A published list's cover collage as one small picture (cover-collage BRIEF,
 * 23.11.2026): /img/collage/{listId}.webp. The feed drew up to six pictures
 * for every list without a cover of its own, each its own request; the
 * shared Proxy now names this address in the list's summary (`collageUrl`),
 * and the card loads one picture instead. Drawn on demand, never stored: the
 * address carries the list's version, so a browser keeps it for good and
 * the CDN for a minute, as a published list's own pictures.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Response } from "express";
import { PUBLISHED_ORIGINAL, rasterType } from "./pictures";

export const COLLAGE_WIDTH = 480;
export const COLLAGE_HEIGHT = 300;
/** The site's mosaic leaves 2px between its pictures (src/ui/ListArt.css, .art--mosaic). */
export const COLLAGE_GAP = 2;
/** The most pictures the mosaic shows, and the fewest that make a collage. */
export const COLLAGE_MAX = 6;
export const COLLAGE_MIN = 2;
/** Pictures tried in all: the mosaic fills a place a broken one leaves with the next. */
const COLLAGE_TRIES = 12;
const QUALITY = 80;
/**
 * A picture bigger than this many pixels is not decoded: one at a time and
 * cut down on loading, but a PNG cannot be, and the function has 512 MiB.
 * A 48-megapixel phone photo still fits.
 */
export const COLLAGE_PIXEL_LIMIT = 50_000_000;

const PUBLISHED = "publishedLists";
const LIST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const NOT_FOUND = "no-store";

/** A rectangle in the collage, in whole pixels. */
export interface Cell {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pictures per row, as the mosaic lays out each count: five is three over two. */
const ROWS: Readonly<Record<number, readonly number[]>> = {
  2: [2],
  3: [3],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
};

/**
 * Where each picture goes for [count] pictures, in drawing order: the
 * site's mosaic in the 480×300 frame, rows of equal height, the cells of a
 * row of equal width, 2px apart. Edges are rounded, so a gap may come out
 * a pixel wider or narrower, as a browser rounds a grid of thirds.
 */
export function collageCells(count: number): Cell[] {
  const rows = ROWS[Math.min(Math.max(count, COLLAGE_MIN), COLLAGE_MAX)] ?? [];
  const rowHeight = (COLLAGE_HEIGHT - (rows.length - 1) * COLLAGE_GAP) / rows.length;
  return rows.flatMap((perRow, row) => {
    const width = (COLLAGE_WIDTH - (perRow - 1) * COLLAGE_GAP) / perRow;
    const top = Math.round(row * (rowHeight + COLLAGE_GAP));
    const bottom = Math.round(row * (rowHeight + COLLAGE_GAP) + rowHeight);
    return Array.from({ length: perRow }, (_, at) => {
      const left = Math.round(at * (width + COLLAGE_GAP));
      const right = Math.round(at * (width + COLLAGE_GAP) + width);
      return { left, top, width: right - left, height: bottom - top };
    });
  });
}

/** Where a picture is looked at (CONTRACT, Cover focus): a point as fractions, and a zoom 1–4. */
export interface Focus {
  x: number;
  y: number;
  zoom: number;
}

/** A focus as stored, read with care, as the site's focusOf: anything out of range is none. */
export function focusOf(raw: unknown): Focus | null {
  if (raw === null || typeof raw !== "object") return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  const fraction = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (!fraction(x) || !fraction(y)) return null;
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 1 || zoom > 4) return null;
  return { x, y, zoom };
}

/** A picture taller than wide by more than this shows high without a focus (cover focus SPEC). */
const TALL_RATIO = 1.2;
const TALL_DEFAULT: Focus = { x: 0.5, y: 0.35, zoom: 1 };
const CENTRE: Focus = { x: 0.5, y: 0.5, zoom: 1 };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The part of a width×height picture a frame of [aspect] shows, in the
 * picture's own pixels: the cover focus SPEC's crop, as the site's frameOf
 * and the Proxy's cropOf (src/lib/coverCropVectors.json holds the cases).
 * Without a focus a tall picture shows its top part, any other its middle,
 * as the site's FocusedPicture draws it.
 */
export function cropOf(
  width: number,
  height: number,
  aspect: number,
  focus: Focus | null,
): { left: number; top: number; width: number; height: number } {
  const shown = focus ?? (height / width > TALL_RATIO ? TALL_DEFAULT : CENTRE);
  let cw: number;
  let ch: number;
  if (width / height > aspect) {
    ch = height;
    cw = height * aspect;
  } else {
    cw = width;
    ch = width / aspect;
  }
  cw /= shown.zoom;
  ch /= shown.zoom;
  return {
    left: clamp(shown.x * width - cw / 2, 0, width - cw),
    top: clamp(shown.y * height - ch / 2, 0, height - ch),
    width: cw,
    height: ch,
  };
}

/** What the collage needs of a published list, as the Proxy stores it. */
interface StoredList {
  underReview?: boolean;
  coverImageUrl?: unknown;
  previewImages?: unknown;
  items?: unknown;
}

/** One picture of the collage: its address and where it is cut. */
export interface CollagePicture {
  url: string;
  focus: Focus | null;
}

/** Old lists keep the word "null" as their cover; only a web address is a picture. */
const webPicture = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("https://") ? value : null;

/**
 * The pictures a list's card shows as its collage, in order, each with its
 * focus: the list's previews that are web addresses, each cut where the
 * first card with that picture is (the Proxy's toSummary and
 * previewFocusOf, which the site's mosaic draws). Empty when the list has a
 * cover of its own or fewer than two previews: its card shows no collage.
 */
export function collagePictures(data: StoredList): CollagePicture[] {
  if (webPicture(data.coverImageUrl) !== null) return [];
  const previews = (Array.isArray(data.previewImages) ? data.previewImages : []).flatMap(
    (one: unknown) => {
      const url = webPicture(one);
      return url === null ? [] : [url];
    },
  );
  if (previews.length < COLLAGE_MIN) return [];
  const focusByPicture = new Map<string, Focus>();
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const card = raw as { imageUrl?: unknown; pictureFocus?: unknown } | null;
    if (card === null || typeof card !== "object" || typeof card.imageUrl !== "string") continue;
    if (focusByPicture.has(card.imageUrl) || !card.pictureFocus) continue;
    // The first card with the picture says where it is cut, as the Proxy reads it.
    const focus = focusOf(card.pictureFocus);
    if (focus !== null) focusByPicture.set(card.imageUrl, focus);
  }
  return previews.map((url) => ({ url, focus: focusByPicture.get(url) ?? null }));
}

/** The catalogue's poster at a size a collage cell of up to 239×300 shows sharply. */
export const collageSizeOf = (url: string): string => url.replace("/t/p/w500/", "/t/p/w342/");

export interface CollageDeps {
  /** One picture's bytes, or null when it cannot be had: fetched safely, or read from the bucket. */
  load: (url: string) => Promise<Buffer | null>;
}

type Sharp = typeof import("sharp");

const loadSharp = async (): Promise<Sharp> => (await import("sharp")).default;

/** A picture that loaded and that sharp can read, with its size as shown (EXIF turned). */
interface Piece {
  bytes: Buffer;
  focus: Focus | null;
  width: number;
  height: number;
}

const decoding = { autoOrient: true, limitInputPixels: COLLAGE_PIXEL_LIMIT } as const;

/** A loaded picture's size, or null when it is not a raster sharp will decode. */
async function pieceOf(
  sharp: Sharp,
  bytes: Buffer | null,
  focus: Focus | null,
): Promise<Piece | null> {
  if (bytes === null || rasterType(bytes) === null) return null;
  try {
    const meta = await sharp(bytes, decoding).metadata();
    const { width, height } = meta.autoOrient ?? meta;
    if (!width || !height || width * height > COLLAGE_PIXEL_LIMIT) return null;
    return { bytes, focus, width, height };
  } catch {
    return null;
  }
}

/**
 * The pictures that load, up to six, in their order: the first six asked
 * for together, and as many more as broken ones left room for, as the
 * mosaic fills their places with the pictures after them.
 */
async function loadPieces(
  sharp: Sharp,
  pictures: readonly CollagePicture[],
  deps: CollageDeps,
): Promise<Piece[]> {
  const pieces: Piece[] = [];
  let next = 0;
  while (pieces.length < COLLAGE_MAX && next < Math.min(pictures.length, COLLAGE_TRIES)) {
    const batch = pictures.slice(next, next + COLLAGE_MAX - pieces.length);
    next += batch.length;
    const loaded = await Promise.all(
      batch.map((picture) => deps.load(picture.url).catch(() => null)),
    );
    for (const [at, bytes] of loaded.entries()) {
      const piece = await pieceOf(sharp, bytes, batch[at]?.focus ?? null);
      if (piece !== null) pieces.push(piece);
    }
  }
  return pieces.slice(0, COLLAGE_MAX);
}

/** One picture cut by its focus to fill [cell]: shrunk first, so sharp decodes it small. */
async function cut(sharp: Sharp, piece: Piece, cell: Cell): Promise<Buffer> {
  const crop = cropOf(piece.width, piece.height, cell.width / cell.height, piece.focus);
  const scale = cell.width / crop.width;
  const width = Math.max(cell.width, Math.round(piece.width * scale));
  const height = Math.max(cell.height, Math.round(piece.height * scale));
  return sharp(piece.bytes, decoding)
    .resize({ width, height, fit: "fill" })
    .extract({
      left: clamp(Math.round(crop.left * scale), 0, width - cell.width),
      top: clamp(Math.round(crop.top * scale), 0, height - cell.height),
      width: cell.width,
      height: cell.height,
    })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/**
 * The collage as a 480×300 WebP, the gaps and any empty room transparent so
 * the tile's own background shows through; null when fewer than two of the
 * pictures can be drawn. A picture that fails to cut leaves, and the rest
 * are laid out again for their count, as the mosaic does.
 */
export async function drawCollage(
  pictures: readonly CollagePicture[],
  deps: CollageDeps,
): Promise<Buffer | null> {
  const sharp = await loadSharp();
  let pieces = await loadPieces(sharp, pictures, deps);
  while (pieces.length >= COLLAGE_MIN) {
    const cells = collageCells(pieces.length);
    const cuts: { input: Buffer; left: number; top: number }[] = [];
    let failed = -1;
    // One at a time: a few decoded pictures at once is all the memory this takes.
    for (const [at, piece] of pieces.entries()) {
      const cell = cells[at];
      if (cell === undefined) break;
      try {
        cuts.push({ input: await cut(sharp, piece, cell), left: cell.left, top: cell.top });
      } catch {
        failed = at;
        break;
      }
    }
    if (failed >= 0) {
      pieces = pieces.filter((_, at) => at !== failed);
      continue;
    }
    return sharp({
      create: {
        width: COLLAGE_WIDTH,
        height: COLLAGE_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(cuts)
      .webp({ quality: QUALITY })
      .toBuffer();
  }
  return null;
}

const notFound = (response: Response): void => {
  // Not kept anywhere: a list back from review, or one given its pictures, draws at once.
  response.setHeader("Cache-Control", NOT_FOUND);
  response.status(404).json({ error: "No such picture", code: "NOT_FOUND" });
};

/**
 * Answers /img/collage/{listId}.webp; `name` is the last part. A list
 * missing or under review gets nothing, as its page and its link's picture
 * (pages.ts listPage, listShareImage); so does one whose card shows no
 * collage. The `v` in the address only tells versions apart.
 */
export async function sendCollage(
  response: Response,
  name: string,
  head: boolean,
  db: () => Firestore,
  deps: CollageDeps,
): Promise<void> {
  const id = name.endsWith(".webp") ? name.slice(0, -".webp".length) : "";
  if (!LIST_ID.test(id)) return notFound(response);
  const doc = await db().collection(PUBLISHED).doc(id).get();
  const data = doc.exists ? (doc.data() as StoredList | undefined) : undefined;
  if (data === undefined || data.underReview === true) return notFound(response);
  const pictures = collagePictures(data);
  if (pictures.length < COLLAGE_MIN) return notFound(response);
  const webp = await drawCollage(pictures, deps);
  if (webp === null) return notFound(response);
  response.setHeader("Content-Type", "image/webp");
  response.setHeader("Content-Length", String(webp.length));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  // A browser keeps a version for good; the CDN a minute, so a takedown stops it soon (pictures.ts).
  response.setHeader("Cache-Control", PUBLISHED_ORIGINAL);
  response.status(200);
  if (head) response.end();
  else response.send(webp);
}
