import type { Board } from "./model";

/**
 * What stands for a board's contents when two devices compare notes: the
 * phone's `BoardFingerprint`, byte for byte, so a board the phone wrote and
 * the same board here hash the same. Left out on purpose: anything local to
 * one device (the edit time, the star, where a copy came from) and the
 * published id, which is between one person and the feed.
 *
 * Fields go in with their lengths, so "Sci" + "fi" is not "Scifi" + "";
 * absent is not empty, and its marker cannot be mistaken for a length.
 */
const encode = (fields: readonly (string | null)[]): string =>
  fields.map((field) => (field === null ? "~|" : `${field.length}:${field}|`)).join("");

const whole = (n: number | null): string | null => (n === null ? null : String(Math.trunc(n)));

/** The picture's own id when the card has one, else a web address; a device's file path never travels. */
export const pictureOf = (item: {
  pictureId: string | null;
  imageUrl: string | null;
}): string | null =>
  item.pictureId ??
  (item.imageUrl !== null && item.imageUrl.startsWith("http") ? item.imageUrl : null);

/** The text the digest runs over; apart so a test can read it. */
export function fingerprintText(board: Board): string {
  const byUid = (a: { uid: string }, b: { uid: string }) =>
    a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  let text = encode([
    board.uid,
    board.title,
    board.displayMode,
    board.category,
    board.coverImageUrl,
    // The phone keeps a collage as lines in one column, and nothing at all for fewer than two.
    board.coverImageUrls.length >= 2 ? board.coverImageUrls.join("\n") : null,
    board.authorName,
    whole(board.deletedAt),
  ]);
  for (const tier of [...board.tiers].sort(byUid)) {
    text += encode([
      tier.uid,
      String(tier.position),
      tier.label,
      tier.caption,
      tier.colorLight,
      tier.colorDark,
      tier.isPool ? "true" : "false",
    ]);
    for (const item of board.items.filter((it) => it.tierUid === tier.uid).sort(byUid)) {
      text += encode([
        item.uid,
        String(item.position),
        item.title,
        pictureOf(item),
        item.source,
        whole(item.deletedAt),
      ]);
    }
  }
  return text;
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function fingerprintOf(board: Board): Promise<string> {
  const bytes = new TextEncoder().encode(fingerprintText(board));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
