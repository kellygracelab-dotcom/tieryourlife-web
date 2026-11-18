import type { ApiError } from "../../api/errors";
import {
  isTombstone,
  type StartedContent,
  type StartedList,
  type StartedPage,
  type StartedRecord,
  type StartedRemoval,
} from "../../api/started";
import type { KeyValueStore } from "../../lib/storage";
import { decodeGame, encodeGame, EXPIRES_AFTER, playKey } from "../play/savedGames";
import { fromSynced, toSynced } from "../play/syncedGames";
import { KEPT_PREFIX } from "../ranking/kept";
import { draftKey, type Draft } from "../tierboard/draft";

/**
 * The begun lists of a signed-in person, kept with the account so Continue is
 * the same on the phone and here (shared Continue, 18.11.2026). This browser's
 * drafts and games stay where they were, the source of everything shown; a run
 * of this engine takes what changed on the account into them, and sends up
 * what changed here. The later change wins; a version of this device's that
 * lost is said so, never dropped quietly.
 */

/** A game's tiers are their places in the list, its pool this. */
const POOL = "pool";
const DRAFT_PREFIX = "tyl:draft:";
const gameKey = (listId: string) => playKey(`list:${listId}`);
/** What this device knows of the account's copies, per account. */
export const startedSyncKey = (uid: string) => `tyl:started-sync:${uid}`;

export interface StartedApi {
  load(since: number | null): Promise<StartedPage>;
  keep(
    listId: string,
    content: StartedContent,
    basedOn: number | null,
  ): Promise<{ updatedAt: number }>;
  forget(
    listId: string,
    reason: Exclude<StartedRemoval, "evicted">,
    basedOn: number | null,
    changedAt: number,
  ): Promise<{ updatedAt: number }>;
}

/** One list as the account last had it here. */
interface Known {
  /** The account's version this device last saw or wrote; null while the account has none of it. */
  updatedAt: number | null;
  /** The account has it as a tombstone. */
  removed?: true;
  /** What of this device's the account has, to tell a change here from none. */
  pushed?: string;
  /** Kept out of Continue here (saved to one's own, or done): taken neither in nor away. */
  aside?: true;
}

interface Memory {
  /** The highest version seen in a read: the next one asks only for what is newer. */
  since: number | null;
  lists: Record<string, Known>;
}

function readMemory(store: KeyValueStore, uid: string): Memory {
  try {
    const value: unknown = JSON.parse(store.read(startedSyncKey(uid)) ?? "null");
    if (typeof value === "object" && value !== null && "lists" in value) {
      const memory = value as Memory;
      return {
        since: typeof memory.since === "number" ? memory.since : null,
        lists: typeof memory.lists === "object" && memory.lists !== null ? memory.lists : {},
      };
    }
  } catch {
    // A memory that cannot be read is none: everything is read afresh.
  }
  return { since: null, lists: {} };
}

/** A begun list as this device has it. */
interface Local {
  content: StartedContent;
  /** Its content but for when, to tell a change from a save of the same. */
  print: string;
  /** In Continue here: a card placed, not all, not saved, not done. */
  shown: boolean;
  /** Why it is not, when it is not. */
  reason: Exclude<StartedRemoval, "evicted">;
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parse(text: string | null): Partial<Draft> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Partial<Draft>)
      : null;
  } catch {
    return null;
  }
}

const printOf = ({ changedAt: _changedAt, ...rest }: StartedContent): string =>
  JSON.stringify(rest);

/** This device's draft of a list, and the game over it, as the account would keep them. */
function localOf(
  store: KeyValueStore,
  listId: string,
  saved: ReadonlySet<string>,
  now: number,
): Local | null {
  const draft = parse(store.read(draftKey(listId)));
  if (draft === null || draft.listId !== listId || typeof draft.title !== "string") return null;
  const { rows, itemCount, updatedAt } = draft;
  if (!isCount(itemCount) || !isCount(updatedAt) || !Array.isArray(rows)) return null;
  if (!rows.every((row) => Array.isArray(row) && row.every(isCount))) return null;
  let play = null;
  let gameAt = 0;
  const text = store.read(gameKey(listId));
  const game = text === null ? null : decodeGame(text);
  if (
    game !== null &&
    now - game.savedAt <= EXPIRES_AFTER &&
    (game.snapshot === null || game.snapshot === `${updatedAt}:${itemCount}`)
  ) {
    play = toSynced(game.game, POOL, now);
    gameAt = game.savedAt;
  }
  const content: StartedContent = {
    changedAt: Math.max(isCount(draft.savedAt) ? draft.savedAt : 0, gameAt),
    listVersion: updatedAt,
    itemCount,
    tierCount: rows.length,
    title: draft.title,
    picture: typeof draft.picture === "string" ? draft.picture : null,
    pictures: Array.isArray(draft.pictures)
      ? draft.pictures.filter((url): url is string => typeof url === "string").slice(0, 3)
      : [],
    category: typeof draft.category === "string" ? draft.category : null,
    rows: rows.map((row) => [...row]),
    ...(Array.isArray(draft.labels) ? { labels: [...draft.labels] } : {}),
    ...(Array.isArray(draft.poolOrder) ? { poolOrder: [...draft.poolOrder] } : {}),
    play,
  };
  const placed = rows.reduce((sum, row) => sum + row.length, 0);
  const kept = store.read(`${KEPT_PREFIX}${listId}`) !== null;
  const reason = saved.has(listId) ? "saved" : kept || placed >= itemCount ? "done" : "discard";
  return {
    content,
    print: printOf(content),
    shown: placed > 0 && placed < itemCount && !saved.has(listId) && !kept,
    reason,
  };
}

/** The account's begun list put here: the draft and the game, as the list's page reads them. */
function writeHere(store: KeyValueStore, list: StartedList): void {
  const draft: Draft = {
    listId: list.listId,
    updatedAt: list.listVersion,
    itemCount: list.itemCount,
    title: list.title,
    picture: list.picture,
    ...(list.category === null ? {} : { category: list.category }),
    pictures: list.pictures,
    savedAt: list.changedAt,
    ...(list.poolOrder === undefined ? {} : { poolOrder: list.poolOrder }),
    rows: list.rows.map((row) => [...row]),
    ...(list.labels === undefined ? {} : { labels: list.labels }),
  };
  store.write(draftKey(list.listId), JSON.stringify(draft));
  if (list.play === null) store.remove(gameKey(list.listId));
  else
    store.write(
      gameKey(list.listId),
      encodeGame(
        fromSynced(list.play, POOL),
        list.changedAt,
        `${list.listVersion}:${list.itemCount}`,
      ),
    );
}

function removeHere(store: KeyValueStore, listId: string): void {
  store.remove(draftKey(listId));
  store.remove(gameKey(listId));
}

export interface StartedSyncReport {
  /** Lists whose version here gave way to another device's: "Updated from another device". */
  replaced: number;
  /** Something here changed: Continue draws again. */
  changed: boolean;
  /** The run stopped before the end: offline, signed out, or a server without the routes. */
  stopped: boolean;
}

/** The kind of a failed request, or null for anything that was not one. */
const failureOf = (reason: unknown): ApiError | null =>
  typeof reason === "object" && reason !== null && "error" in reason
    ? ((reason as { error: ApiError }).error ?? null)
    : null;

/** A refusal of this list only: what it holds will not do, and is not sent again until it changes. */
const refusedOnly = (error: ApiError | null) =>
  error !== null && (error.kind === "invalid" || error.kind === "tooLarge");

class Stop extends Error {}

export async function syncStarted({
  store,
  uid,
  api,
  saved,
  now = Date.now(),
  stillWanted = () => true,
  startedRecordOf,
}: {
  store: KeyValueStore;
  uid: string;
  api: StartedApi;
  /** Lists saved to one's own: out of Continue, and out of it everywhere. */
  saved: ReadonlySet<string>;
  now?: number;
  /** Asked before every write: false once the account changed or the page closed. */
  stillWanted?: () => boolean;
  /** Reads the record a 409 carries. */
  startedRecordOf: (value: unknown) => StartedRecord | null;
}): Promise<StartedSyncReport> {
  const memory = readMemory(store, uid);
  const report: StartedSyncReport = { replaced: 0, changed: false, stopped: false };
  const remember = () => {
    if (!stillWanted()) throw new Stop();
    store.write(startedSyncKey(uid), JSON.stringify(memory));
  };

  /** The account's record taken in here; `forced` when this device's version lost a write. */
  const takeIn = (record: StartedRecord, forced: boolean) => {
    if (!stillWanted()) throw new Stop();
    const { listId } = record;
    const here = localOf(store, listId, saved, now);
    const known = memory.lists[listId];
    if (!forced) {
      if (known !== undefined && known.updatedAt === record.updatedAt) return;
      const dirty =
        here !== null &&
        here.shown &&
        (known === undefined || known.removed === true || known.pushed !== here.print);
      // Changed here later than there: this one goes up next, over that version.
      if (dirty && here.content.changedAt > record.changedAt) {
        memory.lists[listId] = { ...known, updatedAt: record.updatedAt };
        return;
      }
    }
    if (isTombstone(record)) {
      if (here !== null && here.shown) {
        removeHere(store, listId);
        report.changed = true;
        // Continued here, taken away there meanwhile: said, as any version of this device's that lost.
        if (forced) report.replaced++;
      }
      memory.lists[listId] = { updatedAt: record.updatedAt, removed: true };
      return;
    }
    // Saved to one's own or done here: Continue has nothing to show of it here, nor to take away there.
    if (here !== null && !here.shown && here.reason !== "discard") {
      memory.lists[listId] = { updatedAt: record.updatedAt, aside: true };
      return;
    }
    writeHere(store, record);
    report.changed = true;
    const after = localOf(store, listId, saved, now);
    // A version of this device's gave way: a write of its that lost, or one shown here that changed there.
    if (forced || (here !== null && here.shown && here.print !== after?.print)) report.replaced++;
    memory.lists[listId] = { updatedAt: record.updatedAt, pushed: after?.print ?? "" };
  };

  /** A write that lost: the account's version comes here, or the run stops for anything else. */
  const lost = (reason: unknown, listId: string, print: string | null) => {
    const error = failureOf(reason);
    if (error?.kind === "conflict") {
      const record = startedRecordOf(error.started);
      if (record !== null && record.listId === listId) {
        takeIn(record, true);
        return;
      }
    }
    if (refusedOnly(error) && print !== null) {
      memory.lists[listId] = { updatedAt: memory.lists[listId]?.updatedAt ?? null, pushed: print };
      return;
    }
    throw new Stop();
  };

  try {
    const page = await api.load(memory.since);
    for (const record of [...page.started, ...page.removed].sort(
      (a, b) => a.updatedAt - b.updatedAt,
    )) {
      takeIn(record, false);
      memory.since = Math.max(memory.since ?? 0, record.updatedAt);
    }
    remember();

    const ids = new Set([
      ...(store.keys?.() ?? [])
        .filter((key) => key.startsWith(DRAFT_PREFIX))
        .map((key) => key.slice(DRAFT_PREFIX.length)),
      ...Object.keys(memory.lists),
    ]);
    for (const listId of ids) {
      const here = localOf(store, listId, saved, now);
      const known = memory.lists[listId];
      if (here !== null && here.shown) {
        if (known !== undefined && !known.removed && !known.aside && known.pushed === here.print) {
          continue;
        }
        try {
          const answer = await api.keep(listId, here.content, known?.updatedAt ?? null);
          memory.lists[listId] = { updatedAt: answer.updatedAt, pushed: here.print };
        } catch (reason) {
          lost(reason, listId, here.print);
        }
        remember();
        continue;
      }
      // Gone from Continue here, there still: it goes there too, saying why.
      if (known === undefined || known.removed || known.aside || known.pushed === undefined) {
        continue;
      }
      const reason = here?.reason ?? "discard";
      try {
        const answer = await api.forget(listId, reason, known.updatedAt, now);
        memory.lists[listId] = { updatedAt: answer.updatedAt, removed: true };
      } catch (failure) {
        lost(failure, listId, null);
      }
      remember();
    }
  } catch (reason) {
    if (!(reason instanceof Stop) && failureOf(reason) === null) throw reason;
    report.stopped = true;
    if (stillWanted()) store.write(startedSyncKey(uid), JSON.stringify(memory));
  }
  return report;
}
