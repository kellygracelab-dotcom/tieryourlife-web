import { getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";
import { describeList, describeRanking, renderPage, type PageMeta } from "./og";
import { fromStoredRows, isCode, placedCount, type StoredRanking } from "./ranking";
import {
  SHARE_HEIGHT,
  SHARE_WIDTH,
  shareImageUrl,
  type ShareCard,
  type ShareItem,
  type ShareTier,
} from "./share";
import { sendShareImage, shareImageFor } from "./shareImage";

const PUBLISHED = "publishedLists";
const RANKINGS = "rankings";

/** The sites this function may be asked to render; anything else is a stranger. */
const HOSTS = new Set([
  "tieryourlife.web.app",
  "tieryourlife.firebaseapp.com",
  "tieryourlife-web.web.app",
  "tieryourlife-web.firebaseapp.com",
]);
const DEFAULT_HOST = "tieryourlife.web.app";

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
  authorUid?: string;
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

/**
 * The same shape the proxy answers with. The author's uid is as public there
 * as it is here, and the page needs it: it is the address of the author's
 * page, and how an author is told from a visitor. An empty one broke both on
 * every list opened by its link.
 */
export function listPayload(id: string, data: StoredList) {
  return {
    id,
    title: data.title ?? "",
    authorUid: typeof data.authorUid === "string" ? data.authorUid : "",
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
    image: shareImageUrl(host, "l", id, list.updatedAt),
    imageSize: { width: SHARE_WIDTH, height: SHARE_HEIGHT },
    url: `https://${host}/l/${id}`,
  };
  send(response, renderPage(html, meta, { kind: "list", list }));
}

const SHARE_SIZE = { width: SHARE_WIDTH, height: SHARE_HEIGHT };

/** Whatever the stored tiers and items look like, the card gets what it can draw. */
function shareTiersOf(raw: unknown[] | undefined): ShareTier[] {
  return (raw ?? []).map((tier) => {
    const t = (tier ?? {}) as { label?: unknown; caption?: unknown; colorLight?: unknown };
    return {
      label: typeof t.label === "string" ? t.label : "",
      caption: typeof t.caption === "string" ? t.caption : null,
      colorLight: typeof t.colorLight === "string" ? t.colorLight : "#5d5c66",
    };
  });
}

function shareItemsOf(raw: unknown[] | undefined): ShareItem[] {
  return (raw ?? []).map((item) => {
    const i = (item ?? {}) as { title?: unknown; imageUrl?: unknown };
    return {
      title: typeof i.title === "string" ? i.title : "",
      imageUrl:
        typeof i.imageUrl === "string" && i.imageUrl.startsWith("https://") ? i.imageUrl : null,
    };
  });
}

/** The version a card is drawn for: the list's last change, or nothing yet. */
const listVersion = (data: StoredList): number => data.updatedAt?.toMillis() ?? 0;

export async function listShareImage(response: Response, id: string): Promise<void> {
  const doc = LIST_ID.test(id) ? await getFirestore().collection(PUBLISHED).doc(id).get() : null;
  const data = doc?.exists ? (doc.data() as StoredList) : null;
  if (data === null || data.underReview === true) return sendShareImage(response, null);
  const card: ShareCard = {
    kind: "list",
    title: data.title ?? "",
    authorName: data.authorName ?? "",
    category: data.category ?? "other",
    itemCount: data.itemCount ?? data.items?.length ?? 0,
    takeCount: data.takeCount ?? 0,
    tiers: shareTiersOf(data.tiers),
    items: shareItemsOf(data.items),
  };
  sendShareImage(response, await shareImageFor("l", id, listVersion(data), async () => card));
}

/** A ranking changes only when its owner edits it. */
const rankingVersion = (stored: StoredRanking): number =>
  stored.updatedAt?.toMillis() ?? stored.createdAt?.toMillis() ?? 0;

export async function rankingShareImage(response: Response, code: string): Promise<void> {
  const doc = isCode(code) ? await getFirestore().collection(RANKINGS).doc(code).get() : null;
  if (doc === null || !doc.exists) return sendShareImage(response, null);
  const stored = doc.data() as StoredRanking;
  const card: ShareCard = {
    kind: "ranking",
    title: stored.snapshot.title,
    authorName: stored.snapshot.authorName,
    category: stored.snapshot.category,
    tiers: shareTiersOf(stored.snapshot.tiers),
    items: shareItemsOf(stored.snapshot.items),
    rows: fromStoredRows(stored.rows),
  };
  sendShareImage(
    response,
    await shareImageFor("r", code, rankingVersion(stored), async () => card),
  );
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
    image: shareImageUrl(host, "r", code, rankingVersion(stored)),
    imageSize: SHARE_SIZE,
    url: `https://${host}/r/${code}`,
  };
  send(response, renderPage(html, meta, { kind: "ranking", ranking }));
}
