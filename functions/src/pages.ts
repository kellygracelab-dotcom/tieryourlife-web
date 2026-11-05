import { getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";
import { isEditorialList } from "./editorial";
import {
  describeList,
  describeRanking,
  renderPage,
  sectionLabelOf,
  type PageMeta,
  type SectionNames,
} from "./og";
import { AS_WRITTEN, offeredLocales, previewLocale, translatorFor, wordsFor } from "./previewWords";
import {
  fromStoredRows,
  isCode,
  placedCount,
  shownSnapshot,
  type Snapshot,
  type StoredRanking,
} from "./ranking";
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
const HOSTS = new Set(["tieryourlife.web.app", "tieryourlife.firebaseapp.com"]);
const DEFAULT_HOST = "tieryourlife.web.app";

/** A hosting answer slower than this would hold the page toward the function's own timeout. */
export const SHELL_TIMEOUT_MS = 5_000;
const LIST_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface CachedShell {
  host: string;
  html: string;
  etag: string | null;
}

let shell: CachedShell | null = null;

export function hostOf(request: Request): string {
  const forwarded = request.header("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  return HOSTS.has(forwarded) ? forwarded : DEFAULT_HOST;
}

/**
 * The site's index.html, asked after on every page. A deploy renames the
 * script inside it, and a shell kept for a minute named a script that was
 * gone: the page stayed white, and the edge kept it that way for two more
 * minutes. Hosting answers "not modified" to the tag it gave, so asking is
 * a short round trip, not the whole file. When hosting cannot be reached,
 * the shell already kept is better than no page.
 */
export async function loadShell(host: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const kept = shell !== null && shell.host === host ? shell : null;
  try {
    const response = await fetchImpl(`https://${host}/index.html`, {
      headers: {
        Accept: "text/html",
        ...(kept?.etag ? { "If-None-Match": kept.etag } : {}),
      },
      signal: AbortSignal.timeout(SHELL_TIMEOUT_MS),
    });
    if (response.status === 304 && kept !== null) return kept.html;
    if (!response.ok) throw new Error(`index.html answered ${response.status}`);
    const html = await response.text();
    shell = { host, html, etag: response.headers.get("etag") };
    return html;
  } catch (error) {
    if (kept === null) throw error;
    console.warn("index.html not checked; the kept one goes out", error);
    return kept.html;
  }
}

export function resetShellForTests(): void {
  shell = null;
}

function send(response: Response, html: string): void {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short at the edge, never in the browser: a Finish must not read yesterday's list.
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=120");
  // As firebase.json says for the app's other pages: no other site may frame it.
  response.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  response.status(200).send(html);
}

/**
 * The bare shell when Firestore would not answer: the site still loads and
 * asks the proxy for the list itself. Kept nowhere, so the edge does not
 * hand out an outage's page for two minutes after it.
 */
function sendBare(response: Response, html: string, error: unknown): void {
  console.warn("Firestore not read; the bare shell goes out", error);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(html);
}

/** Any other address under /l/ or /r/: the site's own page, which says it is not found. */
export async function shellPage(request: Request, response: Response): Promise<void> {
  send(response, await loadShell(hostOf(request)));
}

/**
 * What a person following a link gets when even the shell could not be had:
 * a page with a way to try again, not the API's JSON.
 */
export function unavailablePage(response: Response): void {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Retry-After", "30");
  response.status(503).send(UNAVAILABLE_HTML);
}

export const UNAVAILABLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>TierYourLife</title>
  </head>
  <body style="max-width: 32rem; margin: 15vh auto; padding: 0 16px; font: 16px/1.5 system-ui, sans-serif">
    <h1 style="font-size: 1.4rem">TierYourLife is not answering right now</h1>
    <p>Try again in a moment.</p>
    <p><a href="">Try again</a> · <a href="/">Go to TierYourLife</a></p>
  </body>
</html>
`;

interface StoredList {
  title?: string;
  /** Set by the backend once it keeps lists without an author itself. */
  anonymous?: boolean;
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
  /** The readers' rankings kept with the list, as the proxy counts them. */
  rankingCount?: number;
  underReview?: boolean;
  tiers?: unknown[];
  items?: unknown[];
  /** A house list's words in other languages, as the proxy keeps them. */
  translations?: Record<string, Record<string, string>>;
  /** A house list's title by language, where it has one. */
  names?: Record<string, string>;
  basedOn?: unknown;
}

/** A copy's credit to the list it came from, as the proxy's shownCredit gives it out. */
function creditOf(stored: unknown) {
  if (typeof stored !== "object" || stored === null) return null;
  const credit = stored as Record<string, unknown>;
  if (typeof credit.id !== "string") return null;
  return {
    id: credit.id,
    title: typeof credit.title === "string" ? credit.title : "",
    authorUid: typeof credit.authorUid === "string" ? credit.authorUid : "",
    authorName: typeof credit.authorName === "string" ? credit.authorName : "",
  };
}

/**
 * The same shape the proxy answers with. The author's uid is as public there
 * as it is here, and the page needs it: it is the address of the author's
 * page, and how an author is told from a visitor. An empty one broke both on
 * every list opened by its link.
 *
 * A list published without its author's name is drawn for everybody, so it
 * says nobody, as the proxy's answer to anybody but the author does: the page
 * asks the proxy itself when someone signed in may be that author.
 */
export function listPayload(id: string, data: StoredList) {
  const anonymous = data.anonymous === true;
  return {
    id,
    title: data.title ?? "",
    authorUid: !anonymous && typeof data.authorUid === "string" ? data.authorUid : "",
    authorName: anonymous ? "" : (data.authorName ?? ""),
    authorPhotoUrl: anonymous ? null : (data.authorPhotoUrl ?? null),
    anonymous,
    category: data.category ?? "other",
    itemCount: data.itemCount ?? data.items?.length ?? 0,
    coverImageUrl: data.coverImageUrl ?? null,
    previewImages: data.previewImages ?? [],
    tierColors: data.tierColors ?? [],
    updatedAt: data.updatedAt?.toMillis() ?? 0,
    takeCount: data.takeCount ?? 0,
    // The menu's "Rankings · N": without it a list opened by its link said 0.
    rankingCount: data.rankingCount ?? 0,
    tiers: data.tiers ?? [],
    items: data.items ?? [],
    // Without them a reader in another language got a house list as written,
    // and a copy lost its 'Based on' on every visit by its link.
    translations: data.translations ?? {},
    basedOn: creditOf(data.basedOn),
  };
}

/** What a reader's request says of the language a preview should speak. */
export interface Asked {
  /** `?hl=` in the address: the site's own links, and the picture's. */
  hl?: unknown;
  acceptLanguage?: string;
}

const askedOf = (request: Request): Asked => ({
  hl: (request.query as Record<string, unknown> | undefined)?.hl,
  acceptLanguage: request.header("accept-language") ?? undefined,
});

/**
 * The language a list's preview speaks: a house list's reader's, when the
 * list has words in it; every other list as written.
 */
export function listLocale(data: StoredList, asked: Asked): string {
  const offered = isEditorialList(data) ? offeredLocales(data.translations, data.names) : [];
  return previewLocale(asked.hl, asked.acceptLanguage, offered);
}

const SECTIONS = "sections";
/** A section's name changes seldom: read again after this long. */
const SECTION_TTL_MS = 10 * 60 * 1000;
const sectionsRead = new Map<string, { at: number; names: SectionNames | null }>();

/**
 * A section's names as its document keeps them, read a while ago at most;
 * null when it could not be read, and then the first nine are known anyway.
 */
async function sectionNames(category: unknown): Promise<SectionNames | null> {
  if (typeof category !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(category)) return null;
  const kept = sectionsRead.get(category);
  if (kept !== undefined && Date.now() - kept.at < SECTION_TTL_MS) return kept.names;
  try {
    const doc = await getFirestore().collection(SECTIONS).doc(category).get();
    const names = doc.exists ? { name: doc.get("name"), names: doc.get("names") } : null;
    sectionsRead.set(category, { at: Date.now(), names });
    return names;
  } catch (error) {
    console.warn(`Section ${category} not read`, error);
    return null;
  }
}

/** The words a chat shows for a list's link, in [locale]; [section] as its document names it. */
export function listMeta(
  host: string,
  id: string,
  data: StoredList,
  locale: string,
  section: SectionNames | null,
): PageMeta {
  const list = listPayload(id, data);
  const words = translatorFor(data.translations, data.names, locale);
  return {
    title: words.title(list.title),
    description: describeList({
      ...list,
      editorial: isEditorialList(data),
      section: sectionLabelOf(list.category, section, locale),
      locale,
    }),
    image: shareImageUrl(host, "l", id, list.updatedAt, locale),
    imageSize: { width: SHARE_WIDTH, height: SHARE_HEIGHT },
    url: `https://${host}/l/${id}`,
    locale: wordsFor(locale).ogLocale,
  };
}

/** A page whose words follow the reader's language says so to the caches between. */
const varyByLanguage = (response: Response, offered: readonly string[]): void => {
  if (offered.length > 0) response.setHeader("Vary", "Accept-Language");
};

export async function listPage(request: Request, response: Response, id: string): Promise<void> {
  const host = hostOf(request);
  const html = await loadShell(host);
  let data: StoredList | null;
  try {
    const doc = LIST_ID.test(id) ? await getFirestore().collection(PUBLISHED).doc(id).get() : null;
    data = doc?.exists ? (doc.data() as StoredList) : null;
  } catch (error) {
    return sendBare(response, html, error);
  }
  // A hidden or missing list gets the bare shell: the page will say so itself,
  // and a chat gets nothing to unfurl.
  if (data === null || data.underReview === true) return send(response, html);

  const list = listPayload(id, data);
  const locale = listLocale(data, askedOf(request));
  const meta = listMeta(host, id, data, locale, await sectionNames(list.category));
  varyByLanguage(response, offeredLocales(data.translations, data.names));
  send(response, renderPage(html, meta, { kind: "list", list }));
}

const SHARE_SIZE = { width: SHARE_WIDTH, height: SHARE_HEIGHT };

/** Whatever the stored tiers and items look like, the card gets what it can draw. */
function shareTiersOf(raw: unknown[] | undefined, word: (text: string) => string): ShareTier[] {
  return (raw ?? []).map((tier) => {
    const t = (tier ?? {}) as { label?: unknown; caption?: unknown; colorLight?: unknown };
    return {
      label: typeof t.label === "string" ? word(t.label) : "",
      caption: typeof t.caption === "string" ? word(t.caption) : null,
      colorLight: typeof t.colorLight === "string" ? t.colorLight : "#5d5c66",
    };
  });
}

function shareItemsOf(raw: unknown[] | undefined, word: (text: string) => string): ShareItem[] {
  return (raw ?? []).map((item) => {
    const i = (item ?? {}) as { title?: unknown; imageUrl?: unknown };
    return {
      title: typeof i.title === "string" ? word(i.title) : "",
      imageUrl:
        typeof i.imageUrl === "string" && i.imageUrl.startsWith("https://") ? i.imageUrl : null,
    };
  });
}

/** The version a card is drawn for: the list's last change, or nothing yet. */
const listVersion = (data: StoredList): number => data.updatedAt?.toMillis() ?? 0;

/** A card kept per language as well: a house list's in Russian is not its English one. */
const inLanguage = (version: number | string, locale: string): number | string =>
  locale === AS_WRITTEN ? version : `${version}-${locale}`;

/** A list's card in [locale], its section as its document names it. */
export function listCard(
  data: StoredList,
  locale: string,
  section: SectionNames | null,
): ShareCard {
  const { title, word } = translatorFor(data.translations, data.names, locale);
  return {
    kind: "list",
    title: title(data.title ?? ""),
    editorial: isEditorialList(data),
    authorName: data.authorName ?? "",
    category: data.category ?? "other",
    section: sectionLabelOf(data.category ?? "other", section, locale),
    locale,
    itemCount: data.itemCount ?? data.items?.length ?? 0,
    tiers: shareTiersOf(data.tiers, word),
    items: shareItemsOf(data.items, word),
  };
}

export async function listShareImage(response: Response, id: string, hl?: unknown): Promise<void> {
  const doc = LIST_ID.test(id) ? await getFirestore().collection(PUBLISHED).doc(id).get() : null;
  const data = doc?.exists ? (doc.data() as StoredList) : null;
  if (data === null || data.underReview === true) return sendShareImage(response, null);
  // The picture is asked for in the language its page chose, and in no other.
  const locale = listLocale(data, { hl });
  const section = await sectionNames(data.category ?? "other");
  sendShareImage(
    response,
    await shareImageFor("l", id, inLanguage(listVersion(data), locale), async () =>
      listCard(data, locale, section),
    ),
  );
}

/** What the list says of itself today, for telling an editorial one; nothing when it is gone. */
const standingOf = (
  list: FirebaseFirestore.DocumentSnapshot,
): { authorUid?: unknown; anonymous?: unknown } | null =>
  list.exists ? { authorUid: list.get("authorUid"), anonymous: list.get("anonymous") } : null;

/**
 * A ranking's card changes when its owner edits it, and when its list does:
 * a list made anonymous takes its author's name off every ranking of it, so
 * the card kept with the name must not be the one a chat is sent again.
 */
export const rankingVersion = (stored: StoredRanking, listChangedAt: number): number =>
  Math.max(stored.updatedAt?.toMillis() ?? stored.createdAt?.toMillis() ?? 0, listChangedAt);

/**
 * The version a ranking's card is kept and fetched under. A list that is gone
 * takes its author's name off every ranking of it without a newer date to
 * show for that, so the card says so in its version; otherwise the copy kept
 * with the name would be the one sent again. [listChangedAt] is null then.
 */
export const rankingCardVersion = (stored: StoredRanking, listChangedAt: number | null): string =>
  listChangedAt === null
    ? `${rankingVersion(stored, 0)}-gone`
    : `${rankingVersion(stored, listChangedAt)}`;

/** When a list last changed, or null when it is gone. */
const changedAt = (list: FirebaseFirestore.DocumentSnapshot): number | null =>
  list.exists ? ((list.get("updatedAt") as StoredList["updatedAt"])?.toMillis() ?? 0) : null;

/**
 * The language a ranking's preview speaks: as its list's, from the words the
 * ranking kept of a house list (none before it kept them).
 */
export function rankingLocale(snapshot: Snapshot, asked: Asked): string {
  const offered =
    snapshot.editorial === true ? offeredLocales(snapshot.translations, snapshot.names) : [];
  return previewLocale(asked.hl, asked.acceptLanguage, offered);
}

/** A ranking's card in [locale]; [shown] is the snapshot as it is shown today. */
export function rankingCard(stored: StoredRanking, shown: Snapshot, locale: string): ShareCard {
  const { title, word } = translatorFor(
    stored.snapshot.translations,
    stored.snapshot.names,
    locale,
  );
  return {
    kind: "ranking",
    title: title(stored.snapshot.title),
    editorial: shown.editorial === true,
    authorName: shown.authorName,
    category: stored.snapshot.category,
    locale,
    tiers: shareTiersOf(stored.snapshot.tiers, word),
    items: shareItemsOf(stored.snapshot.items, word),
    rows: fromStoredRows(stored.rows),
  };
}

export async function rankingShareImage(
  response: Response,
  code: string,
  hl?: unknown,
): Promise<void> {
  const doc = isCode(code) ? await getFirestore().collection(RANKINGS).doc(code).get() : null;
  if (doc === null || !doc.exists) return sendShareImage(response, null);
  const stored = doc.data() as StoredRanking;
  const list = await getFirestore().collection(PUBLISHED).doc(stored.listId).get();
  const snapshot =
    stored.snapshot.editorial === true
      ? stored.snapshot
      : shownSnapshot(stored.snapshot, standingOf(list));
  const locale = rankingLocale(stored.snapshot, { hl });
  sendShareImage(
    response,
    await shareImageFor(
      "r",
      code,
      inLanguage(rankingCardVersion(stored, changedAt(list)), locale),
      async () => rankingCard(stored, snapshot, locale),
    ),
  );
}

/** The words a chat shows for a ranking's link, in [locale]. */
export function rankingMeta(
  host: string,
  code: string,
  stored: StoredRanking,
  shown: Snapshot,
  listChangedAt: number | null,
  locale: string,
  section: SectionNames | null,
): PageMeta {
  const words = translatorFor(stored.snapshot.translations, stored.snapshot.names, locale);
  return {
    title: words.title(stored.snapshot.title),
    description: describeRanking({
      placed: placedCount(fromStoredRows(stored.rows)),
      itemCount: stored.snapshot.items.length,
      authorName: shown.authorName,
      category: stored.snapshot.category,
      editorial: shown.editorial === true,
      section: sectionLabelOf(stored.snapshot.category, section, locale),
      locale,
    }),
    image: shareImageUrl(host, "r", code, rankingCardVersion(stored, listChangedAt), locale),
    imageSize: SHARE_SIZE,
    url: `https://${host}/r/${code}`,
    locale: wordsFor(locale).ogLocale,
  };
}

export async function rankingPage(
  request: Request,
  response: Response,
  code: string,
): Promise<void> {
  const host = hostOf(request);
  const html = await loadShell(host);
  let found: { stored: StoredRanking; list: FirebaseFirestore.DocumentSnapshot } | null;
  try {
    const db = getFirestore();
    const doc = isCode(code) ? await db.collection(RANKINGS).doc(code).get() : null;
    const stored = doc?.exists ? (doc.data() as StoredRanking) : null;
    found =
      stored === null
        ? null
        : { stored, list: await db.collection(PUBLISHED).doc(stored.listId).get() };
  } catch (error) {
    return sendBare(response, html, error);
  }
  if (found === null) return send(response, html);

  const { stored, list } = found;
  const snapshot = shownSnapshot(stored.snapshot, standingOf(list));
  const ranking = {
    code,
    listId: stored.listId,
    listAvailable: list.exists && list.get("underReview") !== true,
    snapshot,
    rows: fromStoredRows(stored.rows),
    createdAt: stored.createdAt?.toMillis() ?? 0,
  };
  const locale = rankingLocale(stored.snapshot, askedOf(request));
  const section = await sectionNames(stored.snapshot.category);
  const meta = rankingMeta(host, code, stored, snapshot, changedAt(list), locale, section);
  varyByLanguage(response, offeredLocales(stored.snapshot.translations, stored.snapshot.names));
  send(response, renderPage(html, meta, { kind: "ranking", ranking }));
}
