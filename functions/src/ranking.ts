/**
 * The rules of a visitor's ranking. Pure, like quota.ts in the backend
 * repository: no Firestore, no clock, no randomness of its own. web.ts turns
 * these decisions into reads and writes.
 */

/** No 0/O, 1/l/I: a code is read off a stream and typed by hand. */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const CODE_LENGTH = 8;

export const MAX_BODY_BYTES = 64 * 1024;

/** One person, one ranking every couple of seconds. Anything faster is a script. */
export const MIN_WRITE_GAP_MS = 2000;

/**
 * Rankings the whole site accepts in one UTC day. Not a business rule: set
 * far above honest use and treat it tripping as an alarm.
 */
export const DAILY_CEILING = 5000;

export const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** Firestore ids, and nothing that could be a path. */
const LIST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface Snapshot {
  title: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  tiers: { label: string; caption: string | null; colorLight: string; colorDark: string }[];
  items: { title: string; imageUrl: string | null; tierIndex: number | null }[];
}

export type RankDecision =
  | { ok: true; listId: string; rows: number[][] }
  | { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string): RankDecision => ({
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
export function decideRows(body: unknown, tierCount: number, itemCount: number): RankDecision {
  const source = body as { listId?: unknown; rows?: unknown } | null;
  const listId = decideListId(source);
  if (listId === null) return refuse(400, "INVALID", "Which list?");

  const rows = source?.rows;
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
  return { ok: true, listId, rows: clean };
}

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

/** The snapshot a ranking keeps: enough to draw the board after the list is gone. */
export function snapshotOf(list: Record<string, unknown>): Snapshot {
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const url = (value: unknown): string | null =>
    typeof value === "string" && value.startsWith("https://") ? value : null;
  const tiers = Array.isArray(list.tiers) ? list.tiers : [];
  const items = Array.isArray(list.items) ? list.items : [];
  return {
    title: text(list.title),
    authorName: text(list.authorName),
    authorPhotoUrl: url(list.authorPhotoUrl),
    category: text(list.category) || "other",
    tiers: tiers.map((tier: Record<string, unknown>) => ({
      label: text(tier.label),
      caption: typeof tier.caption === "string" ? tier.caption : null,
      colorLight: text(tier.colorLight),
      colorDark: text(tier.colorDark),
    })),
    items: items.map((item: Record<string, unknown>) => ({
      title: text(item.title),
      imageUrl: url(item.imageUrl),
      tierIndex: typeof item.tierIndex === "number" ? item.tierIndex : null,
    })),
  };
}
