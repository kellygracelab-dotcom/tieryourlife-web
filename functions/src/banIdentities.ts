import { createHash } from "node:crypto";

/**
 * A ban that outlives the account it was given to, read the way the proxy
 * reads it (TierYourLifeProxy `banIdentities.ts`, QA S12). Erasing an account
 * and signing in again makes a new uid for the same person, so when a banned
 * account is erased the proxy keeps the ban under who the person is to their
 * sign-in provider, hashed:
 *
 *   bannedIdentities/{sha256 hex of key}   {until, bannedAt}
 *
 * The site only reads these. The keys must come out exactly as the proxy's
 * do, or a ban kept there is never found here.
 */
export const BANNED_IDENTITIES = "bannedIdentities";

/** Sign-in methods whose id is not a person's: a guest, and an address the provider never checked. */
const NOT_A_PERSON = new Set(["anonymous", "password", "email", "custom"]);

export interface SignIn {
  providerId: string;
  uid: string;
}

export function hashedKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** `email:<address>` for a verified address, `<provider>:<id>` for each provider, hashed. */
export function identityKeys(verifiedEmail: string | null, signIns: readonly SignIn[]): string[] {
  const keys = new Set<string>();
  const email = verifiedEmail?.trim().toLowerCase() ?? "";
  if (email.length > 0) keys.add(`email:${email}`);
  for (const one of signIns) {
    if (!NOT_A_PERSON.has(one.providerId) && one.uid.length > 0)
      keys.add(`${one.providerId}:${one.uid}`);
  }
  return [...keys].map(hashedKey);
}

/** The sign-ins an ID token names in `firebase.identities`, `{"google.com": ["<sub>"]}`. */
export function signInsOfToken(identities: unknown): SignIn[] {
  if (typeof identities !== "object" || identities === null) return [];
  return Object.entries(identities as Record<string, unknown>).flatMap(([providerId, ids]) =>
    Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string").map((uid) => ({ providerId, uid }))
      : [],
  );
}
