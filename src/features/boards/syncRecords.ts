import type { KeyValueStore } from "../../lib/storage";
import type { SyncedBoard } from "./syncPlan";

/**
 * What this device wrote down the last time it and an account agreed about
 * a board, one record per board, per account: a second account signing in
 * on the same browser must not inherit the first one's agreements.
 */
export const SYNC_PREFIX = "tyl:boardsync:";
export const BACKUP_KEY = "tyl:backup";

export const syncKey = (accountUid: string): string => `${SYNC_PREFIX}${accountUid}`;

interface Kept {
  records: Record<string, { revision: number; fingerprint: string }>;
  /** When the last complete run ended; a partial run leaves it, which is what the stuck note reports. */
  lastSyncedAt: number | null;
  /** True once the question about boards on both sides was answered, or never arose. */
  merged: boolean;
}

const EMPTY: Kept = { records: {}, lastSyncedAt: null, merged: false };

function read(store: KeyValueStore, accountUid: string): Kept {
  const text = store.read(syncKey(accountUid));
  if (text === null) return EMPTY;
  try {
    const parsed = JSON.parse(text) as Partial<Kept> | null;
    if (parsed === null || typeof parsed !== "object") return EMPTY;
    const records: Kept["records"] = {};
    for (const [uid, record] of Object.entries(parsed.records ?? {})) {
      if (
        record !== null &&
        typeof record === "object" &&
        typeof record.revision === "number" &&
        typeof record.fingerprint === "string"
      ) {
        records[uid] = { revision: record.revision, fingerprint: record.fingerprint };
      }
    }
    return {
      records,
      lastSyncedAt: typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : null,
      merged: parsed.merged === true,
    };
  } catch {
    return EMPTY;
  }
}

export interface SyncRecords {
  all(): SyncedBoard[];
  remember(record: SyncedBoard): void;
  forget(uid: string): void;
  lastSyncedAt(): number | null;
  markSynced(at: number): void;
  merged(): boolean;
  markMerged(): void;
  /** Everything about this account forgotten, as when backing up is switched off. */
  clear(): void;
}

export function syncRecords(store: KeyValueStore, accountUid: string): SyncRecords {
  const write = (kept: Kept) => store.write(syncKey(accountUid), JSON.stringify(kept));
  const change = (apply: (kept: Kept) => Kept) => write(apply(read(store, accountUid)));
  return {
    all: () =>
      Object.entries(read(store, accountUid).records).map(([uid, record]) => ({ uid, ...record })),
    remember: (record) =>
      change((kept) => ({
        ...kept,
        records: {
          ...kept.records,
          [record.uid]: { revision: record.revision, fingerprint: record.fingerprint },
        },
      })),
    forget: (uid) =>
      change((kept) => {
        const { [uid]: _gone, ...records } = kept.records;
        return { ...kept, records };
      }),
    lastSyncedAt: () => read(store, accountUid).lastSyncedAt,
    markSynced: (at) => change((kept) => ({ ...kept, lastSyncedAt: at })),
    merged: () => read(store, accountUid).merged,
    markMerged: () => change((kept) => ({ ...kept, merged: true })),
    clear: () => store.remove(syncKey(accountUid)),
  };
}

/** On unless switched off; consulted only once signed in. */
export const readBackUp = (store: KeyValueStore): boolean => store.read(BACKUP_KEY) !== "off";

export const keepBackUp = (store: KeyValueStore, on: boolean): void =>
  on ? store.remove(BACKUP_KEY) : store.write(BACKUP_KEY, "off");
