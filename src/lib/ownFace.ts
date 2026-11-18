import { localStorageStore, type KeyValueStore } from "./storage";

/**
 * The photo a person uploaded from their device as their face: one slot,
 * kept whatever they wear now, so the letter or a card can be worn and the
 * photo put back with a press (Designer, 19.11.2026). Only a new upload takes
 * the slot; a card never does. The backend's copy stays where it is either
 * way; this is only where the site finds it again.
 *
 * Kept in this browser for each account until the account can keep it.
 */
const keyOf = (uid: string) => `tyl:own-face:${uid}`;
const cardKeyOf = (uid: string) => `tyl:card-face:${uid}`;

/** A card worn as a face through a copy of its own: which card, and the copy's address. */
export interface CardFace {
  card: string;
  face: string;
}

let store: KeyValueStore = localStorageStore;

/** Tests keep the slot in a store of their own; null puts the browser's back. */
export function useOwnFaceStoreForTests(test: KeyValueStore | null): void {
  store = test ?? localStorageStore;
}

export function readOwnFace(uid: string): string | null {
  try {
    const kept = store.read(keyOf(uid));
    return kept !== null && kept.startsWith("https://") ? kept : null;
  } catch {
    return null;
  }
}

/** The card whose cut is worn now, so its tile carries the check. */
export function readCardFace(uid: string): CardFace | null {
  try {
    const kept = store.read(cardKeyOf(uid));
    if (kept === null) return null;
    const { card, face } = JSON.parse(kept) as Partial<CardFace>;
    return typeof card === "string" && typeof face === "string" ? { card, face } : null;
  } catch {
    return null;
  }
}

export function keepCardFace(uid: string, cardFace: CardFace): void {
  try {
    store.write(cardKeyOf(uid), JSON.stringify(cardFace));
  } catch {
    // The tile goes without its check after a reload; the face is worn all the same.
  }
}

export function keepOwnFace(uid: string, url: string | null): void {
  try {
    if (url === null) store.remove(keyOf(uid));
    else store.write(keyOf(uid), url);
  } catch {
    // Nothing to keep it in: the slot lasts the visit.
  }
}
