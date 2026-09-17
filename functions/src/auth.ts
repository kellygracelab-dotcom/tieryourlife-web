import { getAuth } from "firebase-admin/auth";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";

export interface Identity {
  uid: string;
  isAnonymous: boolean;
}

/** Which install or person; a guest is fine here, rankings need no account. */
export async function requireUser(request: Request, response: Response): Promise<Identity | null> {
  const header = request.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    response.status(401).json({ error: "Missing ID token", code: "UNAUTHENTICATED" });
    return null;
  }
  try {
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, isAnonymous: decoded.firebase?.sign_in_provider === "anonymous" };
  } catch {
    response.status(401).json({ error: "Invalid ID token", code: "UNAUTHENTICATED" });
    return null;
  }
}

/**
 * Who is asking, when that only adds to the answer: a missing, stale or guest
 * token means nobody in particular, and nothing is refused.
 */
export async function optionalAccount(request: Request): Promise<Identity | null> {
  const header = request.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (token.length === 0) return null;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    const isAnonymous = decoded.firebase?.sign_in_provider === "anonymous";
    return isAnonymous ? null : { uid: decoded.uid, isAnonymous };
  } catch {
    return null;
  }
}

/** A person with an account: what is kept must outlive the browser's guest uid. */
export async function requireAccount(
  request: Request,
  response: Response,
): Promise<Identity | null> {
  const identity = await requireUser(request, response);
  if (identity === null) return null;
  if (identity.isAnonymous) {
    response.status(403).json({ error: "Sign in first", code: "NOT_SIGNED_IN" });
    return null;
  }
  return identity;
}
