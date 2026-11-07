import { getAppCheck } from "firebase-admin/app-check";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";

/** The same code the backend sends, so the site can tell this 401 from a sign-in one. */
export const APP_UNVERIFIED = "APP_UNVERIFIED";

type Environment = Record<string, string | undefined>;

/** Every project id the runtime names; a deployed function names its real one. */
function projectsOf(env: Environment): string[] {
  const ids: string[] = [];
  if (env.GCLOUD_PROJECT) ids.push(env.GCLOUD_PROJECT);
  try {
    const config = JSON.parse(env.FIREBASE_CONFIG ?? "{}") as { projectId?: unknown };
    if (typeof config.projectId === "string") ids.push(config.projectId);
  } catch {
    // An unreadable config names nothing, and nothing named skips nothing.
  }
  return ids;
}

/**
 * Whether this runs in the Firebase emulators of a demo- project, where
 * nothing may reach the real site. Both have to hold: the emulator sets
 * FUNCTIONS_EMULATOR, and a demo- project exists only there, so a deployed
 * function never takes this for itself. The proxy keeps the same rule (its
 * CONTRACT.md, E2E).
 */
export function inDemoEmulator(env: Environment = process.env): boolean {
  const projects = projectsOf(env);
  return (
    env.FUNCTIONS_EMULATOR === "true" &&
    projects.length > 0 &&
    projects.every((id) => id.startsWith("demo-"))
  );
}

/**
 * The browser smokes in e2e-proxy/ run the site against these functions in
 * the Firebase emulators, where no App Check token can be had.
 */
export const skipsAppCheck = (env: Environment = process.env): boolean => inDemoEmulator(env);

/** What the App Check backend says of a token it was asked to spend. */
export interface Spent {
  alreadyConsumed?: boolean;
}

/**
 * For a request that costs something (a new ranking): the token is spent as
 * it is checked, so the same token cannot be sent again (QA S25). The site
 * asks for a one-use token for these. A token already spent is refused.
 *
 * The spending is one more call to the App Check backend, and it needs the
 * function's service account to hold the Token Verifier role. When that call
 * fails for any reason but a bad token, the ordinary check decides, as it did
 * before, and the log says why: a missing role must not stop every save.
 */
export async function requireFreshAppCheck(
  request: Request,
  response: Response,
  spend: (token: string) => Promise<Spent> = (token) =>
    getAppCheck().verifyToken(token, { consume: true }),
  verify: (token: string) => Promise<unknown> = (token) => getAppCheck().verifyToken(token),
  env: Environment = process.env,
  log: (message: string, detail: unknown) => void = (message, detail) =>
    console.error(message, detail),
): Promise<boolean> {
  if (skipsAppCheck(env)) return true;
  const token = request.header("X-Firebase-AppCheck");
  if (!token) {
    response.status(401).json({ error: "Missing App Check token", code: APP_UNVERIFIED });
    return false;
  }
  let spent: Spent;
  try {
    spent = await spend(token);
  } catch (reason) {
    try {
      await verify(token);
    } catch {
      response.status(401).json({ error: "Invalid App Check token", code: APP_UNVERIFIED });
      return false;
    }
    log("App Check replay protection did not run", errorCodeOf(reason));
    return true;
  }
  if (spent.alreadyConsumed === true) {
    response.status(401).json({ error: "App Check token already used", code: APP_UNVERIFIED });
    return false;
  }
  return true;
}

/** An error's code and message for the log, never the token. */
const errorCodeOf = (reason: unknown): unknown =>
  reason instanceof Error
    ? { code: (reason as { code?: unknown }).code ?? null, message: reason.message }
    : String(reason);

export async function requireAppCheck(
  request: Request,
  response: Response,
  verify: (token: string) => Promise<unknown> = (token) => getAppCheck().verifyToken(token),
  env: Environment = process.env,
): Promise<boolean> {
  if (skipsAppCheck(env)) return true;
  const token = request.header("X-Firebase-AppCheck");
  if (!token) {
    response.status(401).json({ error: "Missing App Check token", code: APP_UNVERIFIED });
    return false;
  }
  try {
    await verify(token);
    return true;
  } catch {
    response.status(401).json({ error: "Invalid App Check token", code: APP_UNVERIFIED });
    return false;
  }
}
