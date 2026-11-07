import type { Firestore } from "firebase-admin/firestore";
import { BANNED_IDENTITIES } from "./banIdentities";

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

/** A `bans/{uid}` document as the proxy reads it: only a number or null is an end it knows. */
function banOfAccount(until: unknown): Ban | null {
  // Anything else never compares as later than now, so it bans nobody.
  if (until !== null && typeof until !== "number") return null;
  return { until };
}

/** A `bannedIdentities/{key}` record as the proxy reads it: an end it knows, and when it began. */
function banOfIdentity(until: unknown, bannedAt: unknown): Ban | null {
  if (typeof bannedAt !== "number") return null;
  return banOfAccount(until);
}

/** Of two bans, the one that lifts last: one with no end outlasts any. */
export function longerBan(left: Ban, right: Ban): Ban {
  if (left.until === null) return left;
  if (right.until === null) return right;
  return left.until >= right.until ? left : right;
}

/**
 * The ban on somebody, or nothing at all: their own `bans/{uid}`, and a ban
 * kept by the proxy from an account of theirs that was erased (QA S12),
 * whichever lifts last. The longest one is in force whenever any is, so
 * expiry is still judged where it is read.
 */
export async function readBan(
  db: Firestore,
  identity: { uid: string; banKeys: readonly string[] },
): Promise<Ban | null> {
  const [own, ...kept] = await Promise.all([
    db.collection(BANS).doc(identity.uid).get(),
    ...identity.banKeys.map((key) => db.collection(BANNED_IDENTITIES).doc(key).get()),
  ]);
  const bans = [
    own?.exists === true ? banOfAccount(own.get("until")) : null,
    ...kept.map((doc) =>
      doc.exists ? banOfIdentity(doc.get("until"), doc.get("bannedAt")) : null,
    ),
  ];
  return bans.reduce<Ban | null>(
    (longest, ban) => (ban === null ? longest : longest === null ? ban : longerBan(longest, ban)),
    null,
  );
}
