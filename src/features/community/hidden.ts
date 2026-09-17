/**
 * What this device keeps out of sight: lists and authors the person hid, the
 * way the app does it, on the device and not in the account. Names are kept
 * beside the ids so Settings can show what is hidden without fetching.
 */

export const HIDDEN_KEY = "tyl:hidden";

export interface HiddenList {
  id: string;
  title: string;
}

export interface HiddenAuthor {
  uid: string;
  name: string;
}

export interface Hidden {
  lists: HiddenList[];
  authors: HiddenAuthor[];
}

export interface HiddenStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export const NOTHING_HIDDEN: Hidden = { lists: [], authors: [] };

const isHiddenList = (value: unknown): value is HiddenList =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as HiddenList).id === "string" &&
  typeof (value as HiddenList).title === "string";

const isHiddenAuthor = (value: unknown): value is HiddenAuthor =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as HiddenAuthor).uid === "string" &&
  typeof (value as HiddenAuthor).name === "string";

export function readHidden(store: HiddenStore): Hidden {
  try {
    const text = store.read(HIDDEN_KEY);
    if (text === null) return NOTHING_HIDDEN;
    const parsed = JSON.parse(text) as Partial<Hidden>;
    return {
      lists: Array.isArray(parsed.lists) ? parsed.lists.filter(isHiddenList) : [],
      authors: Array.isArray(parsed.authors) ? parsed.authors.filter(isHiddenAuthor) : [],
    };
  } catch {
    return NOTHING_HIDDEN;
  }
}

export function writeHidden(store: HiddenStore, hidden: Hidden): void {
  try {
    if (hidden.lists.length === 0 && hidden.authors.length === 0) store.remove(HIDDEN_KEY);
    else store.write(HIDDEN_KEY, JSON.stringify(hidden));
  } catch {
    // Nothing to keep it in: hidden for the visit.
  }
}

export const withList = (hidden: Hidden, list: HiddenList): Hidden =>
  hidden.lists.some((one) => one.id === list.id)
    ? hidden
    : { ...hidden, lists: [...hidden.lists, list] };

export const withoutList = (hidden: Hidden, id: string): Hidden => ({
  ...hidden,
  lists: hidden.lists.filter((one) => one.id !== id),
});

export const withAuthor = (hidden: Hidden, author: HiddenAuthor): Hidden =>
  hidden.authors.some((one) => one.uid === author.uid)
    ? hidden
    : { ...hidden, authors: [...hidden.authors, author] };

export const withoutAuthor = (hidden: Hidden, uid: string): Hidden => ({
  ...hidden,
  authors: hidden.authors.filter((one) => one.uid !== uid),
});

export const isListHidden = (hidden: Hidden, id: string): boolean =>
  hidden.lists.some((one) => one.id === id);

export const isAuthorHidden = (hidden: Hidden, uid: string): boolean =>
  hidden.authors.some((one) => one.uid === uid);

/** Out of sight for either reason: the list itself, or everything from its author. */
export const isOutOfSight = (hidden: Hidden, list: { id: string; authorUid: string }): boolean =>
  isListHidden(hidden, list.id) || isAuthorHidden(hidden, list.authorUid);
