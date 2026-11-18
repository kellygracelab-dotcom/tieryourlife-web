import type { SyncedPlay } from "./boards";
import type { ApiClient } from "./client";

/**
 * Lists of somebody else's begun and not yet put anywhere, kept with the
 * account so "Continue" is the same on the phone and here (CONTRACT, shared
 * Continue, 18.11.2026): `/boards/started`, the person's own only.
 */

/** Why a begun list left Continue everywhere: Discard, Save my list, every card placed, or the account's limit. */
export type StartedRemoval = "discard" | "saved" | "done" | "evicted";

/** What a begun list is, as the account keeps it. */
export interface StartedContent {
  /** When it was changed on the device, by the device's clock: the later one wins. */
  changedAt: number;
  /** The published list's updatedAt the arrangement was made on. */
  listVersion: number;
  itemCount: number;
  tierCount: number;
  title: string;
  picture: string | null;
  pictures: string[];
  category: string | null;
  rows: number[][];
  labels?: (string | null)[];
  poolOrder?: number[];
  /** A game over the list: its cards are their places in the list, its tiers theirs, the pool "pool". */
  play: SyncedPlay | null;
}

export interface StartedList extends StartedContent {
  listId: string;
  /** The version, by the server's clock: higher with every write of this list. */
  updatedAt: number;
  placed: number;
}

/** A begun list gone from Continue, said so the other devices let theirs go too. */
export interface StartedTombstone {
  listId: string;
  updatedAt: number;
  changedAt: number;
  removed: StartedRemoval;
}

export type StartedRecord = StartedList | StartedTombstone;

export const isTombstone = (record: StartedRecord): record is StartedTombstone =>
  "removed" in record;

export interface StartedPage {
  started: StartedList[];
  removed: StartedTombstone[];
  now: number;
}

const REMOVALS: readonly string[] = ["discard", "saved", "done", "evicted"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isText = (value: unknown): value is string => typeof value === "string";

/** One record from the server, checked: a list, a tombstone, or null for anything else. */
export function startedRecordOf(value: unknown): StartedRecord | null {
  if (!isRecord(value) || !isText(value.listId) || value.listId === "") return null;
  if (!isCount(value.updatedAt) || !isCount(value.changedAt)) return null;
  if (isText(value.removed)) {
    if (!REMOVALS.includes(value.removed)) return null;
    return {
      listId: value.listId,
      updatedAt: value.updatedAt,
      changedAt: value.changedAt,
      removed: value.removed as StartedRemoval,
    };
  }
  const { itemCount, tierCount, rows } = value;
  if (!isCount(itemCount) || !isCount(tierCount) || !isCount(value.listVersion)) return null;
  if (!isText(value.title) || !Array.isArray(rows) || rows.length !== tierCount) return null;
  if (!rows.every((row) => Array.isArray(row) && row.every(isCount))) return null;
  const pictures = Array.isArray(value.pictures) ? value.pictures.filter(isText) : [];
  const labels =
    Array.isArray(value.labels) && value.labels.length === tierCount
      ? value.labels.map((label) => (isText(label) ? label : null))
      : undefined;
  const poolOrder =
    Array.isArray(value.poolOrder) && value.poolOrder.every(isCount)
      ? (value.poolOrder as number[])
      : undefined;
  return {
    listId: value.listId,
    updatedAt: value.updatedAt,
    changedAt: value.changedAt,
    listVersion: value.listVersion,
    itemCount,
    tierCount,
    title: value.title,
    picture: isText(value.picture) ? value.picture : null,
    pictures,
    category: isText(value.category) ? value.category : null,
    rows: rows as number[][],
    ...(labels === undefined ? {} : { labels }),
    ...(poolOrder === undefined ? {} : { poolOrder }),
    placed: isCount(value.placed) ? value.placed : rows.flat().length,
    play: isRecord(value.play) ? (value.play as unknown as SyncedPlay) : null,
  };
}

/** What changed after `since`, or everything (tombstones younger than 30 days among it) without it. */
export async function loadStarted(client: ApiClient, since: number | null): Promise<StartedPage> {
  const answer = await client.request<{ started?: unknown; removed?: unknown; now?: unknown }>(
    "GET",
    "/boards/started",
    since === null ? {} : { query: { since } },
  );
  const records = [
    ...(Array.isArray(answer.started) ? answer.started : []),
    ...(Array.isArray(answer.removed) ? answer.removed : []),
  ].flatMap((value) => {
    const record = startedRecordOf(value);
    return record === null ? [] : [record];
  });
  return {
    started: records.filter((record): record is StartedList => !isTombstone(record)),
    removed: records.filter(isTombstone),
    now: isCount(answer.now) ? answer.now : 0,
  };
}

/**
 * Writes a begun list. `basedOn` is the version this device started from,
 * null when it had none (begun here, or begun as a guest before signing in).
 * A 409 CONFLICT carries the server's record in its `started`.
 */
export async function keepStarted(
  client: ApiClient,
  listId: string,
  content: StartedContent,
  basedOn: number | null,
): Promise<{ updatedAt: number; placed: number }> {
  const answer = await client.request<{ updatedAt: number; placed: number }>(
    "PUT",
    `/boards/started/${encodeURIComponent(listId)}`,
    { body: { ...content, basedOn } },
  );
  return { updatedAt: answer.updatedAt, placed: answer.placed };
}

/** Takes a begun list out of Continue everywhere; Undo is keepStarted with the answer's updatedAt. */
export async function forgetStarted(
  client: ApiClient,
  listId: string,
  reason: Exclude<StartedRemoval, "evicted">,
  basedOn: number | null,
  changedAt: number,
): Promise<{ updatedAt: number }> {
  const answer = await client.request<{ updatedAt: number }>(
    "DELETE",
    `/boards/started/${encodeURIComponent(listId)}`,
    {
      query: {
        reason,
        ...(basedOn === null ? {} : { basedOn }),
        changedAt,
      },
    },
  );
  return { updatedAt: answer.updatedAt };
}
