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

/**
 * The bucket path a face's address shows, however it is written: Storage's
 * own address, or the site's `/img/original/…` that shows the same bytes.
 */
function mediaPathOf(url: string): string | null {
  const stored = storedPublicMedia(url);
  if (stored !== null) return stored;
  try {
    const { pathname } = new URL(url, "https://tieryourlife.web.app");
    const match = /^\/img\/original\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
    return match === null ? null : publicMediaPath(match[1]!, match[2]!, match[3]!);
  } catch {
    return null;
  }
}

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
