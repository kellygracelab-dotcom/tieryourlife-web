import { useCallback, useSyncExternalStore } from "react";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import {
  HIDDEN_KEY,
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
} from "./hidden";

/**
 * One copy of what is hidden for every page on screen: the feed loses a card
 * the moment the list page hides it, and Settings shows it at once. What was
 * hidden during this visit is also remembered, so a card can keep its place
 * with an Undo instead of vanishing; after a reload it is simply gone.
 */
let store: KeyValueStore = localStorageStore;
let current: Hidden = readHidden(store);
let thisVisit: readonly string[] = [];
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => current;
const visitSnapshot = () => thisVisit;

const notify = () => listeners.forEach((listener) => listener());

/**
 * Applied to what is stored now, not to this tab's copy: a tab opened earlier
 * would otherwise write back its old list and unhide what another tab hid,
 * the person somebody hid to stop seeing among them.
 */
function change(apply: (hidden: Hidden) => Hidden): void {
  const latest = readHidden(store);
  const next = apply(latest);
  if (next !== latest) writeHidden(store, next);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  notify();
}

// Another tab hid or showed something: this one shows it too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== HIDDEN_KEY) return;
    const latest = readHidden(store);
    if (JSON.stringify(latest) === JSON.stringify(current)) return;
    current = latest;
    notify();
  });
}

/** Tests keep their own store; the page keeps the browser's. */
export function useHiddenStoreForTests(replacement: KeyValueStore): void {
  store = replacement;
  current = readHidden(store);
  thisVisit = [];
  notify();
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
    change((hidden) => withList(hidden, list));
  }, []);
  const showList = useCallback((id: string) => {
    thisVisit = thisVisit.filter((one) => one !== id);
    change((hidden) => withoutList(hidden, id));
  }, []);
  const hideAuthor = useCallback(
    (author: HiddenAuthor) => change((hidden) => withAuthor(hidden, author)),
    [],
  );
  const showAuthor = useCallback(
    (uid: string) => change((hidden) => withoutAuthor(hidden, uid)),
    [],
  );
  return { hidden, hiddenThisVisit, hideList, showList, hideAuthor, showAuthor };
}
