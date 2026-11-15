import type { SyncedPlay } from "../../api/boards";
import { coverFocusOf, type Board } from "./model";

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
    // An own photo goes by its id, as a card's does (pictureOf): its address is this browser's.
    board.coverPictureId ?? board.coverImageUrl,
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
      if (item.sourceIndex !== undefined) text += encode(["sourceIndex", whole(item.sourceIndex)]);
    }
  }
  if (board.takenFrom !== null || board.origin || board.rankingChoice) {
    text += encode([
      "origin",
      board.takenFrom,
      whole(board.origin?.version ?? null),
      board.rankingChoice ?? null,
    ]);
  }
  // Said only when true, last, so every board that is not anonymous keeps the
  // fingerprint it had: the app appends the same field the same way.
  if (board.anonymous) text += encode(["anonymous"]);
  // A game in progress last of all, as its canonical JSON (canonicalPlay).
  if (board.play !== null) text += encode([canonicalPlay(board.play)]);
  // The cover's focus after everything, and only when it has one, so every
  // board without one keeps its fingerprint; whole numbers, so "1" and "1.0"
  // never part the phone and the site (agreed with Android, 15.11.2026).
  const focus = coverFocusOf(board);
  if (focus !== null) {
    text += encode([
      "coverFocus",
      String(Math.round(focus.x * 10_000)),
      String(Math.round(focus.y * 10_000)),
      String(Math.round(focus.zoom * 100)),
    ]);
  }
  // Each card's focus after that, by uid, the trash's too, only on a card
  // with a picture and a focus: every board without one keeps its fingerprint
  // (CONTRACT, Cover focus; agreed with Android, 15.11.2026).
  for (const item of [...board.items].sort(byUid)) {
    const placed = item.pictureFocus;
    if (placed === undefined || pictureOf(item) === null) continue;
    text += encode([
      "pictureFocus",
      item.uid,
      String(Math.round(placed.x * 10_000)),
      String(Math.round(placed.y * 10_000)),
      String(Math.round(placed.zoom * 100)),
    ]);
  }
  return text;
}

/**
 * A saved game as one line of JSON, the same on the phone: no spaces, the
 * keys in this order, scope only when there is one and keepTier only when
 * true, a skip's winner as null.
 */
export function canonicalPlay(play: SyncedPlay): string {
  return JSON.stringify({
    kind: play.kind,
    count: play.count,
    seed: play.seed,
    refine: play.refine,
    ids: play.ids,
    history: play.history,
    round: play.round,
    startedAt: play.startedAt,
    ...(play.scope === undefined || play.scope.length === 0 ? {} : { scope: play.scope }),
    ...(play.keepTier === true ? { keepTier: true } : {}),
  });
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function fingerprintOf(board: Board): Promise<string> {
  const bytes = new TextEncoder().encode(fingerprintText(board));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
