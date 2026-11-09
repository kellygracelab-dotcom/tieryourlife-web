import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { BOARD_PREFIX, boardsRepository, type BoardsRepository } from "./repository";
import { BACKUP_KEY, backUpKey, SYNC_PREFIX, syncKey } from "./syncRecords";

/**
 * Whose boards this browser shows, the way the phone has done since its
 * #227: every board belongs to one account, or to nobody when it was made
 * without one. Signed out, only nobody's boards show; signed in, only the
 * account's. Nothing is deleted when somebody signs out: the account's
 * boards wait here, hidden, until it signs in again. A second person signing
 * in on the same browser never sees, nor uploads, the first one's boards.
 */

/** An account's boards; nobody's keep the keys every board had before owners. */
export const accountBoardPrefix = (owner: string): string => `tyl:board@${owner}:`;

const prefixOf = (owner: string | null): string =>
  owner === null ? BOARD_PREFIX : accountBoardPrefix(owner);

/** Who was shown last: "" for nobody. Absent until the first visit after owners. */
const OWNER_KEY = "tyl:owner";
/** The guest this browser had last, to tell a guest turned account from an account used before. */
const GUEST_KEY = "tyl:guest";
/** Set once every board from before owners has one. */
const SETTLED_KEY = "tyl:owners";

/** Somebody signed into an account used before while this browser had boards made without one. */
export interface GuestBoardsQuestion {
  owner: string;
  boards: number;
}

export interface Who {
  /** The account signed in, or null for a guest. */
  owner: string | null;
  /** The guest's own uid, when there is one. */
  guestUid: string | null;
}

export interface BoardOwners {
  /** The boards of whoever is here now; follows a change of owner. */
  readonly boards: BoardsRepository;
  /** One owner's boards, whoever is here: what a sync run writes into, so a late write never lands with the next owner. */
  of(owner: string | null): BoardsRepository;
  /** Firebase said who is here. */
  arrived(who: Who): void;
  /** The question about this browser's boards made without an account, while it waits. */
  question(): GuestBoardsQuestion | null;
  subscribeQuestion(listener: () => void): () => void;
  /** The boards made without an account become the account's, trash and all. */
  moveIn(owner: string, rename?: (title: string) => string | null): void;
  keepHere(): void;
  /** An account deleted: its boards and its records go from this browser too. */
  forget(owner: string): void;
}

const EMPTY: readonly never[] = [];

export function boardOwners(store: KeyValueStore): BoardOwners {
  const repositories = new Map<string, BoardsRepository>();
  const of = (owner: string | null): BoardsRepository => {
    const prefix = prefixOf(owner);
    let repository = repositories.get(prefix);
    if (repository === undefined) {
      repository = boardsRepository(store, prefix, owner);
      repositories.set(prefix, repository);
    }
    return repository;
  };

  const remembered = store.read(OWNER_KEY);
  let owner: string | null = remembered === null || remembered === "" ? null : remembered;
  // Until the boards from before owners have one, none is shown: a guest
  // must not see an account's boards, not even for the moment Firebase takes.
  let settled = store.read(SETTLED_KEY) !== null;
  let pending: GuestBoardsQuestion | null = null;

  const listeners = new Set<() => void>();
  const questionListeners = new Set<() => void>();
  let stopInner: (() => void) | null = null;
  const notify = () => listeners.forEach((listener) => listener());
  const follow = () => {
    stopInner?.();
    stopInner = listeners.size > 0 ? of(owner).subscribe(notify) : null;
  };
  const ask = (next: GuestBoardsQuestion | null) => {
    pending = next;
    questionListeners.forEach((listener) => listener());
  };

  const keysWith = (prefix: string): string[] =>
    (store.keys?.() ?? []).filter((key) => key.startsWith(prefix));

  /** A board's key moved to another owner's; the board itself is unchanged. */
  const move = (uid: string, from: string | null, to: string | null) => {
    const raw = store.read(`${prefixOf(from)}${uid}`);
    if (raw === null) return;
    // Nothing is taken from one owner until the other has it.
    if (store.write(`${prefixOf(to)}${uid}`, raw) === false) return;
    store.remove(`${prefixOf(from)}${uid}`);
  };

  const recordsOf = (account: string): Record<string, unknown> => {
    try {
      const kept = JSON.parse(store.read(syncKey(account)) ?? "null") as {
        records?: Record<string, unknown>;
      } | null;
      return kept?.records ?? {};
    } catch {
      return {};
    }
  };

  const dropRecord = (account: string, uid: string) => {
    const text = store.read(syncKey(account));
    if (text === null) return;
    try {
      const kept = JSON.parse(text) as { records?: Record<string, unknown> };
      if (kept.records === undefined || !(uid in kept.records)) return;
      delete kept.records[uid];
      store.write(syncKey(account), JSON.stringify(kept));
    } catch {
      // A record that does not parse is read as none anyway.
    }
  };

  /**
   * Gives each board from before owners its owner, once: the one account
   * that agreed on it here; with several, the one signed in if it is among
   * them, else the first; with none, whoever is signed in, or nobody. The
   * accounts that lost a board drop their record of it, so their next run
   * brings it down as a copy instead of reading it as thrown away here.
   */
  const settle = (signedIn: string | null) => {
    const accounts = keysWith(SYNC_PREFIX).map((key) => key.slice(SYNC_PREFIX.length));
    const agreed = new Map(accounts.map((account) => [account, recordsOf(account)]));
    for (const key of keysWith(BOARD_PREFIX)) {
      const uid = key.slice(BOARD_PREFIX.length);
      const claimants = accounts.filter((account) => uid in (agreed.get(account) ?? {}));
      const to =
        claimants.length === 0
          ? signedIn
          : signedIn !== null && claimants.includes(signedIn)
            ? signedIn
            : (claimants[0] ?? null);
      if (to !== null) move(uid, null, to);
      for (const account of claimants) if (account !== to) dropRecord(account, uid);
    }
    // The back-up switch was the browser's; it becomes the account's that is here.
    if (store.read(BACKUP_KEY) === "off" && signedIn !== null) {
      store.write(backUpKey(signedIn), "off");
    }
    store.remove(BACKUP_KEY);
    store.write(SETTLED_KEY, "1");
    settled = true;
  };

  const liveGuestBoards = (): number =>
    of(null)
      .all()
      .filter((board) => board.deletedAt === null).length;

  const moveIn = (to: string, rename?: (title: string) => string | null) => {
    for (const key of keysWith(BOARD_PREFIX)) {
      const uid = key.slice(BOARD_PREFIX.length);
      const board = of(null).get(uid);
      const title = board === null || rename === undefined ? null : rename(board.title);
      if (board !== null && title !== null) of(null).save({ ...board, title });
      move(uid, null, to);
    }
    of(null).reread();
    of(to).reread();
    ask(null);
  };

  const boards: BoardsRepository = {
    all: () => (settled ? of(owner).all() : EMPTY),
    get: (uid) => (settled ? of(owner).get(uid) : null),
    save: (board) => of(owner).save(board),
    saveAll: (all) => of(owner).saveAll(all),
    remove: (uid) => of(owner).remove(uid),
    kept: (uid) => settled && of(owner).kept(uid),
    reread: () => of(owner).reread(),
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) follow();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) follow();
      };
    },
  };

  return {
    boards,
    of,
    arrived({ owner: next, guestUid }) {
      const before = store.read(OWNER_KEY);
      if (!settled) settle(next);
      if (next === null) {
        // A new guest on a browser that still holds an earlier guest's boards
        // (one kept here by somebody who signed into an account, then out)
        // did not make them: the browser keeps the guest they came from, so
        // an account this guest turns into is asked, as any other, rather
        // than handed somebody else's boards unasked.
        const earlier = store.read(GUEST_KEY);
        const theirs = earlier === null || earlier === guestUid || of(null).all().length === 0;
        if (guestUid !== null && theirs) store.write(GUEST_KEY, guestUid);
        if (pending !== null) ask(null);
      } else if (store.read(GUEST_KEY) === next) {
        // The guest became the account: the same person, so their boards go with them unasked.
        moveIn(next);
        store.remove(GUEST_KEY);
      } else if (before === "" && liveGuestBoards() > 0) {
        // An account used before may be somebody else's: asked, and only on the sign-in itself.
        ask({ owner: next, boards: liveGuestBoards() });
      }
      store.write(OWNER_KEY, next ?? "");
      if (next !== owner) {
        owner = next;
        if (listeners.size > 0) follow();
      }
      notify();
    },
    question: () => pending,
    subscribeQuestion(listener) {
      questionListeners.add(listener);
      return () => questionListeners.delete(listener);
    },
    moveIn,
    keepHere: () => ask(null),
    forget(gone) {
      for (const key of keysWith(accountBoardPrefix(gone))) store.remove(key);
      store.remove(syncKey(gone));
      store.remove(backUpKey(gone));
      of(gone).reread();
    },
  };
}

/** The site's own. */
export const owners: BoardOwners = boardOwners(localStorageStore);

/** This browser's boards, of whoever is here now. */
export const boards: BoardsRepository = owners.boards;
