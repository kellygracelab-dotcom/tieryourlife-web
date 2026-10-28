import type { Category } from "../../api/types";

/**
 * A board of the person's own, the way the phone keeps one: tiers with a
 * pool among them, cards that sit in a tier at a position, a trash that is a
 * time on the card or the board rather than a second place. The shape is the
 * one the account keeps (`/boards` in the backend), so a board written here
 * and one written by the phone are the same document; the few fields the
 * backend never sees are marked.
 */

export type ItemSource = "MANUAL" | "TMDB" | "GENERATED";
/**
 * How the board is drawn, by the phone's names for it (its
 * `TierListDisplayMode`): rows that wrap, one strip per tier that scrolls
 * sideways, or one ranked column. The account keeps the name as it is.
 */
export type DisplayMode = "WRAP" | "HORIZONTAL_SCROLL" | "FLAT_RANKED";
export const DISPLAY_MODES: readonly DisplayMode[] = ["WRAP", "HORIZONTAL_SCROLL", "FLAT_RANKED"];

/** A word inside the list's section, as the feed knows it. */
export interface BoardTopic {
  id: string;
  name: string;
}

export interface BoardTier {
  uid: string;
  position: number;
  label: string;
  caption: string | null;
  colorLight: string;
  colorDark: string;
  isPool: boolean;
}

export interface BoardItem {
  uid: string;
  /** A picture of the person's own, kept in their account by this id. */
  pictureId: string | null;
  tierUid: string;
  position: number;
  title: string;
  imageUrl: string | null;
  source: ItemSource;
  /** When it went to the trash; null while it is on the board. */
  deletedAt: number | null;
}

export interface Board {
  uid: string;
  title: string;
  displayMode: DisplayMode;
  category: Category | null;
  coverImageUrl: string | null;
  coverImageUrls: string[];
  authorName: string | null;
  publishedId: string | null;
  /** When the whole board went to the trash; null while it is in use. */
  deletedAt: number | null;
  tiers: BoardTier[];
  items: BoardItem[];
  /** This device's: when the board last changed, for the order of the list. Never sent. */
  editedAt: number;
  /** This device's: when it was starred, so starred boards keep an order among themselves. Never sent. */
  favouritedAt: number | null;
  /** This device's: the device a copy came from after a conflict, or null. Never sent. */
  arrivedFrom: string | null;
  /** This device's: the edit time the published copy was sent at, so "behind" can be told. Never sent. */
  publishedEditedAt: number | null;
  /** This device's, as on the phone: the topic the list goes out under, sent with every publish. Never kept in the account. */
  topic: BoardTopic | null;
  /** Published with no name or face; this device's, like the topic, and sent with every publish. */
  anonymous: boolean;
}

/** What a card is made from: enough for a tile. */
export interface CardDraft {
  title: string;
  imageUrl: string | null;
  pictureId?: string | null;
  source?: ItemSource;
}

export interface TierDraft {
  label: string;
  caption: string | null;
  colorLight: string;
  colorDark: string;
}

/** The backend's ceilings, the same as for a published list. */
export const BOARD_LIMITS = { title: 80, caption: 60, tiers: 20, items: 2000 } as const;

/** The phone's five tiers and its pool, light and dark (its `DefaultTierColors`). */
export const DEFAULT_TIER_DRAFTS: readonly TierDraft[] = [
  { label: "S", caption: null, colorLight: "#B03A32", colorDark: "#F1948C" },
  { label: "A", caption: null, colorLight: "#C06A25", colorDark: "#E9A867" },
  { label: "B", caption: null, colorLight: "#A98B1F", colorDark: "#D8C05A" },
  { label: "C", caption: null, colorLight: "#3F7F55", colorDark: "#7FC393" },
  { label: "D", caption: null, colorLight: "#3C6E99", colorDark: "#86B8DE" },
];

export const POOL_COLOURS = { colorLight: "#DAD7E0", colorDark: "#46464F" } as const;

export type NextUid = () => string;

const clip = (text: string, max: number): string => text.replace(/\s+/g, " ").slice(0, max);

const captionOf = (caption: string | null): string | null => {
  if (caption === null) return null;
  const clean = clip(caption, BOARD_LIMITS.caption).trim();
  return clean.length === 0 ? null : clean;
};

/** A new board: five lettered tiers and an empty pool, the way the phone starts one. */
export function newBoard(uid: string, title: string, now: number, nextUid: NextUid): Board {
  const tiers: BoardTier[] = DEFAULT_TIER_DRAFTS.map((tier, position) => ({
    uid: nextUid(),
    position,
    ...tier,
    isPool: false,
  }));
  tiers.push({
    uid: nextUid(),
    position: tiers.length,
    label: "",
    caption: null,
    ...POOL_COLOURS,
    isPool: true,
  });
  return {
    uid,
    title: clip(title, BOARD_LIMITS.title),
    displayMode: "WRAP",
    category: null,
    coverImageUrl: null,
    coverImageUrls: [],
    authorName: null,
    publishedId: null,
    deletedAt: null,
    tiers,
    items: [],
    editedAt: now,
    favouritedAt: null,
    arrivedFrom: null,
    publishedEditedAt: null,
    topic: null,
    anonymous: false,
  };
}

const byPosition = <T extends { position: number }>(a: T, b: T): number => a.position - b.position;

/** The tiers cards are ranked into, in their order; the pool is not one of them. */
export const rankedTiers = (board: Board): BoardTier[] =>
  board.tiers.filter((tier) => !tier.isPool).sort(byPosition);

/** The pool. A board always has one; a stored board without one is given one when read. */
export const poolTier = (board: Board): BoardTier | null =>
  board.tiers.find((tier) => tier.isPool) ?? null;

/** The cards on the board, trash left out, in no particular order. */
export const liveItems = (board: Board): BoardItem[] =>
  board.items.filter((item) => item.deletedAt === null);

/** The cards of one tier, trash left out, in their order. */
export const itemsIn = (board: Board, tierUid: string): BoardItem[] =>
  liveItems(board)
    .filter((item) => item.tierUid === tierUid)
    .sort(byPosition);

export const rankedCount = (board: Board): number => {
  const pool = poolTier(board)?.uid;
  return liveItems(board).filter((item) => item.tierUid !== pool).length;
};

export const poolCount = (board: Board): number => {
  const pool = poolTier(board)?.uid;
  return pool === undefined ? 0 : liveItems(board).filter((item) => item.tierUid === pool).length;
};

/** How many cards each ranked tier holds, in tier order: the bar on the board's card. */
export const tierShares = (board: Board): { color: string; colorDark: string; count: number }[] =>
  rankedTiers(board).map((tier) => ({
    color: tier.colorLight,
    colorDark: tier.colorDark,
    count: itemsIn(board, tier.uid).length,
  }));

/** The first few pictures on the board, for its card. */
export function previewsOf(board: Board, limit = 6): string[] {
  const seen = new Set<string>();
  const pictures: string[] = [];
  const ranked = rankedTiers(board).flatMap((tier) => itemsIn(board, tier.uid));
  const pool = poolTier(board);
  const inPool = pool === null ? [] : itemsIn(board, pool.uid);
  for (const item of [...ranked, ...inPool]) {
    if (item.imageUrl === null || seen.has(item.imageUrl)) continue;
    seen.add(item.imageUrl);
    pictures.push(item.imageUrl);
    if (pictures.length === limit) break;
  }
  return pictures;
}

const touched = (board: Board, now: number): Board => ({ ...board, editedAt: now });

/** The cards of one tier numbered 0, 1, 2… in the order given. */
const renumbered = (items: readonly BoardItem[]): BoardItem[] =>
  items.map((item, position) => (item.position === position ? item : { ...item, position }));

/** Every tier's cards numbered afresh, trash keeping its place by its old number. */
function tidy(board: Board): Board {
  const items: BoardItem[] = [];
  for (const tier of board.tiers) {
    const live = board.items.filter((item) => item.tierUid === tier.uid && item.deletedAt === null);
    items.push(...renumbered([...live].sort(byPosition)));
  }
  const trashed = board.items.filter((item) => item.deletedAt !== null);
  return { ...board, items: [...items, ...trashed] };
}

export function rename(board: Board, title: string, now: number): Board {
  const next = clip(title, BOARD_LIMITS.title);
  return next === board.title ? board : touched({ ...board, title: next }, now);
}

/** A topic lives inside one section: another section leaves the list without one. */
export const setCategory = (board: Board, category: Category | null, now: number): Board =>
  category === board.category ? board : touched({ ...board, category, topic: null }, now);

/** Anonymity goes out with the next publish too: changing it leaves the published copy behind. */
export const setAnonymous = (board: Board, anonymous: boolean, now: number): Board =>
  anonymous === board.anonymous ? board : touched({ ...board, anonymous }, now);

/** The topic goes out with the next publish, so a new one leaves the published copy behind. */
export const setTopic = (board: Board, topic: BoardTopic | null, now: number): Board =>
  topic?.id === board.topic?.id ? board : touched({ ...board, topic }, now);

export const setDisplayMode = (board: Board, displayMode: DisplayMode, now: number): Board =>
  displayMode === board.displayMode ? board : touched({ ...board, displayMode }, now);

/** Starring is a time rather than a flag, so starred boards keep an order; it is this device's business, so the edit time stays. */
export const setFavourite = (board: Board, at: number | null): Board =>
  at === board.favouritedAt ? board : { ...board, favouritedAt: at };

/** No pictures leave the cover to the cards, one is the cover itself, two to six make a collage. */
export function setCover(board: Board, pictures: readonly string[], now: number): Board {
  const chosen = [...new Set(pictures)].slice(0, 6);
  if (chosen.join("\n") === board.coverImageUrls.join("\n")) return board;
  return touched(
    {
      ...board,
      coverImageUrls: chosen,
      coverImageUrl: chosen.length === 1 ? (chosen[0] ?? null) : null,
    },
    now,
  );
}

/** Published, updated or taken down: the published copy now reflects the board as it stands. */
export const setPublished = (
  board: Board,
  publishedId: string | null,
  authorName: string | null,
  now: number,
): Board => ({
  ...board,
  publishedId,
  authorName,
  editedAt: now,
  publishedEditedAt: publishedId === null ? null : now,
});

/** Whether the board moved on since its published copy was sent. */
export const isBehind = (board: Board): boolean =>
  board.publishedId !== null &&
  board.publishedEditedAt !== null &&
  board.editedAt > board.publishedEditedAt;

/** Cards into the pool, after the ones already there, in the order given. */
export function addToPool(
  board: Board,
  drafts: readonly CardDraft[],
  now: number,
  nextUid: NextUid,
): Board {
  const pool = poolTier(board);
  if (pool === null || drafts.length === 0) return board;
  const room = BOARD_LIMITS.items - liveItems(board).length;
  const taken = drafts.slice(0, Math.max(0, room));
  if (taken.length === 0) return board;
  let position = itemsIn(board, pool.uid).length;
  const added: BoardItem[] = taken.flatMap((draft) => {
    const title = clip(draft.title, BOARD_LIMITS.title).trim();
    if (title.length === 0) return [];
    return [
      {
        uid: nextUid(),
        pictureId: draft.pictureId ?? null,
        tierUid: pool.uid,
        position: position++,
        title,
        imageUrl: draft.imageUrl,
        source: draft.source ?? "MANUAL",
        deletedAt: null,
      },
    ];
  });
  if (added.length === 0) return board;
  return touched({ ...board, items: [...board.items, ...added] }, now);
}

/** A card to a tier at a place among its cards; past the end means last. The same move again changes nothing. */
export function moveItem(
  board: Board,
  itemUid: string,
  toTierUid: string,
  toPosition: number,
  now: number,
): Board {
  const moved = board.items.find((item) => item.uid === itemUid && item.deletedAt === null);
  if (moved === undefined || !board.tiers.some((tier) => tier.uid === toTierUid)) return board;
  const target = itemsIn(board, toTierUid).filter((item) => item.uid !== itemUid);
  const at = Math.max(0, Math.min(toPosition, target.length));
  if (moved.tierUid === toTierUid && itemsIn(board, toTierUid)[at]?.uid === itemUid) return board;
  target.splice(at, 0, { ...moved, tierUid: toTierUid });
  const others = board.items.filter(
    (item) => item.uid !== itemUid && !(item.tierUid === toTierUid && item.deletedAt === null),
  );
  return touched(tidy({ ...board, items: [...others, ...renumbered(target)] }), now);
}

/**
 * The whole arrangement at once, from the board on screen: one row of card
 * uids per ranked tier, in tier order. Cards in no row are in the pool, in
 * the order they had. Nothing changed means the same board back.
 */
export function arrangeItems(
  board: Board,
  rows: readonly (readonly string[])[],
  now: number,
): Board {
  const pool = poolTier(board);
  if (pool === null) return board;
  const tiers = rankedTiers(board);
  const place = new Map<string, { tierUid: string; position: number }>();
  tiers.forEach((tier, index) => {
    (rows[index] ?? []).forEach((uid, position) => {
      if (!place.has(uid)) place.set(uid, { tierUid: tier.uid, position });
    });
  });
  const poolOrder = liveItems(board)
    .filter((item) => !place.has(item.uid))
    .sort((a, b) => {
      // Cards already in the pool keep their order; cards coming back join at the end, by tier then place.
      const aIn = a.tierUid === pool.uid ? 0 : 1;
      const bIn = b.tierUid === pool.uid ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return a.position - b.position;
    });
  poolOrder.forEach((item, position) => place.set(item.uid, { tierUid: pool.uid, position }));

  let changed = false;
  const items = board.items.map((item) => {
    const to = item.deletedAt === null ? place.get(item.uid) : undefined;
    if (to === undefined || (to.tierUid === item.tierUid && to.position === item.position)) {
      return item;
    }
    changed = true;
    return { ...item, ...to };
  });
  return changed ? touched({ ...board, items }, now) : board;
}

/** To the trash: the card keeps its tier and place, so Restore puts it back where it was. */
export function trashItem(board: Board, itemUid: string, now: number): Board {
  if (!board.items.some((item) => item.uid === itemUid && item.deletedAt === null)) return board;
  const items = board.items.map((item) =>
    item.uid === itemUid ? { ...item, deletedAt: now } : item,
  );
  return touched(tidy({ ...board, items }), now);
}

/** Back where it was, or at the end of its tier if the place has since been taken; to the pool if the tier is gone. */
export function restoreItem(board: Board, itemUid: string, now: number): Board {
  const item = board.items.find((card) => card.uid === itemUid && card.deletedAt !== null);
  if (item === undefined) return board;
  const tierUid = board.tiers.some((tier) => tier.uid === item.tierUid)
    ? item.tierUid
    : (poolTier(board)?.uid ?? item.tierUid);
  const row = itemsIn(board, tierUid);
  const at = Math.min(item.position, row.length);
  row.splice(at, 0, { ...item, tierUid, deletedAt: null });
  const others = board.items.filter(
    (card) => card.uid !== itemUid && !(card.tierUid === tierUid && card.deletedAt === null),
  );
  return touched(tidy({ ...board, items: [...others, ...renumbered(row)] }), now);
}

/** Gone for good. */
export const dropItem = (board: Board, itemUid: string): Board =>
  board.items.some((item) => item.uid === itemUid)
    ? { ...board, items: board.items.filter((item) => item.uid !== itemUid) }
    : board;

export const trashBoard = (board: Board, now: number): Board =>
  board.deletedAt === null ? touched({ ...board, deletedAt: now }, now) : board;

export const restoreBoard = (board: Board, now: number): Board =>
  board.deletedAt === null ? board : touched({ ...board, deletedAt: null }, now);

/** S, A, B, C, D, then E, F, … past the letters, a number. */
export function nextTierLabel(board: Board): string {
  const taken = new Set(rankedTiers(board).map((tier) => tier.label.trim().toUpperCase()));
  for (const letter of "SABCDEFGHIJKLMNOPQRTUVWXYZ") {
    if (!taken.has(letter)) return letter;
  }
  return String(rankedTiers(board).length + 1);
}

/** A tier at the end of the ranked ones; the pool stays last. */
export function addTier(board: Board, draft: TierDraft, now: number, nextUid: NextUid): Board {
  const ranked = rankedTiers(board);
  if (ranked.length >= BOARD_LIMITS.tiers) return board;
  const label = clip(draft.label, BOARD_LIMITS.title).trim();
  if (label.length === 0) return board;
  const tier: BoardTier = {
    uid: nextUid(),
    position: ranked.length,
    label,
    caption: captionOf(draft.caption),
    colorLight: draft.colorLight,
    colorDark: draft.colorDark,
    isPool: false,
  };
  const pool = poolTier(board);
  const tiers = [
    ...ranked,
    tier,
    ...(pool === null ? [] : [{ ...pool, position: ranked.length + 1 }]),
  ];
  return touched({ ...board, tiers }, now);
}

export function editTier(board: Board, tierUid: string, draft: TierDraft, now: number): Board {
  const tier = board.tiers.find((t) => t.uid === tierUid);
  if (tier === undefined || tier.isPool) return board;
  const label = clip(draft.label, BOARD_LIMITS.title).trim();
  if (label.length === 0) return board;
  const next: BoardTier = {
    ...tier,
    label,
    caption: captionOf(draft.caption),
    colorLight: draft.colorLight,
    colorDark: draft.colorDark,
  };
  if (
    next.label === tier.label &&
    next.caption === tier.caption &&
    next.colorLight === tier.colorLight &&
    next.colorDark === tier.colorDark
  ) {
    return board;
  }
  return touched({ ...board, tiers: board.tiers.map((t) => (t.uid === tierUid ? next : t)) }, now);
}

/** The tier goes; its cards go to the pool after the ones there. Cards in the trash stay in the trash, still naming the tier. */
export function removeTier(board: Board, tierUid: string, now: number): Board {
  const tier = board.tiers.find((t) => t.uid === tierUid);
  const pool = poolTier(board);
  if (tier === undefined || tier.isPool || pool === null || rankedTiers(board).length <= 1) {
    return board;
  }
  let position = itemsIn(board, pool.uid).length;
  const items = board.items.map((item) =>
    item.tierUid === tierUid && item.deletedAt === null
      ? { ...item, tierUid: pool.uid, position: position++ }
      : item,
  );
  const tiers = board.tiers
    .filter((t) => t.uid !== tierUid)
    .sort(byPosition)
    .map((t, index) => ({ ...t, position: index }));
  return touched({ ...board, tiers, items }, now);
}

/** The tier back where it stood, with the cards it had. The undo of removeTier. */
export function restoreTier(
  board: Board,
  tier: BoardTier,
  itemUids: readonly string[],
  now: number,
): Board {
  if (
    board.tiers.some((t) => t.uid === tier.uid) ||
    rankedTiers(board).length >= BOARD_LIMITS.tiers
  ) {
    return board;
  }
  const ranked = rankedTiers(board);
  const at = Math.min(tier.position, ranked.length);
  ranked.splice(at, 0, { ...tier, isPool: false });
  const pool = poolTier(board);
  const tiers = [
    ...ranked.map((t, index) => ({ ...t, position: index })),
    ...(pool === null ? [] : [{ ...pool, position: ranked.length }]),
  ];
  const back = new Map(itemUids.map((uid, position) => [uid, position]));
  const items = board.items.map((item) => {
    const position = item.deletedAt === null ? back.get(item.uid) : undefined;
    return position === undefined ? item : { ...item, tierUid: tier.uid, position };
  });
  return touched(tidy({ ...board, tiers, items }), now);
}

/** The ranked tiers in a new order; one not named keeps to the end, the pool stays last. */
export function reorderTiers(board: Board, orderedUids: readonly string[], now: number): Board {
  const ranked = rankedTiers(board);
  const wanted = orderedUids.filter((uid, index) => orderedUids.indexOf(uid) === index);
  const ordered = [
    ...wanted.flatMap((uid) => ranked.filter((tier) => tier.uid === uid)),
    ...ranked.filter((tier) => !wanted.includes(tier.uid)),
  ];
  if (ordered.every((tier, index) => tier.uid === ranked[index]?.uid)) return board;
  const pool = poolTier(board);
  const tiers = [
    ...ordered.map((tier, index) => ({ ...tier, position: index })),
    ...(pool === null ? [] : [{ ...pool, position: ordered.length }]),
  ];
  return touched({ ...board, tiers }, now);
}

// ---- The list of boards -----------------------------------------------------

/** Your lists in order of the last touch, by name, by most ranked, or by most still in the pool. */
export type BoardSort = "recent" | "name" | "ranked" | "pool";
export const BOARD_SORTS: readonly BoardSort[] = ["recent", "name", "ranked", "pool"];

/** All of them, the ones still being ranked, the public ones, or copies of somebody else's list. */
export type BoardShow = "all" | "inProgress" | "public" | "saved";
export const BOARD_SHOWS: readonly BoardShow[] = ["all", "inProgress", "public", "saved"];

export interface BoardFilters {
  show?: BoardShow;
  /** Words from the search field: case-insensitive, anywhere in the name. */
  query?: string;
}

export interface BoardArrangement {
  favourites: Board[];
  rest: Board[];
}

/**
 * In progress: something waits in the pool, or nothing is ranked yet. Saved
 * from others: a copy that still carries somebody's name, which publishing
 * makes one's own.
 */
const shows = (board: Board, show: BoardShow): boolean => {
  switch (show) {
    case "inProgress":
      return poolCount(board) > 0 || rankedCount(board) === 0;
    case "public":
      return board.publishedId !== null;
    case "saved":
      return board.authorName !== null && board.publishedId === null;
    default:
      return true;
  }
};

const keeps = (board: Board, filters: BoardFilters): boolean => {
  if (board.deletedAt !== null || !shows(board, filters.show ?? "all")) return false;
  const needle = filters.query?.trim().toLowerCase() ?? "";
  return needle === "" || board.title.toLowerCase().includes(needle);
};

/** By last touch, then by uid: two boards made in the same millisecond still have to sit somewhere. */
const byRecent = (a: Board, b: Board): number =>
  b.editedAt - a.editedAt || b.uid.localeCompare(a.uid);

const comparator = (sort: BoardSort) => (a: Board, b: Board) => {
  switch (sort) {
    case "name":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || byRecent(a, b);
    case "ranked":
      return rankedCount(b) - rankedCount(a) || byRecent(a, b);
    case "pool":
      return poolCount(b) - poolCount(a) || byRecent(a, b);
    default:
      return byRecent(a, b);
  }
};

/**
 * Starred first, newest star on top, then the rest in the chosen order. The
 * phone's `BoardOrder`: a filter never reshuffles what stays on screen.
 */
export function arrangeBoards(
  boards: readonly Board[],
  sort: BoardSort,
  filters: BoardFilters = {},
): BoardArrangement {
  const kept = boards.filter((board) => keeps(board, filters));
  const favourites = kept
    .filter((board) => board.favouritedAt !== null)
    .sort((a, b) => (b.favouritedAt ?? 0) - (a.favouritedAt ?? 0));
  const rest = kept.filter((board) => board.favouritedAt === null).sort(comparator(sort));
  return { favourites, rest };
}

/**
 * Headings only when both groups show and nothing narrows the list: under a
 * filter or a search the screen is an answer, and pinning something above it
 * is a second question nobody asked.
 */
export const shouldGroup = (arrangement: BoardArrangement, narrowed: boolean): boolean =>
  !narrowed && arrangement.favourites.length > 0 && arrangement.rest.length > 0;

export const isNarrowed = (filters: BoardFilters): boolean =>
  (filters.show ?? "all") !== "all" || (filters.query?.trim() ?? "") !== "";

// ---- The trash --------------------------------------------------------------

export type TrashEntry =
  | { kind: "board"; board: Board; deletedAt: number; itemCount: number }
  | { kind: "item"; board: Board; item: BoardItem; deletedAt: number; wasInPool: boolean };

/** Deleted boards and the deleted cards of boards still in use, newest first. */
export function trashEntriesOf(boards: readonly Board[]): TrashEntry[] {
  const entries: TrashEntry[] = [];
  for (const board of boards) {
    if (board.deletedAt !== null) {
      entries.push({
        kind: "board",
        board,
        deletedAt: board.deletedAt,
        itemCount: liveItems(board).length,
      });
      continue;
    }
    const pool = poolTier(board)?.uid;
    for (const item of board.items) {
      if (item.deletedAt === null) continue;
      entries.push({
        kind: "item",
        board,
        item,
        deletedAt: item.deletedAt,
        wasInPool: item.tierUid === pool,
      });
    }
  }
  return entries.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Every board without its trash, and every trashed board gone: what emptying the trash leaves. */
export function withoutTrash(boards: readonly Board[]): Board[] {
  return boards.flatMap((board) => {
    if (board.deletedAt !== null) return [];
    const items = board.items.filter((item) => item.deletedAt === null);
    return [items.length === board.items.length ? board : { ...board, items }];
  });
}
