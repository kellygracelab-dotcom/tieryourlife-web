import type { Firestore } from "firebase-admin/firestore";

/**
 * Who may not rank, and until when, read the way the proxy reads it
 * (TierYourLifeProxy `bans.ts`): the proxy writes `bans/{uid}` when a
 * moderator bans an author, and the app's `PUT /lists/{id}/rankings/mine`
 * refuses such an account; the site's /api/rank refuses it the same way.
 */
const BANS = "bans";

export interface Ban {
  /** When it lifts, in epoch ms, or null for one that does not. */
  until: number | null;
}

/**
 * Expiry is decided when somebody tries, not by a sweep: a document whose
 * `until` has passed is no ban at all.
 */
export function isBanned(ban: Ban | null, nowMs: number): ban is Ban {
  if (ban === null) return false;
  return ban.until === null || ban.until > nowMs;
}

/** The proxy's own answer to a banned account that ranks, word for word. */
export const bannedAnswer = (ban: Ban) => ({
  error: "You cannot rank at the moment",
  code: "BANNED" as const,
  until: ban.until,
});

/** The ban on somebody, or nothing at all. Expiry is judged where it is read. */
export async function readBan(db: Firestore, uid: string): Promise<Ban | null> {
  const doc = await db.collection(BANS).doc(uid).get();
  if (!doc.exists) return null;
  const until: unknown = doc.get("until");
  // Read as the proxy reads it: only a number or null is an end it knows;
  // anything else never compares as later than now, so it bans nobody.
  if (until !== null && typeof until !== "number") return null;
  return { until };
}
