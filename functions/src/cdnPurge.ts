import { applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { region } from "firebase-functions/v1";
import { smallCopyPath, storedCopies, type SmallCopies } from "./pictures";
import { CARD_WIDTHS } from "./publicMedia";

/*
 * A published list's pictures kept on Hosting's CDN for a day instead of a
 * minute (Designer, Coordinator, 28.11.2026: a list of 127 cards opened a
 * minute after anyone else took half a second to six seconds a picture,
 * from the CDN a twentieth). The promise stays: a picture taken down by
 * moderation stops reaching anyone new within a minute.
 *
 * Hosting cannot purge one path, and releasing the same version again
 * purges nothing (tried on a preview channel, 28.11). A release whose
 * serving config differs purges everything, the functions' answers
 * included, at once (17-19 s from the start of a CLI deploy). So a takedown
 * releases a copy of the live version, the same files, with one header
 * changed (/__cdn-purge). Takedowns that come together share one.
 *
 * Kept long only while that works: until the first purge has gone through,
 * after one fails or is refused, or with `keep: false` written in
 * config/webCdn (the switch), a published picture is kept the minute it was
 * before.
 */

export const CDN_DOC = "config/webCdn";
const SITE = "tieryourlife";
const HOSTING_API = "https://firebasehosting.googleapis.com/v1beta1";
/** The one header a purge changes. */
export const PURGE_MARK = "/__cdn-purge";
/** How long a runner holds the purge before another may take it over. */
export const LEASE_MS = 120_000;
/** Clocks of Storage's events and of this function may differ a little. */
export const SKEW_MS = 2_000;
const MAX_ROUNDS = 10;
/**
 * A failed purge is tried again here, after these pauses: Firebase deploys a
 * function that the platform retries only with --force, which is Danylo's.
 */
export const RETRY_AFTER_MS: readonly number[] = [5_000, 15_000];

/** What config/webCdn holds; people write only `keep`. */
export interface CdnState {
  /** The latest deletion that may still be on the CDN. */
  wantedAt: number;
  /** When the latest purge started. */
  startedAt: number;
  /** When the latest purge that went through started (equal to startedAt once it has). */
  doneFor: number;
  leaseUntil: number;
  /** A purge has gone through: the permissions and the API are there. */
  canPurge: boolean;
  failingSince: number | null;
  /** The switch: false keeps published pictures a minute again. */
  keep: boolean;
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function readCdnState(data: unknown): CdnState {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    wantedAt: num(d.wantedAt),
    startedAt: num(d.startedAt),
    doneFor: num(d.doneFor),
    leaseUntil: num(d.leaseUntil),
    canPurge: d.canPurge === true,
    failingSince: typeof d.failingSince === "number" ? d.failingSince : null,
    keep: d.keep !== false,
  };
}

export type Claim = "covered" | "queued" | "run";

/**
 * A deletion at `deletedAt`: already covered by a purge that started after
 * it (gone through, or still going), left to the purge running now, or this
 * event runs the purges itself.
 */
export function claim(state: CdnState, deletedAt: number, now: number): [CdnState, Claim] {
  const after = state.startedAt > deletedAt + SKEW_MS;
  if (after && (state.doneFor === state.startedAt || state.leaseUntil > now)) {
    return [state, "covered"];
  }
  const wanted = { ...state, wantedAt: Math.max(state.wantedAt, deletedAt) };
  if (state.leaseUntil > now) return [wanted, "queued"];
  return [{ ...wanted, leaseUntil: now + LEASE_MS }, "run"];
}

export type Step = { run: true; startedAt: number } | { run: false; waitMs: number };

/**
 * The runner's next step: start a purge when a deletion is not covered yet
 * (once the clocks' margin has passed), or let the lease go.
 */
export function next(state: CdnState, now: number): [CdnState, Step] {
  if (state.wantedAt + SKEW_MS < state.startedAt) {
    return [
      { ...state, leaseUntil: 0 },
      { run: false, waitMs: 0 },
    ];
  }
  const ready = state.wantedAt + SKEW_MS + 1;
  if (now < ready) {
    return [
      { ...state, leaseUntil: now + LEASE_MS },
      { run: false, waitMs: ready - now },
    ];
  }
  return [
    { ...state, startedAt: now, leaseUntil: now + LEASE_MS },
    { run: true, startedAt: now },
  ];
}

/** A purge that started at `startedAt` went through, or did not: then it is wanted again. */
export function done(state: CdnState, startedAt: number, ok: boolean, now: number): CdnState {
  if (ok) {
    return state.startedAt === startedAt
      ? { ...state, doneFor: startedAt, canPurge: true, failingSince: null }
      : state;
  }
  return {
    ...state,
    wantedAt: Math.max(state.wantedAt, startedAt),
    failingSince: state.failingSince ?? now,
    leaseUntil: 0,
  };
}

/** config/webCdn's three steps, each in a transaction. */
export interface CdnStore {
  claim(deletedAt: number): Promise<Claim>;
  next(): Promise<Step>;
  done(startedAt: number, ok: boolean): Promise<void>;
}

export function firestoreCdnStore(db: Firestore, now: () => number = Date.now): CdnStore {
  const ref = db.doc(CDN_DOC);
  const step = <T>(change: (state: CdnState, at: number) => [CdnState, T]): Promise<T> =>
    db.runTransaction(async (transaction) => {
      const state = readCdnState((await transaction.get(ref)).data());
      const [after, result] = change(state, now());
      const { keep: _keep, ...machine } = after;
      transaction.set(ref, machine, { merge: true });
      return result;
    });
  return {
    claim: (deletedAt) => step((state, at) => claim(state, deletedAt, at)),
    next: () => step(next),
    done: (startedAt, ok) => step((state, at) => [done(state, startedAt, ok, at), undefined]),
  };
}

// ---- Hosting's REST API -------------------------------------------------

export type HostingCall = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export class HostingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface VersionOf {
  name: string;
  config?: { headers?: { glob?: string; regex?: string; headers?: Record<string, string> }[] };
}
interface Channel {
  release?: { version?: VersionOf };
}

/** The serving config with the purge header changed, nothing else. */
export function markedConfig(config: VersionOf["config"], now: number): VersionOf["config"] {
  const headers = (config?.headers ?? []).filter((one) => one.glob !== PURGE_MARK);
  return {
    ...config,
    headers: [...headers, { glob: PURGE_MARK, headers: { "X-Cdn-Purge": String(now) } }],
  };
}

async function liveVersion(call: HostingCall): Promise<VersionOf> {
  const channel = await call<Channel>("GET", `/sites/${SITE}/channels/live`);
  const version = channel.release?.version;
  if (version?.name === undefined) throw new Error("Hosting has no live release");
  return version.config === undefined ? call<VersionOf>("GET", `/${version.name}`) : version;
}

async function filesOf(call: HostingCall, version: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let token = "";
  do {
    const page = await call<{
      files?: { path: string; hash: string }[];
      nextPageToken?: string;
    }>("GET", `/${version}/files?pageSize=1000${token ? `&pageToken=${token}` : ""}`);
    for (const file of page.files ?? []) files[file.path] = file.hash;
    token = page.nextPageToken ?? "";
  } while (token !== "");
  return files;
}

/**
 * A copy of `base` with the purge header changed, released while `live` is
 * still what is live; its name, or "" when something else went live first.
 */
async function releaseMarked(
  call: HostingCall,
  base: VersionOf,
  live: string,
  now: number,
): Promise<string> {
  const files = await filesOf(call, base.name);
  const made = await call<{ name: string }>("POST", `/sites/${SITE}/versions`, {
    config: markedConfig(base.config, now),
  });
  const paths = Object.keys(files);
  for (let at = 0; at < paths.length; at += 1000) {
    const chunk = Object.fromEntries(paths.slice(at, at + 1000).map((path) => [path, files[path]]));
    const populated = await call<{ uploadRequiredHashes?: string[] }>(
      "POST",
      `/${made.name}:populateFiles`,
      { files: chunk },
    );
    if ((populated.uploadRequiredHashes ?? []).length > 0) {
      throw new Error(
        `Hosting lost ${populated.uploadRequiredHashes?.length} files of ${base.name}`,
      );
    }
  }
  await call("PATCH", `/${made.name}?update_mask=status`, { status: "FINALIZED" });
  // A deploy that came meanwhile is not taken back: purge on top of it instead.
  if ((await liveVersion(call)).name !== live) return "";
  await call("POST", `/sites/${SITE}/releases?versionName=${encodeURIComponent(made.name)}`, {
    message: "CDN purge: published pictures deleted",
  });
  return made.name;
}

export interface Purged {
  version: string;
  rounds: number;
}

/**
 * Purges Hosting's CDN by releasing the live version again with the purge
 * header changed. A deploy that lands meanwhile is never rolled back: before
 * the release a newer live version starts it over, and after it one that
 * came in between is purged on top of again.
 */
export async function purgeCdn(call: HostingCall, now: () => number): Promise<Purged> {
  // What to copy, and what must still be live when the copy goes out.
  let base = await liveVersion(call);
  let live = base.name;
  for (let round = 1; round <= 3; round++) {
    const made = await releaseMarked(call, base, live, now());
    if (made === "") {
      base = await liveVersion(call);
      live = base.name;
      continue;
    }
    const { releases = [] } = await call<{ releases?: { version?: VersionOf }[] }>(
      "GET",
      `/sites/${SITE}/channels/live/releases?pageSize=2`,
    );
    const before = releases[1]?.version;
    if (releases[0]?.version?.name === made && before?.name === live) {
      return { version: made, rounds: round };
    }
    if (releases[0]?.version?.name === made && before?.name !== undefined) {
      // Somebody released between the check and ours: theirs again, purged, on top of ours.
      base = await versionWithConfig(call, before);
      live = made;
    } else {
      base = await liveVersion(call);
      live = base.name;
    }
  }
  throw new Error("Hosting kept changing under the purge");
}

const versionWithConfig = (call: HostingCall, version: VersionOf): Promise<VersionOf> =>
  version.config === undefined
    ? call<VersionOf>("GET", `/${version.name}`)
    : Promise.resolve(version);

let token: { value: string; until: number } | null = null;

/** Hosting's API as this function's own service account. */
export const hostingApi: HostingCall = async <T>(method: string, path: string, body?: unknown) => {
  if (token === null || token.until < Date.now() + 60_000) {
    const fresh = await applicationDefault().getAccessToken();
    token = { value: fresh.access_token, until: Date.now() + fresh.expires_in * 1000 };
  }
  const answer = await fetch(`${HOSTING_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await answer.text();
  if (!answer.ok) {
    throw new HostingError(
      answer.status,
      `Hosting ${method} ${path}: ${answer.status} ${text.slice(0, 300)}`,
    );
  }
  return (text === "" ? {} : JSON.parse(text)) as T;
};

// ---- A takedown's request ------------------------------------------------

/**
 * Where the shared Proxy asks for a purge (Backend, 28.11.2026): one
 * document per takedown, written after its files are deleted:
 * `{at: serverTimestamp, listId, reason: "takedown", paths: [deleted files]}`.
 * Only a takedown must be gone within a minute; a list withdrawn, an account
 * erased or a copy no list names any more may stay on the CDN its day.
 */
export const PURGE_REQUESTS = "webCdnPurges";

export interface PurgeDeps {
  store: CdnStore;
  call: HostingCall;
  copies: Pick<SmallCopies, "remove">;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (entry: Record<string, unknown>) => void;
}

/** The cards' copies of the deleted files (pictures.ts): a takedown's copies in other lists' folders too. */
export function copiesOf(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return paths.flatMap((path) =>
    typeof path === "string" && path.startsWith("published/") && path.split("/").length === 3
      ? CARD_WIDTHS.map((width) => smallCopyPath(path, width))
      : [],
  );
}

/**
 * A takedown at `deletedAt`: its cards' copies go, and it is covered by a
 * purge that starts after it. The first request to find none running runs
 * them, one after another, while requests keep coming; the rest leave theirs
 * to it. A purge that fails is tried again twice, a few seconds apart, then
 * marked failing (pictures kept a minute) and thrown; one that Hosting
 * refuses (no permission) is not tried again.
 */
export async function onPurgeRequest(
  deletedAt: number,
  paths: unknown,
  deps: PurgeDeps,
): Promise<Claim | "refused"> {
  await Promise.all(copiesOf(paths).map((copy) => deps.copies.remove(copy)));
  const claimed = await deps.store.claim(deletedAt);
  if (claimed !== "run") return claimed;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const step = await deps.store.next();
    if (!step.run) {
      if (step.waitMs === 0) break;
      await deps.sleep(step.waitMs);
      continue;
    }
    try {
      const purged = await purgeWithRetries(deps);
      await deps.store.done(step.startedAt, true);
      deps.log({
        message: "CDN purge",
        deletedAt: new Date(deletedAt).toISOString(),
        waitedMs: step.startedAt - deletedAt,
        tookMs: deps.now() - step.startedAt,
        sinceDeletionMs: deps.now() - deletedAt,
        version: purged.version,
        rounds: purged.rounds,
      });
    } catch (error) {
      await deps.store.done(step.startedAt, false);
      if (error instanceof HostingError && (error.status === 401 || error.status === 403)) {
        deps.log({ message: "CDN purge refused", status: error.status, detail: error.message });
        return "refused";
      }
      throw error;
    }
  }
  return "run";
}

async function purgeWithRetries(deps: PurgeDeps): Promise<Purged> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await purgeCdn(deps.call, deps.now);
    } catch (error) {
      const refused =
        error instanceof HostingError && (error.status === 401 || error.status === 403);
      const pause = RETRY_AFTER_MS[attempt];
      if (refused || pause === undefined) throw error;
      deps.log({
        message: "CDN purge failed, trying again",
        attempt: attempt + 1,
        detail: String(error),
      });
      await deps.sleep(pause);
    }
  }
}

const readAt = (value: unknown, fallback: number): number => {
  const millis = (value as { toMillis?: () => number } | null)?.toMillis?.();
  return typeof millis === "number" && Number.isFinite(millis) ? millis : fallback;
};

export const cdnPurge = region("europe-west1")
  .runWith({ timeoutSeconds: 300 })
  .firestore.document(`${PURGE_REQUESTS}/{id}`)
  .onCreate(async (snapshot) => {
    // The emulators have no Hosting to purge.
    if (process.env.FUNCTIONS_EMULATOR === "true") return;
    const deletedAt = readAt(snapshot.get("at"), readAt(snapshot.createTime, Date.now()));
    await onPurgeRequest(deletedAt, snapshot.get("paths"), {
      store: firestoreCdnStore(getFirestore()),
      call: hostingApi,
      copies: storedCopies(() => getStorage().bucket()),
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  });

// ---- What the pictures' answers read --------------------------------------

const KEEP_READ_MS = 30_000;
let kept: { value: boolean; at: number } | null = null;

/** Whether a published picture may be kept long on the CDN now. */
export function cdnKeeps(state: CdnState): boolean {
  return state.canPurge && state.failingSince === null && state.keep;
}

export async function publishedKept(
  db: () => Firestore,
  now: number = Date.now(),
): Promise<boolean> {
  if (kept !== null && now - kept.at < KEEP_READ_MS) return kept.value;
  let value = false;
  try {
    value = cdnKeeps(readCdnState((await db().doc(CDN_DOC).get()).data()));
  } catch {
    value = false;
  }
  kept = { value, at: now };
  return value;
}

export function forgetKeptForTests(): void {
  kept = null;
  token = null;
}
