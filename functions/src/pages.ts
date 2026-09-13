import { getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";
import { describeList, describeRanking, renderPage, type PageMeta } from "./og";
import { firstImageOf, fromStoredRows, isCode, placedCount, type StoredRanking } from "./ranking";

const PUBLISHED = "publishedLists";
const RANKINGS = "rankings";

/** The sites this function may be asked to render; anything else is a stranger. */
const HOSTS = new Set([
  "tieryourlife-web.web.app",
  "tieryourlife-web.firebaseapp.com",
  "tieryourlife.web.app",
  "tieryourlife.firebaseapp.com",
]);
const DEFAULT_HOST = "tieryourlife-web.web.app";

/**
 * A hosting-only deploy changes the asset names inside index.html; a minute
 * of staleness is the most a page may point at files that no longer exist.
 */
const SHELL_TTL_MS = 60_000;
const LIST_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface CachedShell {
  host: string;
  html: string;
  fetchedAt: number;
}

let shell: CachedShell | null = null;

export function hostOf(request: Request): string {
  const forwarded = request.header("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  return HOSTS.has(forwarded) ? forwarded : DEFAULT_HOST;
}

export async function loadShell(
  host: string,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (shell !== null && shell.host === host && now - shell.fetchedAt < SHELL_TTL_MS) {
    return shell.html;
  }
  const response = await fetchImpl(`https://${host}/index.html`, {
    headers: { Accept: "text/html" },
  });
  if (!response.ok) throw new Error(`index.html answered ${response.status}`);
  const html = await response.text();
  shell = { host, html, fetchedAt: now };
  return html;
}

export function resetShellForTests(): void {
  shell = null;
}

function send(response: Response, html: string): void {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short at the edge, never in the browser: a Finish must not read yesterday's list.
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=120");
  response.status(200).send(html);
}

interface StoredList {
  title?: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  category?: string;
  itemCount?: number;
  coverImageUrl?: string | null;
  previewImages?: string[];
  tierColors?: string[];
  updatedAt?: FirebaseFirestore.Timestamp;
  takeCount?: number;
  underReview?: boolean;
  tiers?: unknown[];
  items?: unknown[];
}

/** The same shape the proxy answers with, minus the author's uid. */
function listPayload(id: string, data: StoredList) {
  return {
    id,
    title: data.title ?? "",
    authorUid: "",
    authorName: data.authorName ?? "",
    authorPhotoUrl: data.authorPhotoUrl ?? null,
    category: data.category ?? "other",
    itemCount: data.itemCount ?? data.items?.length ?? 0,
    coverImageUrl: data.coverImageUrl ?? null,
    previewImages: data.previewImages ?? [],
    tierColors: data.tierColors ?? [],
    updatedAt: data.updatedAt?.toMillis() ?? 0,
    takeCount: data.takeCount ?? 0,
    tiers: data.tiers ?? [],
    items: data.items ?? [],
  };
}

export async function listPage(request: Request, response: Response, id: string): Promise<void> {
  const host = hostOf(request);
  const html = await loadShell(host, Date.now());
  const doc = LIST_ID.test(id) ? await getFirestore().collection(PUBLISHED).doc(id).get() : null;
  const data = doc?.exists ? (doc.data() as StoredList) : null;
  // A hidden or missing list gets the bare shell: the page will say so itself,
  // and a chat gets nothing to unfurl.
  if (data === null || data.underReview === true) return send(response, html);

  const list = listPayload(id, data);
  const meta: PageMeta = {
    title: list.title,
    description: describeList(list),
    image: list.coverImageUrl ?? list.previewImages[0] ?? null,
    url: `https://${host}/l/${id}`,
  };
  send(response, renderPage(html, meta, { kind: "list", list }));
}

export async function rankingPage(
  request: Request,
  response: Response,
  code: string,
): Promise<void> {
  const host = hostOf(request);
  const html = await loadShell(host, Date.now());
  const db = getFirestore();
  const doc = isCode(code) ? await db.collection(RANKINGS).doc(code).get() : null;
  if (doc === null || !doc.exists) return send(response, html);

  const stored = doc.data() as StoredRanking;
  const list = await db.collection(PUBLISHED).doc(stored.listId).get();
  const rows = fromStoredRows(stored.rows);
  const ranking = {
    code,
    listId: stored.listId,
    listAvailable: list.exists && list.get("underReview") !== true,
    snapshot: stored.snapshot,
    rows,
    createdAt: stored.createdAt?.toMillis() ?? 0,
  };
  const meta: PageMeta = {
    title: stored.snapshot.title,
    description: describeRanking({
      placed: placedCount(rows),
      itemCount: stored.snapshot.items.length,
      authorName: stored.snapshot.authorName,
      category: stored.snapshot.category,
    }),
    image: firstImageOf(stored.snapshot.items),
    url: `https://${host}/r/${code}`,
  };
  send(response, renderPage(html, meta, { kind: "ranking", ranking }));
}
