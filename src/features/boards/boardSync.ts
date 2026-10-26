import { createContext, useContext } from "react";

/** What to do when somebody signs into an account that already has boards; only a question when both sides hold something. */
export interface MergeChoice {
  accountBoards: number;
  localBoards: number;
}

export type SyncStatus = "idle" | "syncing" | "stuck";

export interface BoardSyncControls {
  /** Whether there is an account to keep the boards in. */
  signedIn: boolean;
  backUp: boolean;
  setBackUp: (on: boolean) => Promise<void>;
  status: SyncStatus;
  lastSyncedAt: number | null;
  syncNow: () => Promise<void>;
  merge: MergeChoice | null;
  decideMerge: (choice: "keep" | "account") => Promise<void>;
}

/** Pages rendered without the provider (tests, mostly) see nobody signed in. */
export const NOBODY: BoardSyncControls = {
  signedIn: false,
  backUp: true,
  setBackUp: () => Promise.resolve(),
  status: "idle",
  lastSyncedAt: null,
  syncNow: () => Promise.resolve(),
  merge: null,
  decideMerge: () => Promise.resolve(),
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
