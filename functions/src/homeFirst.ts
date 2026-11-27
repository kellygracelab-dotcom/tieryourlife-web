import type { Response } from "express";
import { Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { inDemoEmulator } from "./appCheck";
import { isBanned, type Ban } from "./bans";

/*
 * Community's first screen for a browser that has no App Check token yet
 * (Danylo's yes, 27.11.2026): the sections' tiles, people's newest lists and
 * the first page of Popular, read here as the proxy reads them for a guest,
 * so the page can draw them while reCAPTCHA is still at work. Only what any
 * visitor is shown: no follows, nothing of anybody's own. The site asks for
 * the live answers as before, and they take this one's place.
 *
 * Read the way TierYourLifeProxy reads them at 9e86c84 (community.ts
 * readFeed, readFreshRow, readSections and readOneSection; feedApproval.ts
 * inFeeds; freshRow.ts; anonymous.ts fillVisible, shownAuthor; publicMedia.ts
 * publicMediaJson). A change to those is a change here: the live answer then
 * replaces this one on screen, and a list in a different place would jump.
 */

const PUBLISHED = "publishedLists";
const SECTIONS = "sections";
const BANS = "bans";
const EDITORIAL_UID = "tyl-editorial";

/** The proxy's FEED_PAGE_SIZE and MAX_FILL_ROUNDS. */
export const FEED_PAGE_SIZE = 20;
const MAX_FILL_ROUNDS = 5;

/** freshRow.ts, word for word. */
export const FRESH_DAYS = 14;
const FRESH_READ = 60;
const FRESH_PAGES = 5;
const FRESH_MAX = 12;
const FRESH_PER_AUTHOR = 3;
const FRESH_MIN_CARDS = 8;
const FRESH_PICTURE_SHARE = 0.8;
const FRESH_MIN_PREVIEWS = 4;

/** How far back the activity that orders sections looks (sections.ts ACTIVITY_WINDOW_MS). */
const ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** The proxy keeps its section counts this long (SECTION_STATS_TTL_MS). */
const SECTION_COUNTS_MS = 10 * 60 * 1000;
/** The languages a house list's title is translated into (search.ts SEARCH_LANGUAGES without en). */
const TRANSLATION_LOCALES = ["ru", "uk", "de", "es", "fr", "ja", "pl", "pt-BR", "tr", "ar"];

/**
 * One answer for every visitor for this long, so the CDN's misses, and any
 * number of them, read the lists at most once in that time on an instance.
 * With the edge's half minute on top, a list taken down by moderation reaches
 * nobody new within a minute, as with the pictures (Coordinator, 27.11).
 */
export const HOME_FIRST_MS = 30_000;
/** At the edge: half a minute, which with HOME_FIRST_MS makes the takedown's minute. */
export const HOME_FIRST_CACHE = "public, max-age=0, s-maxage=30";

interface StoredList {
  title?: string;
  anonymous?: boolean;
  authorUid?: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  category?: string;
  itemCount?: number;
  coverImageUrl?: unknown;
  coverFocus?: unknown;
  previewImages?: unknown[];
  tierColors?: string[];
  tierCounts?: unknown;
  tiers?: unknown[];
  items?: unknown[];
  topicId?: string | null;
  topicName?: string | null;
  updatedAt?: FirebaseFirestore.Timestamp;
  takeCount?: number;
  rankingCount?: number;
  basedOn?: unknown;
  listSource?: unknown;
  translations?: unknown;
  underReview?: unknown;
  awaitingApproval?: unknown;
}

/** feedApproval.ts: not hidden after reports, and not waiting for approval. */
export function inFeeds(list: { underReview?: unknown; awaitingApproval?: unknown }): boolean {
  return list.underReview !== true && list.awaitingApproval !== true;
}

const isWebPicture = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("https://");

/** community.ts: old lists keep the word "null" as their cover; only a web address goes out. */
const webPicture = (value: unknown): string | null =>
  isWebPicture(value) ? (value as string) : null;

/** freshRow.ts freshEligible: a person's list, named, in the feed, and looking like something. */
export function freshEligible(list: StoredList): boolean {
  if (
    list.authorUid === EDITORIAL_UID ||
    list.anonymous === true ||
    list.underReview === true ||
    list.awaitingApproval === true
  )
    return false;
  const items = Array.isArray(list.items) ? list.items : [];
  if (items.length < FRESH_MIN_CARDS) return false;
  const pictured = items.filter((item) =>
    isWebPicture((item as { imageUrl?: unknown } | null)?.imageUrl),
  ).length;
  if (pictured < FRESH_PICTURE_SHARE * items.length) return false;
  const previews = (list.previewImages ?? []).filter(isWebPicture).length;
  return isWebPicture(list.coverImageUrl) || previews >= FRESH_MIN_PREVIEWS;
}

/** freshRow.ts freshRow: authors take turns, the most recently publishing first. */
export function freshRow<T extends { authorUid: string }>(newestFirst: readonly T[]): T[] {
  const byAuthor = new Map<string, T[]>();
  for (const list of newestFirst) {
    const own = byAuthor.get(list.authorUid) ?? [];
    if (own.length < FRESH_PER_AUTHOR) own.push(list);
    byAuthor.set(list.authorUid, own);
  }
  const turns: T[] = [];
  for (let turn = 0; turn < FRESH_PER_AUTHOR; turn++) {
    for (const own of byAuthor.values()) if (own[turn] !== undefined) turns.push(own[turn]!);
  }
  return turns.slice(0, FRESH_MAX);
}

/** anonymous.ts fillVisible: pages of the same size until one is full or the rows run out. */
export async function fillVisible<T>(
  fetch: (after: T | null) => Promise<T[]>,
  keep: (row: T) => boolean,
  pageSize: number,
): Promise<{ rows: T[]; next: T | null }> {
  const rows: T[] = [];
  let after: T | null = null;
  for (let round = 0; round < MAX_FILL_ROUNDS; round++) {
    const read = await fetch(after);
    for (const row of read) {
      if (!keep(row)) continue;
      rows.push(row);
      if (rows.length === pageSize) return { rows, next: row };
    }
    if (read.length < pageSize) return { rows, next: null };
    after = read[read.length - 1]!;
  }
  return { rows, next: rows.length > 0 ? rows[rows.length - 1]! : null };
}

/** editorial.ts titleNames: the title in every language it has been translated into. */
function titleNames(title: unknown, translations: unknown): Record<string, string> {
  const names: Record<string, string> = {};
  if (typeof title !== "string" || !isPlainObject(translations)) return names;
  for (const locale of TRANSLATION_LOCALES) {
    const entries = translations[locale];
    const name =
      isPlainObject(entries) && Object.hasOwn(entries, title) ? entries[title] : undefined;
    if (typeof name === "string" && name.length > 0) names[locale] = name;
  }
  return names;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** publishing.ts tierCountsOf: cards per tier, then the unranked ones. */
function tierCountsOf(tierCount: number, items: readonly { tierIndex?: unknown }[]): number[] {
  const counts = new Array<number>(tierCount + 1).fill(0);
  for (const item of items) {
    const tier = item.tierIndex;
    const placed =
      typeof tier === "number" && Number.isInteger(tier) && tier >= 0 && tier < tierCount;
    counts[placed ? tier : tierCount]! += 1;
  }
  return counts;
}

/** community.ts previewFocusOf: each collage picture's focus, left out when none has one. */
function previewFocusOf(previews: readonly string[], items: readonly unknown[] | undefined) {
  const focusOf = new Map<string, unknown>();
  for (const raw of items ?? []) {
    const card = raw as { imageUrl?: unknown; pictureFocus?: unknown } | null;
    if (
      card &&
      typeof card.imageUrl === "string" &&
      card.pictureFocus &&
      !focusOf.has(card.imageUrl)
    )
      focusOf.set(card.imageUrl, card.pictureFocus);
  }
  const previewFocus = previews.map((url) => focusOf.get(url) ?? null);
  return previewFocus.some((one) => one !== null) ? { previewFocus } : {};
}

const COLLAGE_BASE = "https://tieryourlife.com/img/collage/";

/** community.ts collageUrlOf: a card with no cover and two pictures or more is drawn as one. */
function collageOf(
  id: string,
  cover: string | null,
  previews: readonly string[],
  updatedAtMs: number,
) {
  return cover === null && previews.length >= 2
    ? { collageUrl: `${COLLAGE_BASE}${encodeURIComponent(id)}.webp?v=${updatedAtMs}` }
    : {};
}

/** rankings.ts shownCredit. */
function shownCredit(stored: unknown) {
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

/** community.ts toSummary for a guest: nothing is theirs, they follow nobody. */
export function guestSummary(id: string, data: StoredList) {
  const anonymous = data.anonymous === true;
  const cover = webPicture(data.coverImageUrl);
  const previews = (data.previewImages ?? []).filter(isWebPicture) as string[];
  const updatedAt = data.updatedAt?.toMillis() ?? 0;
  return {
    id,
    title: data.title,
    names: titleNames(data.title, data.translations),
    ...(anonymous
      ? { authorUid: "", authorName: "", authorPhotoUrl: null, anonymous: true }
      : {
          authorUid: data.authorUid,
          authorName: data.authorName,
          authorPhotoUrl: data.authorPhotoUrl ?? null,
          anonymous: false,
        }),
    tierCounts: Array.isArray(data.tierCounts)
      ? data.tierCounts
      : tierCountsOf((data.tiers ?? []).length, (data.items ?? []) as { tierIndex?: unknown }[]),
    category: data.category ?? "other",
    itemCount: data.itemCount,
    coverImageUrl: cover,
    ...(data.coverFocus && cover !== null ? { coverFocus: data.coverFocus } : {}),
    ...(data.listSource ? { listSource: data.listSource } : {}),
    previewImages: previews,
    ...previewFocusOf(previews, data.items),
    ...collageOf(id, cover, previews, updatedAt),
    tierColors: data.tierColors ?? [],
    topicId: data.topicId ?? null,
    topicName: data.topicName ?? null,
    updatedAt,
    takeCount: data.takeCount ?? 0,
    rankingCount: data.rankingCount ?? 0,
    basedOn: shownCredit(data.basedOn),
  };
}

/** The proxy's publicMedia.ts: pictures go out at the site's own address. */
const BUCKET = "tieryourlife.firebasestorage.app";
const STORAGE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`;
const ORIGINAL = "https://tieryourlife.com/img/original/";
const ORIGINALS = [
  ORIGINAL,
  "https://www.tieryourlife.com/img/original/",
  "https://tieryourlife.web.app/img/original/",
  "https://tieryourlife.firebaseapp.com/img/original/",
];
const KINDS = new Set(["published", "avatars", "sections", "topics"]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PICTURE = /^[A-Za-z0-9_-]+$/;
const IMAGE_FIELDS = new Set([
  "imageUrl",
  "coverImageUrl",
  "authorPhotoUrl",
  "photoUrl",
  "pictureUrl",
  "url",
  "previewImages",
  "collage",
]);

function publicPath(parts: string[]): string | null {
  if (parts.length !== 3) return null;
  const [kind, id, picture] = parts as [string, string, string];
  const path = parts.join("/");
  return path.length <= 1024 && KINDS.has(kind) && ID.test(id) && PICTURE.test(picture)
    ? path
    : null;
}

function pathOf(url: string): string | null {
  const site = ORIGINALS.find((prefix) => url.startsWith(prefix));
  if (site !== undefined) return publicPath(url.slice(site.length).split(/[?#]/)[0]!.split("/"));
  if (!url.startsWith(STORAGE)) return null;
  const query = url.indexOf("?", STORAGE.length);
  if (query < 0 || new URLSearchParams(url.slice(query + 1).split("#")[0]).get("alt") !== "media")
    return null;
  return publicPath(url.slice(STORAGE.length, query).split(/%2f/i));
}

export function publicMediaUrl(url: string): string {
  const path = pathOf(url);
  return path === null ? url : ORIGINAL + path;
}

/** Only image fields change on the wire; ids, titles and credits stay as they are. */
export function publicMediaJson(value: unknown, field = ""): unknown {
  if (typeof value === "string") return IMAGE_FIELDS.has(field) ? publicMediaUrl(value) : value;
  if (Array.isArray(value)) return value.map((item) => publicMediaJson(item, field));
  if (value === null || typeof value !== "object") return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, publicMediaJson(item, key)]),
  );
}

/** Popular's first page, as GET /lists?sort=popular answers a guest. */
async function readPopular(db: Firestore) {
  const ordered = db
    .collection(PUBLISHED)
    .orderBy("takeCount", "desc")
    .orderBy("updatedAt", "desc");
  const page = await fillVisible<QueryDocumentSnapshot>(
    async (last) =>
      (await (last ? ordered.startAfter(last) : ordered).limit(FEED_PAGE_SIZE).get()).docs,
    (doc) => inFeeds(doc.data() as StoredList),
    FEED_PAGE_SIZE,
  );
  return {
    lists: page.rows.map((doc) => guestSummary(doc.id, doc.data() as StoredList)),
    nextCursor: page.next?.id ?? null,
  };
}

/** The row of people's new lists, as GET /lists?fresh=1 answers a guest. */
async function readFresh(db: Firestore, nowMs: number) {
  const since = Timestamp.fromMillis(nowMs - FRESH_DAYS * 24 * 60 * 60 * 1000);
  const ordered = db
    .collection(PUBLISHED)
    .where("publishedAt", ">=", since)
    .orderBy("publishedAt", "desc");
  const eligible: QueryDocumentSnapshot[] = [];
  let last: QueryDocumentSnapshot | null = null;
  for (let page = 0; page < FRESH_PAGES; page++) {
    const docs: QueryDocumentSnapshot[] = (
      await (last ? ordered.startAfter(last) : ordered).limit(FRESH_READ).get()
    ).docs;
    eligible.push(...docs.filter((doc) => freshEligible(doc.data() as StoredList)));
    if (docs.length < FRESH_READ) break;
    last = docs[docs.length - 1]!;
  }
  const authorOf = (doc: QueryDocumentSnapshot) => doc.get("authorUid") as string;
  const authors = [...new Set(eligible.map(authorOf))];
  const bans =
    authors.length === 0
      ? []
      : await db.getAll(...authors.map((uid) => db.collection(BANS).doc(uid)));
  const banned = new Set(
    bans.filter((doc) => doc.exists && isBanned(doc.data() as Ban, nowMs)).map((doc) => doc.id),
  );
  const row = freshRow(
    eligible
      .filter((doc) => !banned.has(authorOf(doc)))
      .map((doc) => ({ authorUid: authorOf(doc), doc })),
  );
  return row.map((one) => guestSummary(one.doc.id, one.doc.data() as StoredList));
}

interface StoredSection {
  name?: string;
  names?: Record<string, string>;
  icon?: string;
  picture?: { url?: string } | null;
  pictureFocus?: unknown;
  tint?: unknown;
  topicBg?: unknown;
  topicIcon?: unknown;
  status?: string;
  builtIn?: boolean;
  hidden?: boolean;
  rank?: number | null;
  approvedAt?: FirebaseFirestore.Timestamp | null;
}

/**
 * What a section's tile on the first screen needs, as GET /lists/sections
 * gives a guest an approved section that is not hidden: its picture, words
 * and colours, and what orders the tiles. The counts a section's own page
 * shows are not here; that page waits for the live answer.
 */
export function sectionTile(id: string, data: StoredSection, lists30d: number) {
  const pictureUrl = data.picture?.url ?? null;
  return {
    id,
    name: data.name ?? id,
    names: data.names ?? {},
    ...(data.icon !== undefined ? { icon: data.icon } : {}),
    pictureUrl,
    ...(pictureUrl !== null && data.pictureFocus ? { pictureFocus: data.pictureFocus } : {}),
    ...(data.tint !== undefined ? { tint: data.tint } : {}),
    ...(data.topicBg !== undefined ? { topicBg: data.topicBg } : {}),
    ...(data.topicIcon !== undefined ? { topicIcon: data.topicIcon } : {}),
    status: "approved" as const,
    builtIn: data.builtIn === true,
    hidden: false,
    rank: data.rank ?? null,
    approvedAt: data.approvedAt?.toMillis() ?? null,
    lists30d,
    following: false,
  };
}

/** Lists of a section updated in the last thirty days, those hidden after reports left out. */
async function activityOf(db: Firestore, id: string, nowMs: number): Promise<number> {
  const month = Timestamp.fromMillis(nowMs - ACTIVITY_WINDOW_MS);
  const lists = db.collection(PUBLISHED).where("category", "==", id);
  const [active, hidden] = await Promise.all([
    lists.where("updatedAt", ">=", month).count().get(),
    lists.where("underReview", "==", true).where("updatedAt", ">=", month).count().get(),
  ]);
  return Math.max(0, active.data().count - hidden.data().count);
}

let counts: { at: number; byId: Map<string, number> } | null = null;

async function readSectionTiles(db: Firestore, nowMs: number) {
  const docs = (await db.collection(SECTIONS).where("status", "in", ["approved"]).get()).docs
    .map((doc) => ({ id: doc.id, data: doc.data() as StoredSection }))
    .filter((one) => one.data.status === "approved" && one.data.hidden !== true);
  // In the emulators the counts are read every time: the smokes compare them with the proxy's.
  const kept =
    counts !== null && nowMs - counts.at < SECTION_COUNTS_MS && !inDemoEmulator() ? counts : null;
  const byId = new Map(kept?.byId ?? []);
  const missing = docs.filter((one) => !byId.has(one.id));
  const read = await Promise.all(missing.map((one) => activityOf(db, one.id, nowMs)));
  missing.forEach((one, at) => byId.set(one.id, read[at]!));
  if (kept === null) counts = { at: nowMs, byId };
  return docs.map((one) => sectionTile(one.id, one.data, byId.get(one.id) ?? 0));
}

export interface HomeFirst {
  sections: ReturnType<typeof sectionTile>[];
  fresh: ReturnType<typeof guestSummary>[];
  popular: { lists: ReturnType<typeof guestSummary>[]; nextCursor: string | null };
  at: number;
}

export async function readHomeFirst(db: Firestore, nowMs: number): Promise<HomeFirst> {
  const [sections, fresh, popular] = await Promise.all([
    readSectionTiles(db, nowMs),
    readFresh(db, nowMs),
    readPopular(db),
  ]);
  return publicMediaJson({ sections, fresh, popular, at: nowMs }) as HomeFirst;
}

let kept: { at: number; answer: Promise<HomeFirst> } | null = null;

/** One answer per HOME_FIRST_MS for everybody; a failed read is not kept. */
export function homeFirst(
  db: Firestore,
  nowMs: number,
  read: (db: Firestore, nowMs: number) => Promise<HomeFirst> = readHomeFirst,
): Promise<HomeFirst> {
  // The emulators' smokes compare every answer with the proxy's: nothing is kept there.
  if (inDemoEmulator()) return read(db, nowMs);
  if (kept !== null && nowMs - kept.at < HOME_FIRST_MS) return kept.answer;
  const answer = read(db, nowMs);
  const mine = { at: nowMs, answer };
  kept = mine;
  answer.catch(() => {
    if (kept === mine) kept = null;
  });
  return answer;
}

export function forgetHomeFirstForTests(): void {
  kept = null;
  counts = null;
}

/** GET /api/home: no token, no account, the same for everybody, kept at the edge half a minute. */
export async function sendHomeFirst(
  response: Response,
  db: Firestore,
  nowMs: number,
  read?: (db: Firestore, nowMs: number) => Promise<HomeFirst>,
): Promise<void> {
  const answer = await homeFirst(db, nowMs, read);
  response.setHeader("Cache-Control", HOME_FIRST_CACHE);
  response.status(200).json(answer);
}
