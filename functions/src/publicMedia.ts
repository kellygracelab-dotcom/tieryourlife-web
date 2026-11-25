// Only folders the production Storage rules already allow anybody to read.
const KINDS = ["published", "avatars", "sections", "topics"];
const ID = /^[A-Za-z0-9_-]{1,128}$/;
// Republished pictures can carry a publication UUID after the original picture ID.
const PICTURE = /^[A-Za-z0-9_-]+$/;
/*
 * A published list's card picture at a tile's width: /img/{200|400}/published/{id}/{picture}.
 * A 600 × 900 copy shown at 64 × 96 made a list of 177 cards 28 MB, its tiles
 * grey for 10-17 s (Designer, 25.11). 200 is a tile on any screen, 400 a
 * search answer's or a sheet's poster; Play and a picture's own window keep
 * the original.
 */
export const CARD_WIDTHS: readonly number[] = [200, 400];

const PREFIX = "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/";

export function publicMediaPath(kind: string, id: string, picture: string): string | null {
  const path = `${kind}/${id}/${picture}`;
  return path.length <= 1024 && KINDS.includes(kind) && ID.test(id) && PICTURE.test(picture)
    ? path
    : null;
}

/** Decode only old media addresses for our bucket. Never interpret an arbitrary URL as a bucket read. */
export function storedPublicMedia(url: string): string | null {
  if (!url.startsWith(PREFIX)) return null;
  const query = url.indexOf("?", PREFIX.length);
  if (query < 0 || new URLSearchParams(url.slice(query + 1)).get("alt") !== "media") return null;
  const parts = url.slice(PREFIX.length, query).split(/%2f/i);
  return parts.length === 3 ? publicMediaPath(parts[0]!, parts[1]!, parts[2]!) : null;
}

/** Change only the address used to display bytes; board records keep their original URLs. */
export function mediaSrc(url: string): string {
  const path = storedPublicMedia(url);
  return path === null ? url : `/img/original/${path}`;
}
