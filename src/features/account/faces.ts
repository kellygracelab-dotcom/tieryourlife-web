import type { ListSummary } from "../../api/types";

/** At most this many cards to choose a face from. */
export const FACE_CHOICES = 12;
export interface FaceChoice {
  url: string;
  /** The list the card came from, under the picture. */
  from: string;
}

/**
 * The pictures a face may be: cards from the person's own published lists.
 * Since 13.11.2026 nearly all of them are the feed's own copies; a face put
 * on lists and rankings is copied to the author's own folder by the backend.
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
