import type { ListSummary } from "../../api/types";

/** At most this many cards to choose a face from. */
export const FACE_CHOICES = 12;
export interface FaceChoice {
  url: string;
  /** The list the card came from, under the picture. */
  from: string;
}

/**
 * The pictures a face may be: cards from the person's own lists that live on
 * the catalogue's servers. The feed's own copies of uploaded pictures go away
 * with a republish or an unpublish, so a face could not be one of those.
 */
export function faceChoicesOf(lists: readonly ListSummary[]): FaceChoice[] {
  const seen = new Map<string, FaceChoice>();
  for (const list of lists) {
    for (const url of list.previewImages) {
      if (seen.size >= FACE_CHOICES) return [...seen.values()];
      if (!url.includes("firebasestorage.googleapis.com") && !seen.has(url)) {
        seen.set(url, { url, from: list.title });
      }
    }
  }
  return [...seen.values()];
}
