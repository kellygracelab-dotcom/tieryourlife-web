import { useSyncExternalStore } from "react";
import { localStorageStore, type KeyValueStore } from "../../lib/storage";

/**
 * Whether a card's name is written on its picture, as a strip along its foot
 * (artboard 36): on unless turned off, one choice for every board on this
 * device. The page's root wears it as `data-card-names="off"`, so a board
 * drawn anywhere, the drag's ghost included, follows without being told.
 */
const KEY = "tyl.cardNames";
const listeners = new Set<() => void>();

const readOn = (store: KeyValueStore): boolean => store.read(KEY) !== "off";

function mark(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) delete document.documentElement.dataset.cardNames;
  else document.documentElement.dataset.cardNames = "off";
}

let on = readOn(localStorageStore);
mark(on);

export function cardNamesOn(): boolean {
  return on;
}

export function setCardNames(next: boolean, store: KeyValueStore = localStorageStore) {
  if (next) store.remove(KEY);
  else store.write(KEY, "off");
  on = next;
  mark(next);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useCardNames(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, cardNamesOn, cardNamesOn);
  return [value, setCardNames];
}
