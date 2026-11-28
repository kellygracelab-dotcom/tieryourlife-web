// Only folders the production Storage rules already allow anybody to read.
const KINDS = ["published", "avatars", "sections", "topics"];
const ID = /^[A-Za-z0-9_-]{1,128}$/;
// Republished pictures can carry a publication UUID after the original picture ID.
const PICTURE = /^[A-Za-z0-9_-]+$/;
/*
 * A published list's card picture at a tile's width: /img/{200|400|800}/published/{id}/{picture}.
 * A 600 × 900 copy shown at 64 × 96 made a list of 177 cards 28 MB, its tiles
 * grey for 10-17 s (Designer, 25.11). A page takes the smallest copy that
 * covers what it draws on that screen: 200 a tile on a plain screen, 400 a
 * tile on a sharp one, 800 Play's duel and a picture's own window, which
 * took the whole original before and still do past it (Danylo, 28.11:
 * beautiful on any device, not blurry).
 */
export const CARD_WIDTHS: readonly number[] = [200, 400, 800];

const PREFIX = "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/";

export function publicMediaPath(kind: string, id: string, picture: string): string | null {
  const path = `${kind}/${id}/${picture}`;
  return path.length <= 1024 && KINDS.includes(kind) && ID.test(id) && PICTURE.test(picture)
    ? path
    : null;
}

/*
 * The site's own addresses for the same public bytes. Since 20.11.2026 the
 * backend names every picture on the wire as https://tieryourlife.com/img/original/…
 * (Proxy #179), and boards and apps keep the older hosts they were given.
 * Read as the bucket path, a tile or a card goes to its small copy
 * (/img/480, /img/200) instead of the original: missed, a new browser fetched
 * ~1.7 MB of section originals the CDN keeps a minute (Coordinator, 27.11).
 */
const SITE_ORIGINALS = [
  "https://tieryourlife.com/img/original/",
  "https://www.tieryourlife.com/img/original/",
  "https://tieryourlife.web.app/img/original/",
  "https://tieryourlife.firebaseapp.com/img/original/",
];

/**
 * Decode only our bucket's public media addresses: Storage's own, and the
 * site's /img/original/ on its hosts. Never interpret an arbitrary URL as a bucket read.
 */
export function storedPublicMedia(url: string): string | null {
  const site = SITE_ORIGINALS.find((prefix) => url.startsWith(prefix));
  if (site !== undefined) {
    const parts = url.slice(site.length).split(/[?#]/)[0]!.split("/");
    return parts.length === 3 ? publicMediaPath(parts[0]!, parts[1]!, parts[2]!) : null;
  }
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
