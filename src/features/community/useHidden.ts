import { useCallback, useSyncExternalStore } from "react";
import { localStorageStore } from "../board/draft";
import {
  NOTHING_HIDDEN,
  readHidden,
  withAuthor,
  withList,
  withoutAuthor,
  withoutList,
  writeHidden,
  type Hidden,
  type HiddenAuthor,
  type HiddenList,
  type HiddenStore,
} from "./hidden";

/**
 * One copy of what is hidden for every page on screen: the feed loses a card
 * the moment the list page hides it, and Settings shows it at once. What was
 * hidden during this visit is also remembered, so a card can keep its place
 * with an Undo instead of vanishing; after a reload it is simply gone.
 */
let store: HiddenStore = localStorageStore;
let current: Hidden = readHidden(store);
let thisVisit: readonly string[] = [];
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => current;
const visitSnapshot = () => thisVisit;

function change(next: Hidden): void {
  if (next === current) return;
  current = next;
  writeHidden(store, next);
  listeners.forEach((listener) => listener());
}

/** Tests keep their own store; the page keeps the browser's. */
export function useHiddenStoreForTests(replacement: HiddenStore): void {
  store = replacement;
  current = readHidden(store);
  thisVisit = [];
  listeners.forEach((listener) => listener());
}

export interface HiddenControls {
  hidden: Hidden;
  /** Ids of lists hidden during this visit, which the feed shows as a tile with Undo. */
  hiddenThisVisit: readonly string[];
  hideList: (list: HiddenList) => void;
  showList: (id: string) => void;
  hideAuthor: (author: HiddenAuthor) => void;
  showAuthor: (uid: string) => void;
}

export function useHidden(): HiddenControls {
  const hidden = useSyncExternalStore(subscribe, snapshot, () => NOTHING_HIDDEN);
  const hiddenThisVisit = useSyncExternalStore(subscribe, visitSnapshot, () => thisVisit);
  const hideList = useCallback((list: HiddenList) => {
    if (!thisVisit.includes(list.id)) thisVisit = [...thisVisit, list.id];
    change(withList(current, list));
  }, []);
  const showList = useCallback((id: string) => {
    thisVisit = thisVisit.filter((one) => one !== id);
    change(withoutList(current, id));
  }, []);
  const hideAuthor = useCallback((author: HiddenAuthor) => change(withAuthor(current, author)), []);
  const showAuthor = useCallback((uid: string) => change(withoutAuthor(current, uid)), []);
  return { hidden, hiddenThisVisit, hideList, showList, hideAuthor, showAuthor };
}
