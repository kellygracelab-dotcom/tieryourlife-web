import { useCallback, useSyncExternalStore } from "react";
import type { Board } from "./model";
import { boards as site, type BoardsRepository } from "./repository";

/** Every board this device keeps, trash included; the page re-renders when one changes. */
export function useBoards(repository: BoardsRepository = site): readonly Board[] {
  return useSyncExternalStore(repository.subscribe, repository.all, repository.all);
}

/** One board by uid, or null when there is none; follows every change to it. */
export function useBoard(uid: string, repository: BoardsRepository = site): Board | null {
  const read = useCallback(() => repository.get(uid), [repository, uid]);
  return useSyncExternalStore(repository.subscribe, read, read);
}

/** Uids the way the phone makes them, so a board from here and one from there never collide. */
export const nextUid = (): string => crypto.randomUUID();
