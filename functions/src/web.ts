import { randomBytes, randomInt } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import type { Response } from "express";
import { requireAppCheck } from "./appCheck";
import { requireAccount, requireUser, type Identity } from "./auth";
import { listPage, rankingPage } from "./pages";
import {
  claimHashOf,
  DAILY_CEILING,
  dayKey,
  decideClaim,
  decideClaimToken,
  decideRows,
  fromStoredRows,
  isCode,
  makeCode,
  MAX_BODY_BYTES,
  MY_RANKINGS_CAP,
  newestFirst,
  snapshotOf,
  summaryOf,
  tooSoon,
  toStoredRows,
  type Snapshot,
  type StoredRow,
} from "./ranking";

const RANKINGS = "rankings";
const QUOTA = "rankQuota";
const USAGE = "rankUsage";
const PUBLISHED = "publishedLists";

const CODE_ATTEMPTS = 3;

interface RankingDocument {
  listId: string;
  snapshot: Snapshot;
  rows: StoredRow[];
  ownerUid: string | null;
  ownerAnonymous: boolean;
  claimHash: string;
  createdAt?: FirebaseFirestore.Timestamp;
  claimedAt?: FirebaseFirestore.Timestamp;
}

const notFound = (response: Response, error: string): void =>
  void response.status(404).json({ error, code: "NOT_FOUND" });

const methodNotAllowed = (response: Response): void =>
  void response.status(405).json({ error: "Use GET, POST or PATCH", code: "METHOD_NOT_ALLOWED" });

export const web = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    maxInstances: 10,
  },
  async (request, response) => {
    const segments = request.path
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((part) => part.length > 0);

    try {
      // Pages: /l/{id} and /r/{code} are the site's own shell with the words a
      // chat needs and the data the board needs.
      if (request.method === "GET" && segments.length === 2 && segments[0] === "l") {
        return await listPage(request, response, segments[1] ?? "");
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "r") {
        return await rankingPage(request, response, segments[1] ?? "");
      }

      // The API: /api/rank, /api/rank/{code} and /api/me/rankings.
      const api = segments[0] === "api" ? segments.slice(1) : null;
      if (api === null || api.length > 2) return notFound(response, "No such address");
      const [resource, rest] = api;

      if (resource === "me") {
        if (rest !== "rankings") return notFound(response, "No such address");
        if (request.method !== "GET") return methodNotAllowed(response);
        if (!(await requireAppCheck(request, response))) return;
        const identity = await requireAccount(request, response);
        if (!identity) return;
        return await listMyRankings(identity, response);
      }
      if (resource !== "rank") return notFound(response, "No such address");

      const code = rest;
      if (request.method === "GET" && code !== undefined) {
        if (!(await requireAppCheck(request, response))) return;
        return await readRanking(response, code);
      }
      if (request.method === "POST" && code === undefined) {
        if (!(await requireAppCheck(request, response))) return;
        const identity = await requireUser(request, response);
        if (!identity) return;
        return await saveRanking(request.body, identity, response);
      }
      if (request.method === "PATCH" && code !== undefined) {
        if (!(await requireAppCheck(request, response))) return;
        const identity = await requireAccount(request, response);
        if (!identity) return;
        return await claimRanking(request.body, identity, response, code);
      }
      methodNotAllowed(response);
    } catch (error) {
      console.error("Ranking request failed", error);
      response.status(503).json({ error: "Unavailable", code: "UNAVAILABLE" });
    }
  },
);

async function readRanking(response: Response, code: string): Promise<void> {
  if (!isCode(code)) return notFound(response, "No such ranking");
  const db = getFirestore();
  const doc = await db.collection(RANKINGS).doc(code).get();
  if (!doc.exists) return notFound(response, "No such ranking");
  const ranking = doc.data() as RankingDocument;
  // A ranking outlives its list; the page only needs to know whether the
  // list is still there to link back to.
  const list = await db.collection(PUBLISHED).doc(ranking.listId).get();
  const listAvailable = list.exists && list.get("underReview") !== true;

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    code,
    listId: ranking.listId,
    listAvailable,
    snapshot: ranking.snapshot,
    rows: fromStoredRows(ranking.rows),
    createdAt: ranking.createdAt?.toMillis() ?? 0,
  });
}

async function saveRanking(body: unknown, identity: Identity, response: Response): Promise<void> {
  if (JSON.stringify(body ?? null).length > MAX_BODY_BYTES) {
    return void response.status(413).json({ error: "Too large", code: "TOO_LARGE" });
  }
  const db = getFirestore();
  const listId = (body as { listId?: unknown } | null)?.listId;
  const list =
    typeof listId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(listId)
      ? await db.collection(PUBLISHED).doc(listId).get()
      : null;
  if (list === null || !list.exists || list.get("underReview") === true) {
    return notFound(response, "No such list");
  }
  const snapshot = snapshotOf(list.data() ?? {});
  const decision = decideRows(body, snapshot.tiers.length, snapshot.items.length);
  if (!decision.ok) {
    return void response
      .status(decision.status)
      .json({ error: decision.error, code: decision.code });
  }

  const now = Date.now();
  const quota = db.collection(QUOTA).doc(identity.uid);
  const lastWrite = (await quota.get()).get("lastWriteAt") as number | undefined;
  if (tooSoon(lastWrite ?? null, now)) {
    response.setHeader("Retry-After", "2");
    return void response.status(429).json({ error: "One at a time", code: "BUSY" });
  }

  // Counted before the write, like the backend's generation ceiling: the
  // number that bounds the bill when something nobody predicted happens.
  const usage = db.collection(USAGE).doc(dayKey(now));
  const count = await db.runTransaction(async (transaction) => {
    const today = (await transaction.get(usage)).get("count") as number | undefined;
    const next = (today ?? 0) + 1;
    if (next > DAILY_CEILING) return null;
    transaction.set(usage, { count: next }, { merge: true });
    return next;
  });
  if (count === null) {
    response.setHeader("Retry-After", "3600");
    return void response.status(503).json({ error: "Daily limit reached", code: "DAILY_CEILING" });
  }

  const claimToken = randomBytes(24).toString("base64url");
  const document: RankingDocument = {
    listId: decision.listId,
    snapshot,
    rows: toStoredRows(decision.rows),
    ownerUid: identity.uid,
    ownerAnonymous: identity.isAnonymous,
    claimHash: claimHashOf(claimToken),
  };

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = makeCode((max) => randomInt(max));
    try {
      await db
        .collection(RANKINGS)
        .doc(code)
        .create({ ...document, createdAt: FieldValue.serverTimestamp() });
      await quota.set({ lastWriteAt: now }, { merge: true });
      return void response.status(201).json({ code, claimToken });
    } catch (error) {
      if ((error as { code?: number }).code !== 6 /* ALREADY_EXISTS */) throw error;
    }
  }
  response.status(503).json({ error: "Could not find a free code", code: "UNAVAILABLE" });
}

async function claimRanking(
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

  const db = getFirestore();
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

async function listMyRankings(identity: Identity, response: Response): Promise<void> {
  // No orderBy: a where and an orderBy on different fields need a composite
  // index, and this repository deploys no indexes; the sort happens here.
  const found = await getFirestore()
    .collection(RANKINGS)
    .where("ownerUid", "==", identity.uid)
    .limit(MY_RANKINGS_CAP)
    .get();
  const rankings = newestFirst(
    found.docs.map((doc) => summaryOf(doc.id, doc.data() as RankingDocument)),
  );

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ rankings, more: found.size === MY_RANKINGS_CAP });
}
