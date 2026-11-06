import { randomBytes, randomInt } from "node:crypto";
import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import { onRequest } from "firebase-functions/v2/https";
import type { Response } from "express";
import { requireAppCheck } from "./appCheck";
import { bannedAnswer, isBanned, readBan, type Ban } from "./bans";
import { optionalAccount, requireAccount, requireUser, type Identity } from "./auth";
import { getStorage } from "firebase-admin/storage";
import {
  listPage,
  listShareImage,
  rankingPage,
  rankingShareImage,
  shellPage,
  standingOf,
  unavailablePage,
  withdrawnByModeration,
} from "./pages";
import { sendPicture, storagePictures, type PictureDeps } from "./pictures";
import { discardOlderCopies } from "./shareImage";
import {
  APP_CHECK_TOKEN_KEPT_MS,
  appCheckKeyOf,
  ceilingFor,
  claimHashOf,
  dayKey,
  decideClaim,
  decideClaimToken,
  decideEdit,
  decideEditor,
  decideOwner,
  decideRows,
  decideTierLabels,
  decideVersion,
  fromStoredRows,
  GUEST_RANKINGS_PER_APP_CHECK_TOKEN,
  isCode,
  isKeptBy,
  listAuthorOf,
  makeCode,
  MAX_BODY_BYTES,
  MY_RANKINGS_CAP,
  newestFirst,
  shownSnapshot,
  snapshotOf,
  summaryOf,
  tooSoon,
  toStoredRows,
  withTierLabels,
  type Snapshot,
  type StoredRow,
} from "./ranking";

const RANKINGS = "rankings";
const QUOTA = "rankQuota";
const USAGE = "rankUsage";
/** Guest rankings per App Check token, under the token's hash. */
const TOKEN_USE = "rankTokens";
const PUBLISHED = "publishedLists";

const CODE_ATTEMPTS = 3;

interface RankingDocument {
  listId: string;
  snapshot: Snapshot;
  rows: StoredRow[];
  ownerUid: string | null;
  ownerAnonymous: boolean;
  claimHash: string;
  /** The author the snapshot names, until their account is erased; absent when it names nobody. */
  listAuthorUid?: string;
  createdAt?: FirebaseFirestore.Timestamp;
  claimedAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

const notFound = (response: Response, error: string): void =>
  void response.status(404).json({ error, code: "NOT_FOUND" });

const methodNotAllowed = (response: Response): void =>
  void response
    .status(405)
    .json({ error: "Use GET, POST, PATCH, PUT or DELETE", code: "METHOD_NOT_ALLOWED" });

/** What a request needs from outside: the database and the two token checks. Tests hand in fakes. */
export interface WebDeps {
  db: () => Firestore;
  appCheck: (request: Request, response: Response) => Promise<boolean>;
  user: (request: Request, response: Response) => Promise<Identity | null>;
  account: (request: Request, response: Response) => Promise<Identity | null>;
  viewer: (request: Request) => Promise<Identity | null>;
  /** An integer in [0, max): where a new ranking's code comes from. */
  random: (max: number) => number;
  /** Takes a ranking's share pictures off the shelf once the ranking is gone. */
  forgetPictures: (code: string) => Promise<unknown>;
  /** Section and topic pictures from the bucket, shrunk; the bucket's own when left out. */
  pictures?: PictureDeps;
}

const bucketPictures = storagePictures(() => getStorage().bucket());

const production: WebDeps = {
  db: () => getFirestore(),
  appCheck: requireAppCheck,
  user: requireUser,
  account: requireAccount,
  viewer: optionalAccount,
  random: (max) => randomInt(max),
  forgetPictures: (code) => discardOlderCopies(getStorage().bucket(), "r", code, ""),
  pictures: bucketPictures,
};

export const web = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    // Drawing a share card holds the fonts, the layout engine and a few posters at once.
    memory: "512MiB",
    // One kept warm: a cold start made the first Finish after a quiet hour
    // wait seconds, or fail with "no available instance". Danylo chose the
    // few dollars a month over that (30.10.2026).
    minInstances: 1,
    maxInstances: 10,
  },
  (request, response) => route(request, response),
);

export async function route(
  request: Request,
  response: Response,
  deps: WebDeps = production,
): Promise<void> {
  const segments = request.path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => part.length > 0);

  // Link checkers and some chats ask with HEAD before they ask with GET.
  const reading = request.method === "GET" || request.method === "HEAD";
  // A page somebody follows a link to, not the API.
  const page = segments[0] === "l" || segments[0] === "r";
  try {
    // The picture a chat shows for a page: /og/l/{id}.png and /og/r/{code}.png.
    if (reading && segments.length === 3 && segments[0] === "og") {
      const id = (segments[2] ?? "").replace(/\.png$/, "");
      // A house list's card in the language its page asked for (?hl=).
      const hl = (request.query as Record<string, unknown> | undefined)?.hl;
      if (segments[1] === "l") return await listShareImage(response, id, hl);
      if (segments[1] === "r") return await rankingShareImage(response, id, hl, deps.db);
      return notFound(response, "No such address");
    }
    // A section's or topic's picture at a page's width: /img/{width}/{kind}/{id}/{picture}.
    if (reading && segments[0] === "img") {
      return await sendPicture(response, segments.slice(1), deps.pictures ?? bucketPictures);
    }
    // Pages: /l/{id} and /r/{code} are the site's own shell with the words a
    // chat needs and the data the board needs.
    if (reading && segments.length === 2 && segments[0] === "l") {
      return await listPage(request, response, segments[1] ?? "");
    }
    if (reading && segments.length === 2 && segments[0] === "r") {
      return await rankingPage(request, response, segments[1] ?? "", deps.db);
    }
    // Hosting sends all of /l/** and /r/** here: any other address there is
    // the site's to call not found, on its own page.
    if (reading && page) return await shellPage(request, response);

    // The API: /api/rank, /api/rank/{code} (read, claim, edit, delete) and /api/me/rankings.
    const api = segments[0] === "api" ? segments.slice(1) : null;
    if (api === null || api.length > 2) return notFound(response, "No such address");
    const [resource, rest] = api;

    if (resource === "me") {
      if (rest !== "rankings") return notFound(response, "No such address");
      if (request.method !== "GET") return methodNotAllowed(response);
      if (!(await deps.appCheck(request, response))) return;
      const identity = await deps.account(request, response);
      if (!identity) return;
      return await listMyRankings(deps.db(), identity, response);
    }
    if (resource !== "rank") return notFound(response, "No such address");

    const code = rest;
    if (request.method === "GET" && code !== undefined) {
      if (!(await deps.appCheck(request, response))) return;
      return await readRanking(deps.db(), response, code, await deps.viewer(request));
    }
    if (request.method === "POST" && code === undefined) {
      if (!(await deps.appCheck(request, response))) return;
      const identity = await deps.user(request, response);
      if (!identity) return;
      const appCheckToken = request.header("X-Firebase-AppCheck") ?? null;
      return await saveRanking(
        deps.db(),
        request.body,
        identity,
        response,
        deps.random,
        appCheckToken,
      );
    }
    if (request.method === "PATCH" && code !== undefined) {
      if (!(await deps.appCheck(request, response))) return;
      const identity = await deps.account(request, response);
      if (!identity) return;
      return await claimRanking(deps.db(), request.body, identity, response, code);
    }
    if (request.method === "PUT" && code !== undefined) {
      if (!(await deps.appCheck(request, response))) return;
      // A guest may change the ranking they made; editRanking checks it is theirs.
      const identity = await deps.user(request, response);
      if (!identity) return;
      return await editRanking(deps.db(), request.body, identity, response, code);
    }
    if (request.method === "DELETE" && code !== undefined) {
      if (!(await deps.appCheck(request, response))) return;
      const identity = await deps.account(request, response);
      if (!identity) return;
      return await deleteRanking(deps.db(), identity, response, code, deps.forgetPictures);
    }
    methodNotAllowed(response);
  } catch (error) {
    console.error(`Request failed: ${request.method} ${request.path}`, error);
    if (reading && page) return unavailablePage(response);
    response.status(503).json({ error: "Unavailable", code: "UNAVAILABLE" });
  }
}

/** A guest is never banned, as at the proxy: a ban is on an account. */
const banOn = (db: Firestore, identity: Identity): Promise<Ban | null> =>
  identity.isAnonymous ? Promise.resolve(null) : readBan(db, identity.uid);

async function readRanking(
  db: Firestore,
  response: Response,
  code: string,
  viewer: Identity | null,
): Promise<void> {
  if (!isCode(code)) return notFound(response, "No such ranking");
  const doc = await db.collection(RANKINGS).doc(code).get();
  if (!doc.exists) return notFound(response, "No such ranking");
  const ranking = doc.data() as RankingDocument;
  // A ranking outlives a list its author took away; the page only needs to
  // know whether the list is still there to link back to.
  const list = await db.collection(PUBLISHED).doc(ranking.listId).get();
  const listAvailable = list.exists && list.get("underReview") !== true;
  // A list that stands without an author gives no name to its rankings either.
  const standing = list.exists
    ? { authorUid: list.get("authorUid") as unknown, anonymous: list.get("anonymous") as unknown }
    : null;
  // A ranking kept before its list's author was stored beside it learns them
  // on a read while the list stands, so that author's account deletion finds
  // it too. A failed write only waits for the next read.
  if (ranking.listAuthorUid === undefined && list.exists && ranking.snapshot.authorName !== "") {
    const author = listAuthorOf(list.data() ?? {});
    if (author !== null) {
      await db
        .collection(RANKINGS)
        .doc(code)
        .update({ listAuthorUid: author })
        .catch(() => undefined);
    }
  }

  // What moderation hid or took down is not read here either; the
  // ranking comes back if its list is left up.
  if (await withdrawnByModeration(db, ranking.listId, list)) {
    return notFound(response, "No such ranking");
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    code,
    listId: ranking.listId,
    listAvailable,
    snapshot: shownSnapshot(ranking.snapshot, standing),
    rows: fromStoredRows(ranking.rows),
    createdAt: ranking.createdAt?.toMillis() ?? 0,
    yours: isKeptBy(ranking, viewer?.uid ?? null),
  });
}

async function saveRanking(
  db: Firestore,
  body: unknown,
  identity: Identity,
  response: Response,
  random: (max: number) => number,
  appCheckToken: string | null,
): Promise<void> {
  if (JSON.stringify(body ?? null).length > MAX_BODY_BYTES) {
    return void response.status(413).json({ error: "Too large", code: "TOO_LARGE" });
  }
  const listId = (body as { listId?: unknown } | null)?.listId;
  const quota = db.collection(QUOTA).doc(identity.uid);
  // The list, the caller's last write and any ban on the caller are read
  // together: one round trip to the database before the answer can start.
  const [list, lastQuota, ban] =
    typeof listId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(listId)
      ? await Promise.all([
          db.collection(PUBLISHED).doc(listId).get(),
          quota.get(),
          banOn(db, identity),
        ])
      : [null, null, null];
  // As the app is refused by the proxy, and before it is told whether the
  // list is there: a banned account ranks nothing.
  if (isBanned(ban, Date.now())) return void response.status(403).json(bannedAnswer(ban));
  if (list === null || !list.exists || list.get("underReview") === true) {
    return notFound(response, "No such list");
  }
  const stale = decideVersion(
    body,
    (list.get("updatedAt") as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0,
  );
  if (stale !== null) {
    return void response.status(stale.status).json({ error: stale.error, code: stale.code });
  }
  const snapshot = snapshotOf(list.data() ?? {});
  const decision = decideRows(body, snapshot.tiers.length, snapshot.items.length);
  if (!decision.ok) {
    return void response
      .status(decision.status)
      .json({ error: decision.error, code: decision.code });
  }
  const words = decideTierLabels(body, snapshot.tiers.length);
  if (!words.ok) {
    return void response.status(words.status).json({ error: words.error, code: words.code });
  }

  const now = Date.now();
  const lastWrite = lastQuota?.get("lastWriteAt") as number | undefined;
  if (tooSoon(lastWrite ?? null, now)) {
    response.setHeader("Retry-After", "2");
    return void response.status(429).json({ error: "One at a time", code: "BUSY" });
  }

  // Counted before the write, like the backend's generation ceiling: the
  // number that bounds the bill when something nobody predicted happens.
  // Guests stop short of it, and each App Check token keeps only so many
  // guest rankings, so fresh guests cannot spend the day for everybody.
  const usage = db.collection(USAGE).doc(dayKey(now));
  const tokenUse =
    identity.isAnonymous && appCheckToken !== null
      ? db.collection(TOKEN_USE).doc(appCheckKeyOf(appCheckToken))
      : null;
  const verdict = await db.runTransaction(async (transaction) => {
    const [day, used] = await Promise.all([
      transaction.get(usage),
      tokenUse === null ? null : transaction.get(tokenUse),
    ]);
    const next = ((day.get("count") as number | undefined) ?? 0) + 1;
    if (next > ceilingFor(identity.isAnonymous)) return "ceiling";
    const uses = ((used?.get("count") as number | undefined) ?? 0) + 1;
    if (tokenUse !== null && uses > GUEST_RANKINGS_PER_APP_CHECK_TOKEN) return "token";
    transaction.set(usage, { count: next }, { merge: true });
    if (tokenUse !== null) {
      // expireAt is there for a Firestore TTL policy to clear the spent ones.
      transaction.set(tokenUse, {
        count: uses,
        expireAt: Timestamp.fromMillis(now + APP_CHECK_TOKEN_KEPT_MS),
      });
    }
    return "counted";
  });
  if (verdict === "ceiling") {
    response.setHeader("Retry-After", "3600");
    return void response.status(503).json({ error: "Daily limit reached", code: "DAILY_CEILING" });
  }
  if (verdict === "token") {
    // The browser's next token comes within the hour.
    response.setHeader("Retry-After", "3600");
    return void response.status(429).json({ error: "Too many rankings", code: "TOO_MANY" });
  }

  const claimToken = randomBytes(24).toString("base64url");
  const author = listAuthorOf(list.data() ?? {});
  const document: RankingDocument = {
    listId: decision.listId,
    snapshot: withTierLabels(snapshot, words.labels),
    rows: toStoredRows(decision.rows),
    ownerUid: identity.uid,
    ownerAnonymous: identity.isAnonymous,
    claimHash: claimHashOf(claimToken),
    // So the author's name can be taken out of it when their account goes.
    ...(author === null ? {} : { listAuthorUid: author }),
  };

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = makeCode(random);
    try {
      // The ranking and the caller's last write go in one commit: one round
      // trip, and never a ranking without its quota mark.
      const batch = db.batch();
      batch.create(db.collection(RANKINGS).doc(code), {
        ...document,
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(quota, { lastWriteAt: now }, { merge: true });
      await batch.commit();
      return void response.status(201).json({ code, claimToken });
    } catch (error) {
      if ((error as { code?: number }).code !== 6 /* ALREADY_EXISTS */) throw error;
    }
  }
  response.status(503).json({ error: "Could not find a free code", code: "UNAVAILABLE" });
}

async function claimRanking(
  db: Firestore,
  body: unknown,
  identity: Identity,
  response: Response,
  code: string,
): Promise<void> {
  if (!isCode(code)) return notFound(response, "No such ranking");
  const claimToken = decideClaimToken(body);
  if (claimToken === null) {
    return void response.status(400).json({ error: "Which ranking?", code: "INVALID" });
  }

  const ref = db.collection(RANKINGS).doc(code);
  // Decided and written in one transaction, so two accounts racing for the
  // same token cannot both be told the ranking is theirs.
  const decision = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    if (!doc.exists) return null;
    const verdict = decideClaim(doc.data() as RankingDocument, identity.uid, claimToken);
    if (verdict.ok && verdict.write) {
      transaction.update(ref, {
        ownerUid: identity.uid,
        ownerAnonymous: false,
        claimedAt: FieldValue.serverTimestamp(),
      });
    }
    return verdict;
  });
  if (decision === null) return notFound(response, "No such ranking");
  if (!decision.ok) {
    return void response
      .status(decision.status)
      .json({ error: decision.error, code: decision.code });
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ code });
}

async function editRanking(
  db: Firestore,
  body: unknown,
  identity: Identity,
  response: Response,
  code: string,
): Promise<void> {
  if (!isCode(code)) return notFound(response, "No such ranking");
  if (JSON.stringify(body ?? null).length > MAX_BODY_BYTES) {
    return void response.status(413).json({ error: "Too large", code: "TOO_LARGE" });
  }
  // A banned account changes no ranking either, as the proxy's PUT refuses a replacement.
  const ban = await banOn(db, identity);
  if (isBanned(ban, Date.now())) return void response.status(403).json(bannedAnswer(ban));
  const ref = db.collection(RANKINGS).doc(code);
  const decision = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    if (!doc.exists) return null;
    const ranking = doc.data() as RankingDocument;
    const owner = decideEditor(ranking, identity);
    if (!owner.ok) return owner;
    const edit = decideEdit(body, ranking.snapshot.tiers.length, ranking.snapshot.items.length);
    if (!edit.ok) return edit;
    // A Finish again from the list page may bring a reader's tier words; the /r/ page's Edit brings none.
    const words = decideTierLabels(body, ranking.snapshot.tiers.length);
    if (!words.ok) return words;
    const snapshot = withTierLabels(ranking.snapshot, words.labels);
    transaction.update(ref, {
      rows: toStoredRows(edit.rows),
      ...(snapshot === ranking.snapshot ? {} : { snapshot }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return edit;
  });
  if (decision === null) return notFound(response, "No such ranking");
  if (!decision.ok) {
    return void response
      .status(decision.status)
      .json({ error: decision.error, code: decision.code });
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ code });
}

/** Takes a ranking away for good. Only the account that keeps it may; its list is not touched. */
async function deleteRanking(
  db: Firestore,
  identity: Identity,
  response: Response,
  code: string,
  forgetPictures: WebDeps["forgetPictures"],
): Promise<void> {
  if (!isCode(code)) return notFound(response, "No such ranking");
  const ref = db.collection(RANKINGS).doc(code);
  const decision = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    if (!doc.exists) return null;
    const owner = decideOwner(doc.data() as RankingDocument, identity.uid);
    if (owner.ok) transaction.delete(ref);
    return owner;
  });
  if (decision === null) return notFound(response, "No such ranking");
  if (!decision.ok) {
    return void response
      .status(decision.status)
      .json({ error: decision.error, code: decision.code });
  }
  // The picture would go on being served from the shelf; a failure here
  // leaves a file nobody links to, not a ranking that came back.
  await forgetPictures(code).catch((error: unknown) =>
    console.warn(`Share pictures of ${code} not removed`, error),
  );
  response.setHeader("Cache-Control", "no-store");
  response.status(204).end();
}

async function listMyRankings(
  db: Firestore,
  identity: Identity,
  response: Response,
): Promise<void> {
  // No orderBy: a where and an orderBy on different fields need a composite
  // index, and this repository deploys no indexes; the sort happens here. So
  // every one of the person's rankings is read before the newest are kept: a
  // limit on the query would keep whichever came first by their random codes,
  // and the newest could be among those left out.
  const found = await db.collection(RANKINGS).where("ownerUid", "==", identity.uid).get();
  const when = (code: string, ranking: RankingDocument): number =>
    summaryOf(code, ranking, null).createdAt;
  const all = found.docs
    .map((doc) => ({ code: doc.id, ranking: doc.data() as RankingDocument }))
    .sort((a, b) => when(b.code, b.ranking) - when(a.code, a.ranking));
  const kept = all.slice(0, MY_RANKINGS_CAP);
  // Each list read once, and only what says whether it still names its
  // author: a list made anonymous, or gone, names nobody on these cards,
  // as it names nobody on the ranking's own page.
  const listIds = [...new Set(kept.map(({ ranking }) => ranking.listId))];
  const lists =
    listIds.length === 0
      ? []
      : await db.getAll(...listIds.map((id) => db.collection(PUBLISHED).doc(id)), {
          fieldMask: ["authorUid", "anonymous"],
        });
  const standing = new Map(lists.map((list) => [list.id, standingOf(list)]));
  const rankings = newestFirst(
    kept.map(({ code, ranking }) => summaryOf(code, ranking, standing.get(ranking.listId) ?? null)),
  );

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ rankings, more: all.length > MY_RANKINGS_CAP });
}
