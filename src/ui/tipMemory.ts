import { localStorageStore, type KeyValueStore } from "../lib/storage";

/**
 * The three tips a newcomer is shown in place (artboards 47–50, Danylo's yes
 * of 18.11.2026): placing a card, Play, and the Add field of a first empty list.
 * Each is shown once, and never to somebody who already did what it explains.
 */
export const TIP_IDS = ["place", "play", "add"] as const;
export type TipId = (typeof TIP_IDS)[number];

/** A board this big is worth Play's tip, and a ready list to try; a smaller one is quick by hand. */
export const TIP_CARDS = 8;

/** This device's memory of them; the account's copy is a later step, with the backend. */
export const TIPS_KEY = "tyl.tips";

interface Kept {
  /** No more tips: none is shown again until Show the tips again. */
  off: boolean;
  /** Shown once, or made pointless by doing what it says. */
  seen: TipId[];
}

let store: KeyValueStore = localStorageStore;
let version = 0;
const listeners = new Set<() => void>();

function read(): Kept {
  const raw = store.read(TIPS_KEY);
  if (raw === null) return { off: false, seen: [] };
  try {
    const kept = JSON.parse(raw) as Partial<Kept>;
    return {
      off: kept.off === true,
      seen: Array.isArray(kept.seen)
        ? kept.seen.filter((one): one is TipId => (TIP_IDS as readonly string[]).includes(one))
        : [],
    };
  } catch {
    return { off: false, seen: [] };
  }
}

function write(kept: Kept) {
  store.write(TIPS_KEY, JSON.stringify(kept));
  version++;
  for (const listener of listeners) listener();
}

/** Whether the tip may still be shown here. */
export const tipWanted = (id: TipId): boolean => {
  const kept = read();
  return !kept.off && !kept.seen.includes(id);
};

/** No more tips was pressed. */
export const tipsAreOff = (): boolean => read().off;

/** The tip was shown, or its action done: never again. */
export function tipSeen(id: TipId): void {
  const kept = read();
  if (kept.seen.includes(id)) return;
  write({ ...kept, seen: [...kept.seen, id] });
}

/** No more tips. */
export function tipsOff(): void {
  write({ ...read(), off: true });
}

/** Show the tips again: all three, as for somebody new. */
export function tipsAgain(): void {
  store.remove(TIPS_KEY);
  version++;
  for (const listener of listeners) listener();
}

export function subscribeToTips(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const tipsVersion = (): number => version;

/** A test's own store in place of the browser's; the browser's again with none. */
export function useTipsStoreForTests(next: KeyValueStore | null): void {
  store = next ?? localStorageStore;
  version++;
}
