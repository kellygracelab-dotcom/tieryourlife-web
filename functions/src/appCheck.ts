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
