import { localStorageStore, type KeyValueStore } from "./storage";

/**
 * A card worn as a face through a copy of its own (cut after it was moved
 * or zoomed): which card, and the copy's address, so the card's tile carries
 * the check and not "Your photo". Kept in this browser for each account.
 */
export interface CardFace {
  card: string;
  face: string;
}

const keyOf = (uid: string) => `tyl:card-face:${uid}`;

let store: KeyValueStore = localStorageStore;

/** Tests keep it in a store of their own; null puts the browser's back. */
export function useCardFaceStoreForTests(test: KeyValueStore | null): void {
  store = test ?? localStorageStore;
}

export function readCardFace(uid: string): CardFace | null {
  try {
    const kept = store.read(keyOf(uid));
    if (kept === null) return null;
    const { card, face } = JSON.parse(kept) as Partial<CardFace>;
    return typeof card === "string" && typeof face === "string" ? { card, face } : null;
  } catch {
    return null;
  }
}

export function keepCardFace(uid: string, cardFace: CardFace): void {
  try {
    store.write(keyOf(uid), JSON.stringify(cardFace));
  } catch {
    // The tile goes without its check after a reload; the face is worn all the same.
  }
}
