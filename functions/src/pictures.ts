import type { Response } from "express";
import { publicMediaPath } from "./publicMedia";

/*
 * Section and topic pictures through the site's own address, so Hosting's CDN
 * keeps them: /img/{width}/{sections|topics}/{id}/{pictureId}. Storage answers
 * each one in half a second to a second and says not to keep it; from here a
 * tile gets a copy its own size, once, and every later visitor gets it from
 * the nearest edge. Every upload has a new pictureId, so a copy never goes
 * stale and may be kept for a year.
 */

/** The widths the pages ask for: a tile, and a section's own header. */
export const PICTURE_WIDTHS: readonly number[] = [480, 1600];
const KINDS: readonly string[] = ["sections", "topics"];
const PART = /^[A-Za-z0-9_-]{1,64}$/;
const QUALITY = 80;

const KEEP = "public, max-age=31536000, s-maxage=31536000, immutable";
// A picture not there yet may be there in a minute: a race with its upload.
const MISSING = "public, max-age=60, s-maxage=60";
/*
 * A published list's picture, as it is (/img/original/published/...). A name
 * under published/ never changes its bytes: one's own photo is named by its
 * pictureId, a picture from outside or a catalogue's copy by w-{hash of its
 * address}, a copy of another list's picture by {original}-{name}. So a
 * browser keeps it for a year and never asks again. Hosting's shared CDN keeps
 * it only 60 s: it cannot be purged by path, and a picture deleted by a
 * moderation takedown must stop reaching anyone new within a minute. A
 * browser that already has it keeps its copy; that is the trade-off.
 */
export const PUBLISHED_ORIGINAL = "public, max-age=31536000, s-maxage=60, immutable";
/*
 * The shared catalogue copies boards show (published/catalogue/w-…): a poster
 * or a Commons photo, named by its catalogue address, never a person's own
 * picture and never taken down by moderation, so the CDN keeps it a day and
 * fewer views wake the function (QA, 14.11.2026). Lists' own copies keep the
 * minute above: their w- names do not say a catalogue poster from a picture
 * of another site, which a takedown must stop showing soon.
 */
export const CATALOGUE_ORIGINAL = "public, max-age=31536000, s-maxage=86400, immutable";
// Avatars, sections and topics as they are: an edge TTL so readers see a
// removal soon, and browsers ask again every time.
const OTHER_ORIGINAL = "public, max-age=0, s-maxage=60, must-revalidate";

/** Where a picture lives in the bucket, or null for an address that names none. */
export function picturePathOf(kind: string, id: string, picture: string): string | null {
  return KINDS.includes(kind) && PART.test(id) && PART.test(picture)
    ? `${kind}/${id}/${picture}`
    : null;
}

export interface PictureDeps {
  /** The stored picture's bytes, or null when there is none. */
  read: (path: string, limit?: number) => Promise<Buffer | null>;
  /** The picture at most this wide, as a WebP. */
  shrink: (bytes: Buffer, width: number) => Promise<Buffer>;
}

// The shared publisher accepts these four raster formats, up to four MiB.
const ORIGINAL_LIMIT = 4 * 1024 * 1024;

export function rasterType(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("latin1", 0, 6))) return "image/gif";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP")
    return "image/webp";
  return null;
}

/** Answers /img/{width}/{kind}/{id}/{picture}; `segments` are the four after /img. */
export async function sendPicture(
  response: Response,
  segments: readonly string[],
  deps: PictureDeps,
): Promise<void> {
  const [width, kind, id, picture] = segments;
  const wide = Number(width);
  const original = width === "original" && segments.length === 4;
  const path = original
    ? publicMediaPath(kind ?? "", id ?? "", picture ?? "")
    : segments.length === 4 && PICTURE_WIDTHS.includes(wide)
      ? picturePathOf(kind ?? "", id ?? "", picture ?? "")
      : null;
  const bytes = path === null ? null : await deps.read(path, original ? ORIGINAL_LIMIT : undefined);
  const type = original && bytes !== null ? rasterType(bytes) : "image/webp";
  if (bytes === null || type === null) {
    response.setHeader("Cache-Control", MISSING);
    response.status(404).json({ error: "No such picture", code: "NOT_FOUND" });
    return;
  }
  response.setHeader("Content-Type", type);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  response.setHeader(
    "Cache-Control",
    !original
      ? KEEP
      : kind !== "published"
        ? OTHER_ORIGINAL
        : id === "catalogue"
          ? CATALOGUE_ORIGINAL
          : PUBLISHED_ORIGINAL,
  );
  response.status(200).send(original ? bytes : await deps.shrink(bytes, wide));
}

export const storagePictures = (
  bucket: () => {
    file: (path: string) => {
      download: (options?: {
        start: number;
        end: number;
        decompress: false;
        validation: false;
      }) => Promise<[Buffer]>;
    };
  },
): PictureDeps => ({
  read: (path, limit) =>
    bucket()
      .file(path)
      .download(
        limit === undefined
          ? undefined
          : { start: 0, end: limit, decompress: false, validation: false },
      )
      .then(
        ([bytes]) => (limit !== undefined && bytes.length > limit ? null : bytes),
        (error: { code?: number }) => {
          if (error.code === 404 || error.code === 416) return null;
          throw error;
        },
      ),
  shrink: async (bytes, width) => {
    // Loaded here, not with the module: the other pages never wait for it.
    const { default: sharp } = await import("sharp");
    return sharp(bytes)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
  },
});
