import type { KeyValueStore } from "../../lib/storage";
import type { SyncedBoard } from "./syncPlan";

/**
 * What this device wrote down the last time it and an account agreed about
 * a board, one record per board, per account: a second account signing in
 * on the same browser must not inherit the first one's agreements.
 */
export const SYNC_PREFIX = "tyl:boardsync:";
/** Where the back-up switch was kept when it was the browser's, not the account's. */
export const BACKUP_KEY = "tyl:backup";
export const backUpKey = (accountUid: string): string => `${BACKUP_KEY}@${accountUid}`;

export const syncKey = (accountUid: string): string => `${SYNC_PREFIX}${accountUid}`;

interface Kept {
  records: Record<string, Omit<SyncedBoard, "uid">>;
  /** When the last complete run ended; a partial run leaves it, which is what the stuck note reports. */
  lastSyncedAt: number | null;
}

const EMPTY: Kept = { records: {}, lastSyncedAt: null };

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
        records[uid] = {
          revision: record.revision,
          fingerprint: record.fingerprint,
          ...(typeof record.remoteFingerprint === "string"
            ? { remoteFingerprint: record.remoteFingerprint }
            : {}),
        };
      }
    }
    return {
      records,
      lastSyncedAt: typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : null,
    };
  } catch {
    return EMPTY;
  }
}

export interface SyncRecords {
  all(): SyncedBoard[];
  /**
   * `forVisit` keeps the record in memory only, for a board the browser holds
   * for this visit and would not keep: agreed on while it is here, and gone
   * with it after a reload, so the next visit never reads it as thrown away.
   */
  remember(record: SyncedBoard, forVisit?: boolean): void;
  forget(uid: string): void;
  lastSyncedAt(): number | null;
  markSynced(at: number): void;
  /** Everything about this account forgotten, as when backing up is switched off. */
  clear(): void;
}

export function syncRecords(store: KeyValueStore, accountUid: string): SyncRecords {
  const write = (kept: Kept) => store.write(syncKey(accountUid), JSON.stringify(kept));
  const change = (apply: (kept: Kept) => Kept) => write(apply(read(store, accountUid)));
  const visit = new Map<string, SyncedBoard>();
  return {
    all: () => {
      const kept = Object.entries(read(store, accountUid).records)
        .filter(([uid]) => !visit.has(uid))
        .map(([uid, record]) => ({ uid, ...record }));
      return [...kept, ...visit.values()];
    },
    remember: (record, forVisit = false) => {
      if (forVisit) {
        visit.set(record.uid, { ...record });
        return;
      }
      visit.delete(record.uid);
      change((kept) => ({
        ...kept,
        records: {
          ...kept.records,
          [record.uid]: {
            revision: record.revision,
            fingerprint: record.fingerprint,
            remoteFingerprint: record.remoteFingerprint,
          },
        },
      }));
    },
    forget: (uid) => {
      visit.delete(uid);
      change((kept) => {
        const { [uid]: _gone, ...records } = kept.records;
        return { ...kept, records };
      });
    },
    lastSyncedAt: () => read(store, accountUid).lastSyncedAt,
    markSynced: (at) => change((kept) => ({ ...kept, lastSyncedAt: at })),
    clear: () => {
      visit.clear();
      store.remove(syncKey(accountUid));
    },
  };
}

/** On unless this account switched it off here; one person's switch never stops the next one's back-up. */
export const readBackUp = (store: KeyValueStore, accountUid: string): boolean =>
  store.read(backUpKey(accountUid)) !== "off";

export function keepBackUp(store: KeyValueStore, accountUid: string, on: boolean): void {
  if (on) store.remove(backUpKey(accountUid));
  else store.write(backUpKey(accountUid), "off");
}
