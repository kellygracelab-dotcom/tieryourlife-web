import type { ListSummary } from "../../api/types";
import { publicMediaPath, storedPublicMedia } from "../../../functions/src/publicMedia";

/** At most this many cards to choose a face from. */
export const FACE_CHOICES = 12;
export interface FaceChoice {
  url: string;
  /** The list the card came from, under the picture. */
  from: string;
}

/**
 * The pictures a face may be: cards from the person's own published lists.
 * Since 13.11.2026 nearly all of them are the feed's own copies, which go
 * with a republish or an unpublish, so FaceSection cuts one of those and
 * keeps the cut with the account; a catalogue's picture is worn where it is.
 */
export function faceChoicesOf(lists: readonly ListSummary[]): FaceChoice[] {
  const seen = new Map<string, FaceChoice>();
  for (const list of lists) {
    for (const url of list.previewImages) {
      if (seen.size >= FACE_CHOICES) return [...seen.values()];
      if (!seen.has(url)) {
        seen.set(url, { url, from: list.title });
      }
    }
  }
  return [...seen.values()];
}

/** The site's hosts, each serving the bucket's public pictures under /img/original/. */
const SITE_HOSTS = new Set(["tieryourlife.web.app", "tieryourlife.firebaseapp.com"]);

/**
 * The bucket path a picture's address shows, however it is written: Storage's
 * own address, or the site's `/img/original/…` on either of its hosts (or
 * this page's own), which shows the same bytes. Null for anybody else's.
 */
export function ownMediaPath(url: string, here: string = window.location.origin): string | null {
  const stored = storedPublicMedia(url);
  if (stored !== null) return stored;
  let parsed: URL;
  try {
    parsed = new URL(url, here);
  } catch {
    return null;
  }
  const ours =
    parsed.origin === here || (parsed.protocol === "https:" && SITE_HOSTS.has(parsed.hostname));
  if (!ours) return null;
  const match = /^\/img\/original\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
  return match === null ? null : publicMediaPath(match[1]!, match[2]!, match[3]!);
}

/**
 * Where this page reads one of the bucket's pictures from itself, so a canvas
 * may cut it on either host (QA 19.11: on tieryourlife.firebaseapp.com a card
 * on web.app could only be used as it is).
 */
export function readableFaceSrc(url: string): string {
  const path = ownMediaPath(url);
  return path === null ? url : `/img/original/${path}`;
}

const mediaPathOf = (url: string): string | null => ownMediaPath(url);

/**
 * Whether two faces are one picture (QA 19.11, D13): the account may wear its
 * photo by the site's address while the slot names it by Storage's.
 */
export function samePicture(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  const path = mediaPathOf(a);
  return path !== null && path === mediaPathOf(b);
}
