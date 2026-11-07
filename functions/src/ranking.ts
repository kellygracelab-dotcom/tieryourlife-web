/**
 * The rules of a visitor's ranking. Pure, like quota.ts in the backend
 * repository: no Firestore, no clock, no randomness of its own. web.ts turns
 * these decisions into reads and writes.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { isEditorialList } from "./editorial";

/** No 0/O, 1/l/I: a code is read off a stream and typed by hand. */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const CODE_LENGTH = 8;

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Firestore limits the whole document to 1 MiB. Count UTF-8 bytes and reserve
 * room for the encoded field names, type and length tags, nested maps and the
 * document path. Numbers and timestamps fit in 16 bytes in this schema.
 * https://firebase.google.com/docs/firestore/storage-size
 */
function storedBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8") + 8;
  if (Array.isArray(value))
    return value.reduce<number>((total, item) => total + 8 + storedBytes(item), 16);
  if (value && typeof value === "object") {
    return Object.entries(value).reduce(
      (total, [name, child]) => total + Buffer.byteLength(name, "utf8") + 16 + storedBytes(child),
      32,
    );
  }
  return 16;
}

export const rankingFits = (document: unknown): boolean =>
  storedBytes(document) + 1024 <= 1024 * 1024;

/** One person, one ranking every couple of seconds. Anything faster is a script. */
export const MIN_WRITE_GAP_MS = 2000;

/**
 * Rankings the whole site accepts in one UTC day. Not a business rule: set
 * far above honest use and treat it tripping as an alarm.
 */
export const DAILY_CEILING = 5000;

/**
 * How much of the day's ceiling guests may take. A guest costs one anonymous
 * sign-up, so a script of fresh guests could use up the whole day and every
 * Finish, an account's too, would fail until midnight UTC. An account costs a
 * real sign-in: the rest of the day stays theirs.
 */
export const GUEST_DAILY_CEILING = 4000;

/**
 * Guest rankings one App Check token may keep. The pause above holds one uid
 * only, and a script makes a new guest per Finish while it replays the one
 * token a browser was given; a token lasts about an hour, and nobody honest
 * finishes thirty rankings in one. Each further batch then costs the script
 * a fresh attestation in a real browser.
 */
export const GUEST_RANKINGS_PER_APP_CHECK_TOKEN = 30;

/** Longer than an App Check token lives, so its count is never forgotten while it works. */
export const APP_CHECK_TOKEN_KEPT_MS = 2 * 60 * 60 * 1000;

/** The part of the day's ceiling a caller may reach. */
export const ceilingFor = (isAnonymous: boolean): number =>
  isAnonymous ? GUEST_DAILY_CEILING : DAILY_CEILING;

/** A token is counted under its hash: the stored id never works as a token itself. */
export const appCheckKeyOf = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** Firestore ids, and nothing that could be a path. */
const LIST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface Snapshot {
  title: string;
  /**
   * The list stood without an author when it was ranked, and the snapshot
   * keeps no name either. The author's uid is never in the snapshot: a
   * ranking outlives its list and its author's account. The document keeps
   * it beside the snapshot (listAuthorUid) only until that account goes.
   */
  editorial?: boolean;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  tiers: { label: string; caption: string | null; colorLight: string; colorDark: string }[];
  /** `credit` is the photographer a picture's license asks to name; absent for none. */
  items: { title: string; imageUrl: string | null; tierIndex: number | null; credit?: string }[];
  /**
   * A house list's words in other languages, from the text as written to the
   * text in that language, only those the snapshot uses. Absent on rankings
   * kept before they were, and on lists nobody translates.
   */
  translations?: Record<string, Record<string, string>>;
  /** A house list's title by language, when the list has one. */
  names?: Record<string, string>;
}

export interface Refusal {
  ok: false;
  status: number;
  code: string;
  error: string;
}

export type RankDecision = { ok: true; listId: string; rows: number[][] } | Refusal;

const refuse = (status: number, code: string, error: string): Refusal => ({
  ok: false,
  status,
  code,
  error,
});

export function decideListId(body: unknown): string | null {
  const listId = (body as { listId?: unknown } | null)?.listId;
  return typeof listId === "string" && LIST_ID.test(listId) ? listId : null;
}

/**
 * What the visitor placed where. Rows are item positions in the snapshot,
 * one array per tier, in the order the cards were dropped. Everything the
 * rows do not mention stays unranked.
 */
export type PlacementDecision = { ok: true; rows: number[][] } | Refusal;

/** Rows as the client sends them: one list of card indexes per tier, each card at most once. */
export function decidePlacement(
  rows: unknown,
  tierCount: number,
  itemCount: number,
): PlacementDecision {
  if (!Array.isArray(rows) || rows.length !== tierCount) {
    return refuse(400, "INVALID", "Rows do not match the list's tiers");
  }
  const seen = new Set<number>();
  const clean: number[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return refuse(400, "INVALID", "A row must be a list of cards");
    for (const item of row) {
      if (!Number.isInteger(item) || item < 0 || item >= itemCount) {
        return refuse(400, "INVALID", "A card is not on this list");
      }
      if (seen.has(item)) return refuse(400, "INVALID", "A card is placed twice");
      seen.add(item);
    }
    clean.push(row as number[]);
  }
  if (seen.size === 0) return refuse(400, "INVALID", "Nothing is placed yet");
  return { ok: true, rows: clean };
}

export function decideRows(body: unknown, tierCount: number, itemCount: number): RankDecision {
  const source = body as { listId?: unknown; rows?: unknown } | null;
  const listId = decideListId(source);
  if (listId === null) return refuse(400, "INVALID", "Which list?");
  const placement = decidePlacement(source?.rows, tierCount, itemCount);
  return placement.ok ? { ok: true, listId, rows: placement.rows } : placement;
}

/**
 * Rows are card positions, so they mean something only against the version
 * of the list they were placed on. A Finish that names its version is refused
 * when the list was republished since, rather than kept against cards the
 * person never placed. One without a version (an older page) is taken as before.
 */
export function decideVersion(body: unknown, storedMillis: number): Refusal | null {
  const version = (body as { version?: unknown } | null)?.version;
  return typeof version === "number" && version !== storedMillis
    ? refuse(409, "LIST_CHANGED", "The list changed since it was opened")
    : null;
}

/** A new arrangement for a ranking that already exists; the rows are all it can change. */
export function decideEdit(body: unknown, tierCount: number, itemCount: number): PlacementDecision {
  return decidePlacement((body as { rows?: unknown } | null)?.rows, tierCount, itemCount);
}

/** Only the account that keeps a ranking may change it; a guest's copy is not an account. */
export function decideOwner(owner: StoredOwner, uid: string): { ok: true } | Refusal {
  return owner.ownerUid === uid && !owner.ownerAnonymous
    ? { ok: true }
    : refuse(403, "NOT_YOURS", "This ranking is kept by someone else");
}

/**
 * Who may re-arrange a ranking: the account that keeps it, or the guest who
 * made it while nobody has claimed it, so a Finish again on the list page
 * changes the one behind the link. Claiming and deleting stay an account's.
 */
export function decideEditor(
  owner: StoredOwner,
  identity: { uid: string; isAnonymous: boolean },
): { ok: true } | Refusal {
  return owner.ownerUid === identity.uid && owner.ownerAnonymous === identity.isAnonymous
    ? { ok: true }
    : refuse(403, "NOT_YOURS", "This ranking is kept by someone else");
}

export const isKeptBy = (owner: StoredOwner, uid: string | null): boolean =>
  uid !== null && owner.ownerUid === uid && !owner.ownerAnonymous;

export function isCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/** [random] answers with an integer in [0, max). */
export function makeCode(random: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  }
  return code;
}

export function tooSoon(lastWriteAtMs: number | null, nowMs: number): boolean {
  return lastWriteAtMs !== null && nowMs - lastWriteAtMs < MIN_WRITE_GAP_MS;
}

/** UTC day the ceiling is counted against, as a Firestore document id. */
export function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Firestore refuses an array inside an array, so rows travel as a list of maps. */
export interface StoredRow {
  items: number[];
}

export const toStoredRows = (rows: number[][]): StoredRow[] => rows.map((items) => ({ items }));

export function fromStoredRows(stored: unknown): number[][] {
  if (!Array.isArray(stored)) return [];
  return stored.map((row) => {
    const items = (row as { items?: unknown } | null)?.items;
    return Array.isArray(items) ? items.filter((i): i is number => Number.isInteger(i)) : [];
  });
}

/** The snapshot a ranking keeps: enough to draw the board after the list is gone. */
/**
 * The author a ranking's snapshot names, kept beside it so their name can be
 * taken out once their account is erased; none when the snapshot names nobody.
 */
export function listAuthorOf(list: Record<string, unknown>): string | null {
  if (isEditorialList(list)) return null;
  return typeof list.authorUid === "string" && list.authorUid !== "" ? list.authorUid : null;
}

export function snapshotOf(list: Record<string, unknown>): Snapshot {
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const url = (value: unknown): string | null =>
    typeof value === "string" && value.startsWith("https://") ? value : null;
  const tiers = Array.isArray(list.tiers) ? list.tiers : [];
  const items = Array.isArray(list.items) ? list.items : [];
  const editorial = isEditorialList(list);
  const snapshot: Snapshot = {
    title: text(list.title),
    ...(editorial ? { editorial: true } : {}),
    authorName: editorial ? "" : text(list.authorName),
    authorPhotoUrl: editorial ? null : url(list.authorPhotoUrl),
    category: text(list.category) || "other",
    tiers: tiers.map((tier: Record<string, unknown>) => ({
      label: text(tier.label),
      caption: typeof tier.caption === "string" ? tier.caption : null,
      colorLight: text(tier.colorLight),
      colorDark: text(tier.colorDark),
    })),
    // The credit goes with the picture: the ranking's page shows the same photographs.
    items: items.map((item: Record<string, unknown>) => ({
      title: text(item.title),
      imageUrl: url(item.imageUrl),
      tierIndex: typeof item.tierIndex === "number" ? item.tierIndex : null,
      ...(typeof item.credit === "string" && item.credit.trim() !== ""
        ? { credit: item.credit.trim() }
        : {}),
    })),
  };
  const translations = usedTranslations(list.translations, snapshot);
  const names = wordsOf(list.names);
  return {
    ...snapshot,
    ...(translations === null ? {} : { translations }),
    ...(names === null ? {} : { names }),
  };
}

/** A map of words to words, only the strings; null when nothing is left. */
function wordsOf(value: unknown, wanted?: ReadonlySet<string>): Record<string, string> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const words = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" &&
      entry[1].trim() !== "" &&
      (wanted === undefined || wanted.has(entry[0])),
  );
  return words.length === 0 ? null : Object.fromEntries(words);
}

/**
 * A house list's translations, cut to the words the snapshot has: the house
 * keeps every language's words for the whole list, and the ranking keeps
 * only what it can show, so it reads in the language its list page did.
 */
function usedTranslations(
  value: unknown,
  snapshot: Snapshot,
): Record<string, Record<string, string>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const used = new Set([
    snapshot.title,
    ...snapshot.tiers.flatMap((tier) =>
      tier.caption === null ? [tier.label] : [tier.label, tier.caption],
    ),
    ...snapshot.items.map((item) => item.title),
  ]);
  const languages = Object.entries(value).flatMap(([locale, words]) => {
    const kept = wordsOf(words, used);
    return kept === null ? [] : [[locale, kept] as const];
  });
  return languages.length === 0 ? null : Object.fromEntries(languages);
}

/**
 * The longest tier word a ranking keeps. The editors let a list's tiers carry
 * up to 80 characters, so a reader's placing can wear longer words; the site
 * cuts them to this before it sends a version started from that placing.
 */
export const MAX_TIER_LABEL_LENGTH = 40;

export type TierLabelsDecision = { ok: true; labels: (string | null)[] | null } | Refusal;

/**
 * The words a visitor's version wears on its tiers, when it started from
 * another reader's placing, as the app's Mine takes that reader's tiers:
 * one per tier, null or blank where a tier keeps the list's own. Left out,
 * every tier keeps the list's own words.
 */
export function decideTierLabels(body: unknown, tierCount: number): TierLabelsDecision {
  const labels = (body as { tierLabels?: unknown } | null)?.tierLabels;
  if (labels === undefined || labels === null) return { ok: true, labels: null };
  if (!Array.isArray(labels) || labels.length !== tierCount) {
    return refuse(400, "INVALID", "Tier words do not match the list's tiers");
  }
  const clean: (string | null)[] = [];
  for (const label of labels) {
    if (label !== null && typeof label !== "string") {
      return refuse(400, "INVALID", "A tier's word must be text");
    }
    const word = label?.trim() ?? "";
    if (word.length > MAX_TIER_LABEL_LENGTH)
      return refuse(400, "INVALID", "A tier's word is too long");
    clean.push(word === "" ? null : word);
  }
  return { ok: true, labels: clean };
}

/** The snapshot under a visitor's own tier words; a tier without one keeps what it has. */
export function withTierLabels(snapshot: Snapshot, labels: (string | null)[] | null): Snapshot {
  if (labels === null || labels.every((label) => label === null)) return snapshot;
  return {
    ...snapshot,
    tiers: snapshot.tiers.map((tier, index) => {
      const label = labels[index] ?? null;
      return label === null ? tier : { ...tier, label };
    }),
  };
}

/**
 * The snapshot as it is shown today. A ranking kept before its list became
 * editorial carries the author's name, and so does one whose list is gone:
 * unpublished, taken down for good or erased with its author's account,
 * which promises to take away everything they published. Either way the
 * name stays out of the answer; the visitor's own board stays.
 */
export function shownSnapshot(
  snapshot: Snapshot,
  list: { authorUid?: unknown; anonymous?: unknown } | null,
): Snapshot {
  if (snapshot.editorial !== true && list !== null && !isEditorialList(list)) return snapshot;
  return { ...snapshot, editorial: true, authorName: "", authorPhotoUrl: null };
}

/** Longer than any token the server hands out (32 characters of base64url). */
export const MAX_CLAIM_TOKEN_LENGTH = 64;

/** Only the hash is stored: a leaked document does not hand out the ranking. */
export const claimHashOf = (claimToken: string): string =>
  createHash("sha256").update(claimToken).digest("hex");

export function claimMatches(claimHash: string, claimToken: string): boolean {
  const stored = Buffer.from(claimHash);
  const offered = Buffer.from(claimHashOf(claimToken));
  return stored.length === offered.length && timingSafeEqual(stored, offered);
}

export function decideClaimToken(body: unknown): string | null {
  const token = (body as { claimToken?: unknown } | null)?.claimToken;
  return typeof token === "string" && token.length > 0 && token.length <= MAX_CLAIM_TOKEN_LENGTH
    ? token
    : null;
}

export interface StoredOwner {
  ownerUid: string | null;
  ownerAnonymous: boolean;
  claimHash: string;
}

export type ClaimDecision = { ok: true; write: boolean } | Refusal;

/**
 * Whether [uid], showing [claimToken], may keep the ranking. `write` says the
 * document must change hands, or stop calling its owner a guest: a guest who
 * signs in keeps the uid, so the same uid can still owe a claim.
 */
export function decideClaim(owner: StoredOwner, uid: string, claimToken: string): ClaimDecision {
  if (!claimMatches(owner.claimHash, claimToken)) {
    return refuse(403, "NOT_YOURS", "That token does not open this ranking");
  }
  if (owner.ownerUid === uid) return { ok: true, write: owner.ownerAnonymous };
  if (owner.ownerUid !== null && !owner.ownerAnonymous) {
    return refuse(409, "CLAIMED", "Already kept by another account");
  }
  return { ok: true, write: true };
}

/** The most rankings one person is shown; beyond that the answer says there are more. */
export const MY_RANKINGS_CAP = 200;

export interface RankingSummary {
  code: string;
  listId: string;
  title: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  placed: number;
  itemCount: number;
  imageUrl: string | null;
  createdAt: number;
}

/** The fields of a stored ranking these helpers read; a Firestore Timestamp fits createdAt. */
export interface StoredRanking {
  listId: string;
  snapshot: Snapshot;
  rows: unknown;
  createdAt?: { toMillis(): number };
  updatedAt?: { toMillis(): number };
}

export const placedCount = (rows: number[][]): number =>
  rows.reduce((sum, row) => sum + row.length, 0);

export const firstImageOf = (items: Snapshot["items"]): string | null =>
  items.find((item) => item.imageUrl?.startsWith("https://"))?.imageUrl ?? null;

/**
 * One ranking as a card on the person's own page: enough to recognise it, not
 * to draw it. [list] is what its list says of itself today, null when it is
 * gone: the author's name and photo follow shownSnapshot, as the ranking's
 * own page does, so a list made anonymous later names nobody here either.
 */
export function summaryOf(
  code: string,
  doc: StoredRanking,
  list: { authorUid?: unknown; anonymous?: unknown } | null,
): RankingSummary {
  const snapshot = shownSnapshot(doc.snapshot, list);
  return {
    code,
    listId: doc.listId,
    title: snapshot.title,
    authorName: snapshot.authorName,
    authorPhotoUrl: snapshot.authorPhotoUrl,
    category: snapshot.category,
    placed: placedCount(fromStoredRows(doc.rows)),
    itemCount: snapshot.items.length,
    imageUrl: firstImageOf(snapshot.items),
    createdAt: doc.createdAt?.toMillis() ?? 0,
  };
}

export const newestFirst = (rankings: readonly RankingSummary[]): RankingSummary[] =>
  [...rankings].sort((a, b) => b.createdAt - a.createdAt);
