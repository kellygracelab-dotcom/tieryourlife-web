import { createContext, useContext } from "react";
import type { MyList } from "../../api/lists";
import type { BeyondAccount } from "./model";
import type { PublishedEntry } from "./sync";

export type SyncStatus = "idle" | "syncing" | "stuck";

/**
 * A board the account said it will not keep, and why: too many tiers, too
 * many cards or too many in its trash, too big, or one board more than an
 * account holds. Trying again changes none of them, so the person is told
 * which board it is and what would let it go up.
 */
export interface SyncRefusal {
  uid: string;
  title: string;
  why: BeyondAccount | "tooLarge" | "tooManyBoards";
}

export interface BoardSyncControls {
  /** Whether there is an account to keep the boards in. */
  signedIn: boolean;
  backUp: boolean;
  setBackUp: (on: boolean) => Promise<void>;
  status: SyncStatus;
  lastSyncedAt: number | null;
  /** The boards the last finished run could not keep in the account for good reason. */
  refusals: readonly SyncRefusal[];
  syncNow: () => Promise<void>;
}

/** Pages rendered without the provider (tests, mostly) see nobody signed in. */
export const NOBODY: BoardSyncControls = {
  signedIn: false,
  backUp: true,
  setBackUp: () => Promise.resolve(),
  status: "idle",
  lastSyncedAt: null,
  refusals: [],
  syncNow: () => Promise.resolve(),
};

export const BoardSyncContext = createContext<BoardSyncControls>(NOBODY);

export const useBoardSync = (): BoardSyncControls => useContext(BoardSyncContext);

/** Thrown out of switching the back-up off when the account changed under it. */
export class AccountChanged extends Error {
  constructor() {
    super("the account changed");
    this.name = "AccountChanged";
  }
}

/**
 * One of `lists/mine`'s lists as the run reads it: the hold too, which only
 * the browser that published heard in the answer.
 */
export const publishedEntryOf = (list: MyList): PublishedEntry => ({
  id: list.id,
  boardUid: typeof list.boardUid === "string" && list.boardUid !== "" ? list.boardUid : null,
  updatedAt: list.updatedAt,
  underReview: list.underReview === true,
});
