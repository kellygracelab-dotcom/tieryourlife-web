import type { Response } from "express";

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

/** Where a picture lives in the bucket, or null for an address that names none. */
export function picturePathOf(kind: string, id: string, picture: string): string | null {
  return KINDS.includes(kind) && PART.test(id) && PART.test(picture)
    ? `${kind}/${id}/${picture}`
    : null;
}

export interface PictureDeps {
  /** The stored picture's bytes, or null when there is none. */
  read: (path: string) => Promise<Buffer | null>;
  /** The picture at most this wide, as a WebP. */
  shrink: (bytes: Buffer, width: number) => Promise<Buffer>;
}

/** Answers /img/{width}/{kind}/{id}/{picture}; `segments` are the four after /img. */
export async function sendPicture(
  response: Response,
  segments: readonly string[],
  deps: PictureDeps,
): Promise<void> {
  const [width, kind, id, picture] = segments;
  const wide = Number(width);
  const path =
    segments.length === 4 && PICTURE_WIDTHS.includes(wide)
      ? picturePathOf(kind ?? "", id ?? "", picture ?? "")
      : null;
  const bytes = path === null ? null : await deps.read(path);
  if (bytes === null) {
    response.setHeader("Cache-Control", MISSING);
    response.status(404).json({ error: "No such picture", code: "NOT_FOUND" });
    return;
  }
  const shrunk = await deps.shrink(bytes, wide);
  response.setHeader("Content-Type", "image/webp");
  response.setHeader("Cache-Control", KEEP);
  response.status(200).send(shrunk);
}

export const storagePictures = (
  bucket: () => { file: (path: string) => { download: () => Promise<[Buffer]> } },
): PictureDeps => ({
  read: (path) =>
    bucket()
      .file(path)
      .download()
      .then(
        ([bytes]) => bytes,
        (error: { code?: number }) => {
          if (error.code === 404) return null;
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
