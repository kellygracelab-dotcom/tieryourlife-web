import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";
import { identityKeys, signInsOfToken } from "./banIdentities";

export interface Identity {
  uid: string;
  isAnonymous: boolean;
  /**
   * Who the person is to their sign-in provider, hashed as the proxy hashes
   * it: what a ban outlives an erased account by (QA S12). None for a guest.
   */
  banKeys: string[];
}

/** Reads an ID token; the default asks Firebase Auth, a test hands in its own. */
export type VerifyIdToken = (token: string) => Promise<DecodedToken>;

export interface DecodedToken {
  uid: string;
  email?: unknown;
  email_verified?: unknown;
  firebase?: { sign_in_provider?: string; identities?: unknown };
}

/** Whether the account behind a uid was erased; the default asks Firestore, a test hands in its own. */
export type IsErased = (uid: string) => Promise<boolean>;

/**
 * One document per erased account, written by the proxy's `DELETE
 * /boards/account` before anything else goes (QA S8). Its ID tokens stay good
 * for up to an hour after, and this is what refuses their writes.
 */
export const ERASED_ACCOUNTS = "erasedAccounts";

const firebaseAuth: VerifyIdToken = (token) => getAuth().verifyIdToken(token);
const firestoreErased: IsErased = async (uid) =>
  (await getFirestore().collection(ERASED_ACCOUNTS).doc(uid).get()).exists;

/** Reads find nothing of an erased account; anything else could bring some of it back. */
export function writes(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function identityOf(decoded: DecodedToken): Identity {
  const isAnonymous = decoded.firebase?.sign_in_provider === "anonymous";
  if (isAnonymous) return { uid: decoded.uid, isAnonymous, banKeys: [] };
  const email =
    decoded.email_verified === true && typeof decoded.email === "string" ? decoded.email : null;
  const banKeys = identityKeys(email, signInsOfToken(decoded.firebase?.identities));
  return { uid: decoded.uid, isAnonymous, banKeys };
}

/**
 * Which install or person; a guest is fine here, rankings need no account.
 * A write with the token of an account erased since is `401 ACCOUNT_ERASED`,
 * a guest's token included, as at the proxy, and `503 UNAVAILABLE` when that
 * cannot be checked.
 */
export async function requireUser(
  request: Request,
  response: Response,
  verify: VerifyIdToken = firebaseAuth,
  erased: IsErased = firestoreErased,
): Promise<Identity | null> {
  const header = request.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    response.status(401).json({ error: "Missing ID token", code: "UNAUTHENTICATED" });
    return null;
  }
  let identity: Identity;
  try {
    identity = identityOf(await verify(token));
  } catch {
    response.status(401).json({ error: "Invalid ID token", code: "UNAUTHENTICATED" });
    return null;
  }
  // A guest too: a token minted before the guest signed in with Google keeps
  // the same uid, and still says anonymous after that account is erased.
  if (!writes(request.method)) return identity;
  try {
    if (await erased(identity.uid)) {
      response.status(401).json({ error: "This account was deleted", code: "ACCOUNT_ERASED" });
      return null;
    }
  } catch (error) {
    console.error("Erased-account check failed", error);
    response.status(503).json({ error: "Unavailable", code: "UNAVAILABLE" });
    return null;
  }
  return identity;
}

/**
 * Who is asking, when that only adds to the answer: a missing, stale or guest
 * token means nobody in particular, and nothing is refused.
 */
export async function optionalAccount(
  request: Request,
  verify: VerifyIdToken = firebaseAuth,
): Promise<Identity | null> {
  const header = request.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (token.length === 0) return null;
  try {
    const identity = identityOf(await verify(token));
    return identity.isAnonymous ? null : identity;
  } catch {
    return null;
  }
}

/**
 * A person with an account: what is kept must outlive the browser's guest uid.
 * A guest is told 401 NOT_SIGNED_IN, as CONTRACT says of the site's account
 * routes: who they are was read, but it is not an account.
 */
export async function requireAccount(
  request: Request,
  response: Response,
  verify: VerifyIdToken = firebaseAuth,
  erased: IsErased = firestoreErased,
): Promise<Identity | null> {
  const identity = await requireUser(request, response, verify, erased);
  if (identity === null) return null;
  if (identity.isAnonymous) {
    response.status(401).json({ error: "Sign in first", code: "NOT_SIGNED_IN" });
    return null;
  }
  return identity;
}
