import { MediaImage } from "../../ui/MediaImage";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ApiError } from "../../api/errors";
import type { SavedRanking } from "../../api/rank";
import type { PublishedItem, PublishedList, PublishedTier } from "../../api/types";
import { useSession } from "../../app/session";
import { keepRanking, rankingStillThere, rearrangeRanking } from "../../lib/api";
import { isEditorialAuthor } from "../../lib/editorial";
import { holds } from "../../lib/locale";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { KeepDialog, type KeepState } from "../ranking/KeepDialog";
import {
  forgetKept,
  keptBy,
  keptFor,
  readKept,
  writeKept,
  type KeptRanking,
} from "../ranking/kept";
import { rankFailureText } from "../ranking/failureText";
import { ResultBar, type FinishState } from "../ranking/ResultBar";
import { downloadShare, type Share } from "../ranking/share";
import { errorOf } from "../../api/errors";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { isCovered } from "../../ui/covered";
import { Icon } from "../../ui/Icon";
import { CardMenu, type ScreenPoint } from "./CardMenu";
import { MoveSheet } from "./MoveSheet";
import { DragGhost } from "./DragGhost";
import { ImageCredits } from "./ImageCredits";
import { flyIn } from "./flight";
import { arrange } from "./arrange";
import { DOUBLE_TAP_MS, type DragState } from "./drag";
import { draftKey, loadDraft, saveDraft, scopeOf, type TierLabels } from "./draft";
import {
  canUndo,
  init,
  placedCount,
  pool,
  reduce,
  tierForKey,
  tierOf,
  type BoardAction,
  type Rows,
} from "./model";
import { useTileDrag, type HitTest } from "./useTileDrag";
import { useTierMove, type TierEditing } from "./useTierMove";
import { BoardFrameContext } from "./boardFrame";
import { DockToggle } from "./DockToggle";
import { useDock } from "./useDock";
import { useHeadHeight } from "./useHeadHeight";
import { useFixedDock } from "./useFixedDock";
import { TRAY_DOTS, useTray } from "./useTray";
import { CardName } from "./CardName";
import { TierLabel } from "./TierLabel";
import { useBoardSize } from "./useBoardSize";
import type { BoardSize } from "./nameFit";
import "./board.css";
import "./ranking.css";
import { sizedFor } from "../../lib/pictureSize";

export type Keep = (
  listId: string,
  rows: readonly (readonly number[])[],
  version?: number,
  tierLabels?: TierLabels,
) => Promise<SavedRanking>;

/** The board as the owner's editor: it starts from what is saved, and Save writes it back. */
export interface EditMode {
  rows: readonly (readonly number[])[];
  save: (rows: readonly (readonly number[])[]) => Promise<unknown>;
  cancel: () => void;
  /**
   * The list's own author changing the list, not a ranking of it: Publish
   * changes in place of Save, cards that can be taken away, and every move
   * reported so the page can keep the draft.
   */
  owner?: {
    canSave: boolean;
    onChange: (rows: readonly (readonly number[])[]) => void;
    remove: (item: number) => void;
    /** The owner's way of bringing cards in; it lives with the pool, wherever the pool is. */
    tools?: ReactNode;
    /** What the owner has to know about the changes; it stands in the header when the bar does. */
    status?: ReactNode;
    /** Every move is kept the moment it is made: no Save and no Discard, the board on screen is the board. */
    live?: boolean;
    /** The tiers themselves, changed on the board: carried by their band, opened by a double tap. */
    tiers?: TierEditing;
  };
}

/**
 * Somebody else's arrangement on show (Theirs), to look at and to start
 * from, as on the phone: the board draws these rows and keeps nothing on the
 * device, has no pool, bar or number badges, and its first move hands the
 * rows, that move made, to `onStart`.
 */
export interface Seed {
  rows: Rows;
  /** The board's name: whose arrangement it is. */
  label: string;
  /** What placing a picked card will do, said under the board while one is picked. */
  hint: string;
  /** The same, in the line's place, while a card is carried. */
  dropHint: string;
  /** Said while nothing is picked or carried: that a move here starts one's own. */
  start?: string;
  onStart: (rows: Rows) => void;
}

interface RankingBoardProps {
  list: PublishedList;
  hitTest?: HitTest;
  store?: KeyValueStore;
  /**
   * Where the device's own choices go, the dock and the menu's hint: the
   * store by default, the browser's for a page whose store is scratch.
   */
  device?: KeyValueStore;
  keep?: Keep;
  /** Changes a ranking already kept, behind the same link. */
  rearrange?: (code: string, rows: Rows, tierLabels?: TierLabels) => Promise<unknown>;
  /**
   * Whether a ranking this device finished is still behind its link: false
   * only when the server says it is gone (deleted in another browser).
   */
  stillThere?: (code: string) => Promise<boolean>;
  share?: Share;
  edit?: EditMode;
  /** Every tier one line of cards that scrolls sideways: the phone's Single strip. */
  strip?: boolean;
  seed?: Seed;
  /** Every arrangement as it is made, for a page that starts something else from it (Play). */
  onRows?: (rows: Rows) => void;
  /** The list was republished while it was ranked: the page reads it again. */
  onListChanged?: () => void;
  /**
   * What the board held before the page put other rows in it (a first move
   * on Theirs, Play's result): the bar's Undo and Ctrl+Z go back to it.
   */
  undoTo?: Rows | null;
  /**
   * The words a reader gave the tiers, when this version started from their
   * placing: the list comes under them already, and Finish keeps them with
   * the ranking.
   */
  tierLabels?: TierLabels;
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed"; error: ApiError };

type PointerDownFor = (item: number) => (event: ReactPointerEvent<HTMLElement>) => void;

/** The widest a tile is drawn (board.css): pictures are asked for at this size. */
const TILE_WIDTH = 64;

/** A pool longer than this gets a search box in the side column. */
export const POOL_SEARCH_FROM = 24;

/** How often a card's menu has been opened on this device; the hint goes after MENU_HINT_UNTIL. */
export const MENU_COUNT_KEY = "tyl.cardMenu.opened";
export const MENU_HINT_UNTIL = 3;

/** A tier with no row yet: one empty row for all of them, so it reads as unchanged. */
const NO_ROW: readonly number[] = [];

/**
 * A tile's props stay the same from one render to the next unless the card
 * itself changed: the card and the tiers as the list holds them, callbacks
 * that take the card's number. A list of 2,000 cards then draws again only
 * the tiles a move touched, not all of them on every move.
 */
interface TileProps {
  card: PublishedItem | undefined;
  /** The list's tiers, for the card's menu. */
  tiers: PublishedTier[];
  item: number;
  board: BoardSize;
  selected: boolean;
  coarse: boolean;
  lifted: boolean;
  insertion?: "before" | "after" | undefined;
  locked: boolean;
  dispatch: (action: BoardAction) => void;
  pointerDownFor: PointerDownFor;
  /** The drag as it is right now: a press that lifted a card opens no menu. */
  dragNow: () => DragState;
  /** Where the card is, for its menu: a tier, or null in the pool. */
  current: number | null;
  /** The owner may take a card off the list, from its menu. */
  onRemove?: (item: number) => void;
  /** The card's menu opened: the board counts it, for its hint. */
  onMenu: () => void;
}

/**
 * Whether the device is a phone's, with a finger for its pointer: there a
 * card's menu is the phone's sheet, from the bottom; with a mouse it opens
 * where the pointer is.
 */
const fingerFirst = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/** A card's menu, open: the phone's sheet, or a menu at a point on the screen. */
type CardMenuAt = { sheet: true } | { sheet: false; at: ScreenPoint };

/**
 * A card on a board one can change. A tap picks it, for a tier's tap or a
 * number key to place; a double tap or a double click opens its menu, as on
 * the phone: every tier, back to the pool, and off the list for the owner.
 * Nothing sits on the card itself, so a press meant for the card cannot take
 * it off the list. With a mouse the menu opens at the pointer, by a double
 * click or a right click; a finger gets the phone's sheet. The keyboard opens
 * it with the context-menu key or Shift+F10, at the card.
 */
const Tile = memo(function Tile({
  card,
  tiers,
  item,
  board,
  selected,
  coarse,
  lifted,
  insertion,
  locked,
  dispatch,
  pointerDownFor,
  dragNow,
  current,
  onRemove,
  onMenu,
}: TileProps) {
  const [moving, setMoving] = useState<CardMenuAt | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const closeMove = useCallback(() => setMoving(null), []);
  // What made the last press, so a double tap of a finger gets the sheet and a mouse's the menu.
  const pressedBy = useRef("mouse");
  // When the last click came; two within DOUBLE_TAP_MS are a double click.
  // Clicks are timed rather than read from dblclick, which a double tap does
  // not send on every phone, and a drag between them sends no click at all.
  const lastClick = useRef(0);
  const opener = useRef<HTMLButtonElement>(null);
  if (card === undefined) return null;
  const credit = card.credit?.trim();
  const openCredits = credit ? () => setShowCredits(true) : undefined;
  const classes = [
    "tile",
    card.imageUrl === null && "tile--name",
    selected && "tile--selected",
    lifted && "tile--lifted",
  ]
    .filter(Boolean)
    .join(" ");
  const openMenu = (how: CardMenuAt) => {
    // Nothing picked while the menu is open: a number key does nothing, and a
    // move from the menu does not pass the pick on to the next card.
    dispatch({ type: "select", item: null });
    setMoving(how);
    onMenu();
  };
  // From the keyboard the menu opens at the card's lower start corner.
  const atCard = (button: HTMLElement): CardMenuAt => {
    if (fingerFirst()) return { sheet: true };
    const box = button.getBoundingClientRect();
    const rtl = getComputedStyle(button).direction === "rtl";
    return { sheet: false, at: { x: rtl ? box.right : box.left, y: box.bottom } };
  };
  const close = (then: () => void) => () => {
    setMoving(null);
    then();
  };
  return (
    <li className={insertion && "tile-anchor"}>
      {insertion && <span className={`tile--slot tile--slot-${insertion}`} aria-hidden="true" />}
      <button
        ref={opener}
        type="button"
        className={classes}
        aria-pressed={selected}
        aria-label={card.title}
        aria-haspopup={coarse ? "dialog" : "menu"}
        aria-keyshortcuts="Shift+F10"
        title={card.title}
        disabled={locked && !credit}
        data-item={item}
        onClick={(event) => {
          // The armed row underneath would take the same tap as "place here".
          event.stopPropagation();
          if (locked) {
            openCredits?.();
            return;
          }
          // Enter and Space click too (detail 0): they pick, and twice is not a double click.
          const at = event.detail > 0 ? Date.now() : 0;
          if (at > 0 && at - lastClick.current < DOUBLE_TAP_MS) {
            lastClick.current = 0;
            openMenu(
              pressedBy.current === "touch"
                ? { sheet: true }
                : { sheet: false, at: { x: event.clientX, y: event.clientY } },
            );
            return;
          }
          lastClick.current = at;
          dispatch({ type: "select", item });
        }}
        onContextMenu={(event) => {
          // A finger held on a card lifts it, as on the phone; its long press is not a menu.
          const touch = (event.nativeEvent as PointerEvent).pointerType === "touch";
          if (touch || dragNow().phase !== "idle") return;
          event.preventDefault();
          openMenu({ sheet: false, at: { x: event.clientX, y: event.clientY } });
        }}
        onKeyDown={(event) => {
          // Where the browser turns neither key into a context menu, Safari among them.
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          openMenu(atCard(event.currentTarget));
        }}
        onPointerDown={(event) => {
          pressedBy.current = event.pointerType;
          if (!locked) pointerDownFor(item)(event);
        }}
      >
        {card.imageUrl !== null ? (
          <MediaImage
            {...sizedFor(card.imageUrl, TILE_WIDTH)}
            alt=""
            loading="lazy"
            draggable={false}
          />
        ) : (
          <CardName title={card.title} board={board} wide />
        )}
      </button>
      {showCredits && credit && (
        <ImageCredits
          title={card.title}
          credit={credit}
          back={() => setShowCredits(false)}
          close={() => {
            setMoving(null);
            setShowCredits(false);
            opener.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {moving !== null && !showCredits && !locked && moving.sheet && (
        <MoveSheet
          name={card.title}
          onCredits={openCredits}
          tiers={tiers}
          current={current}
          onPlace={(tier) => close(() => dispatch({ type: "place", item, tier }))()}
          onUnplace={close(() => dispatch({ type: "unplace", item }))}
          onRemove={onRemove === undefined ? undefined : close(() => onRemove(item))}
          onClose={closeMove}
        />
      )}
      {moving !== null && !showCredits && !locked && !moving.sheet && (
        <CardMenu
          name={card.title}
          onCredits={openCredits}
          tiers={tiers}
          current={current}
          at={moving.at}
          opener={opener}
          onPlace={(tier) => close(() => dispatch({ type: "place", item, tier }))()}
          onUnplace={close(() => dispatch({ type: "unplace", item }))}
          onRemove={onRemove === undefined ? undefined : close(() => onRemove(item))}
          onClose={closeMove}
        />
      )}
    </li>
  );
});

/** Save for a ranking, Publish changes for the owner's list; busy, the word says so. */
const saveLabel = (edit: EditMode, busy: boolean): string =>
  edit.owner === undefined
    ? busy
      ? strings.rank.savingShort
      : strings.rank.saveChanges
    : busy
      ? strings.new.publishing
      : strings.new.publishChanges;

/**
 * Where the board keeps a list's rows on this device; the list page reads the
 * same place. Somebody else's arrangement on show (`seeded`) is not this
 * device's: it is neither read from there nor written.
 */
function useBoard(
  list: PublishedList,
  store: KeyValueStore,
  initialRows: readonly (readonly number[])[] | null = null,
  seeded = false,
  undoTo: Rows | null = null,
) {
  const scope = scopeOf(list);
  const kept = () => (seeded ? null : loadDraft(store, scope));
  const [state, dispatch] = useReducer(reduce, list, (l) => {
    const start = init(l.tiers.length, l.items.length, kept() ?? initialRows);
    return undoTo === null ? start : { ...start, history: [undoTo] };
  });
  // The list changed shape under the board — the owner added or took away a
  // card — and the rows come from the page again. A state that follows a prop
  // is adjusted during the render, React's way, not in an effect.
  if (state.itemCount !== list.items.length || state.rows.length !== list.tiers.length) {
    dispatch({
      type: "reset",
      tierCount: list.tiers.length,
      itemCount: list.items.length,
      rows: kept() ?? initialRows,
    });
  }
  useEffect(() => {
    if (seeded) return;
    saveDraft(store, scope, state.rows);
    // Only the rows are worth keeping; scope fields are derived from the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rows, store, seeded, list.id, list.updatedAt, list.items.length, list.tiers.length]);
  // The same list ranked in another tab: its moves are drawn here too, or
  // the next move here would write over them unseen. Rows kept for another
  // version of the list are that tab's business.
  const shown = useRef(state.rows);
  useEffect(() => {
    shown.current = state.rows;
  });
  useEffect(() => {
    if (seeded) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== draftKey(list.id)) return;
      const theirs = loadDraft(store, scope);
      if (theirs === null || JSON.stringify(theirs) === JSON.stringify(shown.current)) return;
      dispatch({
        type: "reset",
        tierCount: list.tiers.length,
        itemCount: list.items.length,
        rows: theirs,
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // The scope is derived from these fields of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, seeded, list.id, list.updatedAt, list.items.length, list.tiers.length]);
  return [state, dispatch] as const;
}

export function RankingBoard({
  list,
  hitTest,
  store = localStorageStore,
  device = store,
  keep = keepRanking,
  rearrange = rearrangeRanking,
  stillThere = rankingStillThere,
  share = downloadShare,
  edit,
  strip = false,
  seed,
  onRows,
  onListChanged,
  undoTo = null,
  tierLabels,
}: RankingBoardProps) {
  const seeded = seed !== undefined;
  const [state, dispatchBoard] = useBoard(
    list,
    store,
    seed?.rows ?? edit?.rows ?? null,
    seeded,
    undoTo,
  );
  // While the pool's search hides cards, a placement picks the next one among
  // those in sight: a hidden pick took the next number key unseen.
  const inSight = useRef<readonly number[] | null>(null);
  const dispatch = useCallback(
    (action: BoardAction) =>
      dispatchBoard(
        action.type === "place" && inSight.current !== null
          ? { ...action, among: inSight.current }
          : action,
      ),
    [dispatchBoard],
  );
  const boardSize = useBoardSize();
  const coarse = fingerFirst();
  const { account, signIn } = useSession();
  const guest = account?.kind !== "signedIn";
  const who = account === null ? undefined : account.kind === "signedIn" ? account.uid : null;
  // A ranking finished here before, showing as it was: its link again, not a
  // second Finish. Only to the person it is theirs: on a shared browser the
  // guest after a sign-out, or the next account, is offered their own Finish.
  const keptHere = (here: string | null | undefined): FinishState => {
    const code =
      edit === undefined && !seeded
        ? keptFor(keptBy(readKept(store, list.id), here), list.updatedAt, state.rows)
        : null;
    return code === null ? { status: "idle" } : { status: "done", code };
  };
  const [finish, setFinish] = useState<FinishState>(() => keptHere(who));
  // Firebase says who is here a moment after the page draws, and people sign
  // in and out on it: what was finished here is shown again for whoever came.
  const [shownTo, setShownTo] = useState(who);
  if (shownTo !== who) {
    setShownTo(who);
    if (finish.status === "idle" || finish.status === "done") setFinish(keptHere(who));
  }
  // The link shown from the device's copy is asked about once, behind the
  // page: deleted in another browser, the copy goes and Finish comes back.
  // A link just made here needs no asking.
  const asked = useRef(new Set<string>());
  const shownCode = finish.status === "done" ? finish.code : null;
  useEffect(() => {
    if (shownCode === null || asked.current.has(shownCode)) return;
    asked.current.add(shownCode);
    stillThere(shownCode).then(
      (there) => {
        if (there) return;
        forgetKept(store, list.id, shownCode);
        setFinish((now) =>
          now.status === "done" && now.code === shownCode ? { status: "idle" } : now,
        );
      },
      () => undefined,
    );
  }, [shownCode, stillThere, store, list.id]);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const locked = finish.status === "saving" || finish.status === "done" || save.status === "saving";
  const [offer, setOffer] = useState<KeepState>("closed");
  const drag = useTileDrag(dispatch, hitTest);
  const lifted = drag.state.phase === "dragging" ? drag.state.item : null;
  const dropTarget = drag.state.phase === "dragging" ? drag.state.target : null;
  // The owner's way to take a card off, one function for every tile: the
  // page hands a new one with each render, and every tile would draw again.
  const removeNow = useRef(edit?.owner?.remove);
  useEffect(() => {
    removeNow.current = edit?.owner?.remove;
  });
  const removeCard = useCallback((item: number) => removeNow.current?.(item), []);
  const onRemove = edit?.owner?.remove === undefined ? undefined : removeCard;
  const selected = state.selected;
  const selectedTitle = selected === null ? null : (list.items[selected]?.title ?? null);
  const section = useRef<HTMLElement>(null);
  const poolBox = useRef<HTMLDivElement>(null);
  const boardEnd = useRef<HTMLDivElement>(null);
  const boardBox = useRef<HTMLDivElement>(null);
  const tierEditing = edit?.owner?.tiers;
  const tierMove = useTierMove(boardBox, tierEditing, state.selected === null);

  // The pool's place on a wide screen, and what the page lends the board: a
  // slot in its header for the bar while the pool is docked under the board.
  const { dock, rows, wide, canDock, choose, resize, startResize, resizeByKey, maxRows } =
    useDock(device);
  // On a narrow window the box that brings cards in waits behind Add, in the
  // pool, whichever head the pool shows; on a wide one it stands in the pool,
  // and an empty pool gives it the cursor. Opened, the catalogue's field
  // takes the cursor.
  const [adding, setAdding] = useState(false);
  const tools = edit?.owner?.tools;
  const emptyPool = edit?.owner?.live === true && pool(state).length === 0;
  const openTools = useRef(false);
  const toggleAdding = () => {
    openTools.current = !adding;
    setAdding(!adding);
  };
  useEffect(() => {
    if (!adding || !openTools.current) return;
    openTools.current = false;
    poolBox.current?.querySelector<HTMLInputElement>(".pool__tools input[type='text']")?.focus();
  }, [adding]);
  const addButton = tools !== undefined && !wide && (
    <button
      type="button"
      className="btn btn--tonal pool__add"
      aria-expanded={adding}
      onClick={toggleAdding}
    >
      <Icon name="add" className="btn__icon" />
      <span>{strings.new.add}</span>
    </button>
  );
  const addChip = tools !== undefined && (
    <button type="button" className="pool__add-chip" aria-expanded={adding} onClick={toggleAdding}>
      <Icon name="add" />
      <span>{strings.new.add}</span>
    </button>
  );
  const toolsPanel = tools !== undefined && (adding || wide) && (
    <div className={wide ? "pool__tools" : "pool__tools pool__tools--sheet"}>{tools}</div>
  );
  // Nothing to place yet and nobody typing elsewhere (the new board's name is
  // asked for first): the cursor waits in the field that brings cards in.
  const askForCards = wide && emptyPool && tools !== undefined;
  // Unless the field that brings cards in takes the cursor: then the board lets it.
  const { announcer, onFocus: followFocus } = useMoveFollowing(
    section,
    list,
    state.rows,
    state.selected,
    askForCards,
  );
  // A frame later: when a key placed the last card, the field must not take
  // the cursor while that key is still going, or its digit is typed in it.
  useEffect(() => {
    if (!askForCards) return;
    const frame = requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now !== null && now !== document.body) return;
      poolBox.current?.querySelector<HTMLInputElement>(".pool__tools input[type='text']")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [askForCards]);
  const docked = wide && dock === "under";
  const frame = useContext(BoardFrameContext);
  // On a wide screen the count and the actions stand in the page's header,
  // wherever the pool is: moving the pool does not move the buttons.
  const inHead = wide && frame.headSlot !== null;
  useHeadHeight(wide ? frame.headSlot : null);
  useEffect(() => {
    // Theirs on show has no pool to place: the page keeps its own layout for it.
    if (seeded) return;
    frame.report(wide ? dock : null);
    return () => frame.report(null);
  }, [frame, wide, dock, seeded]);

  // Where the picked card was in the tray when it was placed. Once the tile
  // is in its row it flies from there, or fades in for someone who asked for
  // less motion; a card dropped by hand needs no flight, it is already there.
  const flight = useRef<{ item: number; from: DOMRect } | null>(null);
  const placeSelected = useCallback(
    (tier: number) => {
      if (selected === null) return;
      const from = section.current
        ?.querySelector(`.pool [data-item="${selected}"]`)
        ?.getBoundingClientRect();
      if (from !== undefined) flight.current = { item: selected, from };
      dispatch({ type: "place", item: selected, tier });
    },
    [dispatch, selected],
  );
  useLayoutEffect(() => {
    const planned = flight.current;
    if (planned === null) return;
    flight.current = null;
    const tile = section.current?.querySelector<HTMLElement>(
      `.tier__items [data-item="${planned.item}"]`,
    );
    if (tile != null) flyIn(tile, planned.from);
  });

  // The side column's search, for a pool too long to scan: it narrows what
  // the tray shows, and `/` puts the cursor in it.
  const [query, setQuery] = useState("");

  // The owner's pool says how to reach a card's menu until it has been
  // opened a few times; the count is kept on the device.
  const [menusOpened, setMenusOpened] = useState(() => Number(device.read(MENU_COUNT_KEY)) || 0);
  const onMenu = useCallback(() => {
    const next = (Number(device.read(MENU_COUNT_KEY)) || 0) + 1;
    device.write(MENU_COUNT_KEY, String(next));
    setMenusOpened(next);
  }, [device]);

  // The result opens above the board, and the person may be far below it.
  const finished = finish.status !== "idle";
  useEffect(() => {
    if (!finished) return;
    const result = section.current?.querySelector(".result");
    if (result != null && typeof result.scrollIntoView === "function") {
      result.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [finished]);

  const onFinish = () => {
    setFinish({ status: "saving" });
    // A finished board places nothing: no card stays picked, nor a line saying how to place it.
    dispatch({ type: "select", item: null });
    const placed = state.rows.map((row) => [...row]);
    const uid = account?.kind === "signedIn" ? account.uid : null;
    const before = readKept(store, list.id);
    // Changed after Finish, a ranking finished here for this version of the
    // list is changed behind its link, as the /r/ page's Edit does: the
    // account's, or a guest's own while nobody has claimed it. One gone
    // since, or not the caller's any more, is made anew.
    const inPlace =
      before !== null &&
      before.version === list.updatedAt &&
      (before.claimedBy === undefined ? uid === null : before.claimedBy === uid);
    // A reader's tier words go with the rows; a version in the list's own words sends none.
    const keepIt = () =>
      tierLabels === undefined
        ? keep(list.id, placed, list.updatedAt)
        : keep(list.id, placed, list.updatedAt, tierLabels);
    const saved: Promise<KeptRanking> = inPlace
      ? (tierLabels === undefined
          ? rearrange(before.code, placed)
          : rearrange(before.code, placed, tierLabels)
        ).then(
          () => before,
          (reason: unknown) =>
            ["notFound", "notYours", "notSignedIn"].includes(errorOf(reason).kind)
              ? keepIt()
              : Promise.reject(reason),
        )
      : keepIt();
    saved.then(
      (kept) => {
        // Made by an account, the ranking already sits in it: nothing to claim later.
        const owner = uid === null ? {} : { claimedBy: uid };
        writeKept(store, list.id, { ...kept, ...owner, rows: placed, version: list.updatedAt });
        asked.current.add(kept.code);
        setFinish({ status: "done", code: kept.code });
        // The same link as before was offered already; only a new one is.
        if (guest && kept !== before) setOffer("open");
        // Kept by its /r/ link only: the list's public Rankings name the
        // reader, so a placing joins them only when asked, as in the app.
        // Nor is it a take: the app counts one on Save to my lists only.
      },
      (reason: unknown) => setFinish({ status: "failed", error: errorOf(reason) }),
    );
  };

  const onGoogle = () => {
    setOffer("busy");
    signIn().then((outcome) =>
      setOffer((now) => {
        if (now === "closed") return now;
        if (outcome.kind === "signedIn") return "closed";
        if (outcome.kind === "cancelled") return "open";
        return outcome.kind === "redirecting" ? "busy" : "failed";
      }),
    );
  };
  const onLinkOnly = useCallback(() => setOffer("closed"), []);
  // Finish goes once the ranking is kept, and the focus with it: the keyboard
  // carries on in the result, once the offer to keep it (if any) is answered.
  const done = finish.status === "done";
  useEffect(() => {
    if (!done || offer !== "closed") return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    section.current
      ?.querySelector<HTMLElement>(".result a[href], .result button:not([disabled])")
      ?.focus({ preventScroll: true });
  }, [done, offer]);

  // The owner's page keeps the draft: every placement goes out as it happens.
  const report = useRef(edit?.owner?.onChange);
  const follow = useRef(onRows);
  useEffect(() => {
    report.current = edit?.owner?.onChange;
    follow.current = onRows;
  });
  useEffect(() => {
    report.current?.(state.rows);
    follow.current?.(state.rows);
  }, [state.rows]);

  // Theirs on show: the first move, by a drag, a tap, a key or the card's
  // menu, starts the visitor's own board from it. Picking a card is not a move.
  const start = useRef(seed?.onStart);
  useEffect(() => {
    start.current = seed?.onStart;
  });
  const started = useRef(false);
  useEffect(() => {
    if (state.history.length === 0 || started.current || start.current === undefined) return;
    started.current = true;
    start.current(state.rows);
  }, [state.rows, state.history.length]);

  const onSave = () => {
    if (edit === undefined) return;
    setSave({ status: "saving" });
    edit.save(state.rows).then(
      () => setSave({ status: "idle" }),
      (reason: unknown) => setSave({ status: "failed", error: errorOf(reason) }),
    );
  };

  useEffect(() => {
    if (locked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      // Keys pressed in a dialog or a menu are theirs, not the board's behind them.
      if (isCovered(section.current)) return;
      // Z by its place too, as Play has it: on a Russian or Arabic layout the key says "я" or "ئ".
      const z = event.key.toLowerCase() === "z" || event.code === "KeyZ";
      if ((event.ctrlKey || event.metaKey) && z) {
        event.preventDefault();
        return dispatch({ type: "undo" });
      }
      // Alt+1 or Ctrl+1 belongs to the browser or the system, not to the board.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // A single key belongs to the board only while the focus is on it, or
      // on nothing in particular (the page, after a click Safari does not
      // focus): pressed on the header's links or the page's buttons, it is theirs.
      const target = event.target;
      const board = section.current;
      if (
        target instanceof Element &&
        board !== null &&
        !board.contains(target) &&
        !target.contains(board)
      ) {
        return;
      }
      if (event.key === "/") {
        const box = section.current?.querySelector<HTMLInputElement>(".pool__search");
        // jsdom has no layout and no checkVisibility; there the box counts as shown.
        const visible = typeof box?.checkVisibility === "function" ? box.checkVisibility() : true;
        if (box != null && visible) {
          event.preventDefault();
          box.focus();
        }
        return;
      }
      if (event.key === "Escape") return dispatch({ type: "select", item: null });
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && selected !== null) {
        const tier = tierOf(state, selected);
        const row = tier === null ? null : state.rows[tier];
        if (tier === null || row == null) return;
        // Toward the row's start is left in English and right in Arabic.
        const rtl =
          section.current !== null && getComputedStyle(section.current).direction === "rtl";
        const back = (event.key === "ArrowLeft") !== rtl;
        const index = row.indexOf(selected) + (back ? -1 : 1);
        if (index < 0 || index >= row.length) return;
        event.preventDefault();
        return dispatch({ type: "place", item: selected, tier, index });
      }
      const tier = tierForKey(event.key, list.tiers.length);
      if (tier !== null) placeSelected(tier);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, list.tiers.length, placeSelected, locked, selected, state]);

  // The pool and its tiles are the same from one frame of a drag to the next:
  // kept, they are not drawn again while a card travels over the rows.
  const left = useMemo(() => pool(state), [state]);
  const needle = query.trim();
  const shown = useMemo(
    () =>
      needle === "" ? left : left.filter((item) => holds(list.items[item]?.title ?? "", needle)),
    [left, needle, list.items],
  );
  useEffect(() => {
    inSight.current = needle === "" ? null : shown;
  });
  const pointerDownFor = drag.onPointerDown;
  const dragNow = drag.current;
  const poolTiles = useMemo(
    () =>
      shown.map((item) => (
        <Tile
          key={item}
          card={list.items[item]}
          tiers={list.tiers}
          item={item}
          board={boardSize}
          coarse={coarse}
          selected={selected === item}
          lifted={lifted === item}
          locked={locked}
          dispatch={dispatch}
          pointerDownFor={pointerDownFor}
          dragNow={dragNow}
          onMenu={onMenu}
          current={null}
          onRemove={onRemove}
        />
      )),
    [
      shown,
      coarse,
      list.items,
      list.tiers,
      boardSize,
      selected,
      lifted,
      locked,
      dispatch,
      pointerDownFor,
      dragNow,
      onMenu,
      onRemove,
    ],
  );
  const keyboardTiers = Math.min(list.tiers.length, 9);
  // On a phone the pool is one scrolling row with dots under it.
  // The tray waits out a double tap before it scrolls, or the second tap lands on another card.
  const { tray, page, pages, readPage } = useTray(
    selected,
    !wide && rows > 1 ? Math.ceil(shown.length / 2) : shown.length,
    DOUBLE_TAP_MS,
  );
  const picked = selected !== null && left.includes(selected);
  const allPlaced = left.length === 0 && finish.status !== "done";
  // Finished with every card placed: the tray has nothing to say and goes.
  const restEmpty = finish.status === "done" && left.length === 0;

  // The dock is fixed to the window's foot; the page leaves room under the
  // board for it, its shadow says a row is underneath, and a card dragged
  // toward a covered row scrolls the page.
  const { over } = useFixedDock({
    poolBox,
    boardEnd,
    fixed: docked && !restEmpty && !seeded,
    dragging: drag.state.phase === "dragging",
    dragNow: drag.current,
    nudge: drag.nudge,
  });
  // A phone's tray lies over the page's foot and grows when the owner's
  // tools open in it: its height goes to the root as --tray-h, so the page
  // keeps that much room under the board and the last row scrolls clear.
  useEffect(() => {
    const box = poolBox.current;
    if (box === null || wide || restEmpty || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--tray-h", `${Math.ceil(box.getBoundingClientRect().height)}px`),
    );
    observer.observe(box);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--tray-h");
    };
  }, [wide, restEmpty]);
  const poolClasses = [
    "pool",
    (docked || !wide) && rows === 1 && "pool--single",
    !wide && rows > 1 && "pool--expanded",
    dropTarget?.kind === "pool" && "pool--target",
    picked && "pool--picked",
    lifted !== null && left.includes(lifted) && "pool--dragging",
    finish.status === "done" && "pool--rest",
    over && "pool--over",
  ]
    .filter(Boolean)
    .join(" ");

  const bar = (
    <div
      className={[
        "ranking__bar",
        inHead && "ranking__bar--head",
        edit?.owner !== undefined && "ranking__bar--owner",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {inHead && edit?.owner?.status}
      <p className="ranking__progress" aria-live="polite">
        {fill(strings.rank.placed, { n: placedCount(state), total: list.items.length })}
      </p>
      <div className="ranking__actions">
        <Button
          icon="undo"
          onClick={() => dispatch({ type: "undo" })}
          disabled={locked || !canUndo(state)}
        >
          {strings.rank.undo}
        </Button>
        {edit !== undefined && !edit.owner?.live && (
          <Button onClick={edit.cancel} disabled={locked}>
            {edit.owner === undefined ? strings.rank.cancel : strings.new.discardChanges}
          </Button>
        )}
        {edit !== undefined && !edit.owner?.live && (
          <Button
            variant="filled"
            icon="check"
            onClick={onSave}
            disabled={
              locked || (edit.owner === undefined ? placedCount(state) === 0 : !edit.owner.canSave)
            }
          >
            {saveLabel(edit, save.status === "saving")}
          </Button>
        )}
        {edit === undefined && finish.status !== "done" && (
          <Button
            variant="filled"
            icon="check"
            onClick={onFinish}
            disabled={locked || placedCount(state) === 0}
          >
            {strings.rank.finish}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <section
      className={["ranking", docked && "ranking--under", lifted !== null && "ranking--drag"]
        .filter(Boolean)
        .join(" ")}
      aria-label={seed?.label ?? strings.rank.yours}
      ref={section}
      onFocus={followFocus}
    >
      <p className="visually-hidden" aria-live="polite" ref={announcer} />
      <div className="ranking__main">
        {save.status === "failed" && (
          <p className="ranking__error" role="alert">
            {rankFailureText(save.error)}
          </p>
        )}

        {edit === undefined && !seeded && (
          <ResultBar
            finish={finish}
            onRetry={onFinish}
            onChange={() => {
              setFinish({ status: "idle" });
              setOffer("closed");
            }}
            download={(address) => share(list, state.rows, address)}
            reload={onListChanged}
            kept={!guest}
            save={guest ? () => setOffer("open") : undefined}
            // A template has no author's version to sit beside, and the house is nobody's.
            compared={!isEditorialAuthor(list.authorUid) && arrange(list).known}
          />
        )}

        {!inHead && edit?.owner?.status}

        <div className={strip ? "board board--strip" : "board"} ref={boardBox}>
          {list.tiers.map((tier, index) => (
            <TierRow
              key={`${index}-${tier.label}`}
              meta={tier}
              tiers={list.tiers}
              items={list.items}
              row={state.rows[index] ?? NO_ROW}
              selected={selected}
              tier={index}
              board={boardSize}
              coarse={coarse}
              selectedTitle={selectedTitle}
              dispatch={dispatch}
              dropAt={
                dropTarget?.kind === "tier" && dropTarget.tier === index ? dropTarget.index : null
              }
              pointerDownFor={drag.onPointerDown}
              lifted={lifted}
              locked={locked}
              onPlace={placeSelected}
              dragNow={drag.current}
              onMenu={onMenu}
              onRemove={onRemove}
              band={
                tierEditing === undefined || locked
                  ? undefined
                  : {
                      onPointerDown: tierMove.onPointerDown(index),
                      offset: tierMove.offsetOf(index),
                      lifted: tierMove.lifted === index,
                      carrying: tierMove.lifted !== null,
                      open: () => tierEditing.open(index),
                      step: (by: -1 | 1) => tierEditing.move(index, index + by, true),
                    }
              }
            />
          ))}
          {tierEditing?.add !== undefined && (
            <Button
              variant="outlined"
              className="board__add-tier"
              icon="add"
              onClick={tierEditing.add}
            >
              {strings.new.addTier}
            </Button>
          )}
          <div className="board__end" ref={boardEnd} aria-hidden="true" />
        </div>
        {seed !== undefined &&
          (selected !== null || lifted !== null || seed.start !== undefined) && (
            <p className="ranking__seed-hint" role="status">
              {lifted !== null ? seed.dropHint : selected !== null ? seed.hint : seed.start}
            </p>
          )}
      </div>

      {/* Theirs keeps the column empty, so its tiers stand where Mine's do. */}
      <div className="ranking__side">
        {seeded
          ? null
          : inHead && frame.headSlot !== null
            ? createPortal(bar, frame.headSlot)
            : bar}

        {!seeded && !restEmpty && (
          <div
            key={dock}
            ref={poolBox}
            className={poolClasses}
            data-drop="pool"
            style={{ "--dock-rows": rows } as CSSProperties}
          >
            {docked && !allPlaced && (
              // A splitter the keyboard reaches too: up and down change the rows a drag or a click does.
              <div
                className="pool__grip"
                role="separator"
                aria-orientation="horizontal"
                aria-label={strings.rank.dockRows}
                title={strings.rank.dockRowsHint}
                aria-valuemin={1}
                aria-valuemax={maxRows}
                aria-valuenow={rows}
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={resizeByKey}
              />
            )}
            {allPlaced && !wide && !emptyPool ? (
              <div className="pool__done">
                <p className="pool__done-title">
                  <Icon name="check_circle" className="pool__done-icon" />
                  {plural(strings.rank.allPlaced, list.items.length)}
                </p>
                <p className="pool__done-note">
                  {edit === undefined
                    ? strings.rank.allPlacedNote
                    : edit.owner?.live
                      ? strings.rank.allPlacedNoteLive
                      : strings.rank.allPlacedNoteEdit}
                </p>
                {!edit?.owner?.live && (
                  <Button
                    variant="filled"
                    icon="check"
                    onClick={edit === undefined ? onFinish : onSave}
                    disabled={locked || (edit?.owner !== undefined && !edit.owner.canSave)}
                  >
                    {edit === undefined ? strings.rank.finish : saveLabel(edit, false)}
                  </Button>
                )}
                {addButton}
                {toolsPanel}
              </div>
            ) : (
              <>
                <div
                  className={
                    emptyPool
                      ? "pool__head pool__head--empty"
                      : allPlaced
                        ? "pool__head pool__head--done"
                        : "pool__head"
                  }
                >
                  <div className="pool__lead">
                    {allPlaced && !emptyPool ? (
                      <p className="pool__done-title">
                        <Icon name="check_circle" className="pool__done-icon" />
                        {plural(strings.rank.allPlaced, list.items.length)}
                      </p>
                    ) : (
                      <h2 className="pool__title">
                        {emptyPool
                          ? fill(strings.boards.poolCount, { n: 0 })
                          : plural(
                              edit?.owner?.live ? strings.boards.pool : strings.rank.left,
                              left.length,
                            )}
                      </h2>
                    )}
                    {emptyPool ? !wide && addChip : addButton}
                    {!wide && maxRows > 1 && !allPlaced && (
                      <button
                        type="button"
                        className="pool__expand"
                        aria-label={strings.rank.dockRows}
                        aria-expanded={rows > 1}
                        onClick={() => resize(rows > 1 ? 1 : 2)}
                      >
                        <Icon name="expand_more" />
                      </button>
                    )}
                    {wide && canDock && <DockToggle dock={dock} onChoose={choose} />}
                  </div>
                  {toolsPanel}
                  {emptyPool && <p className="pool__empty">{strings.boards.poolEmpty}</p>}
                  {!allPlaced && left.length > POOL_SEARCH_FROM && tools === undefined && (
                    <input
                      className="pool__search"
                      type="search"
                      value={query}
                      placeholder={strings.rank.search}
                      aria-label={strings.rank.search}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        setQuery("");
                        event.currentTarget.blur();
                      }}
                    />
                  )}
                  {allPlaced ? (
                    tools === undefined && (
                      <p className="pool__hint pool__hint--keys">{strings.rank.allPlacedHint}</p>
                    )
                  ) : (
                    <>
                      <p className="pool__hint pool__hint--keys">
                        {selectedTitle === null
                          ? fill(strings.rank.hintPick, { keys: `1–${keyboardTiers}` })
                          : picked
                            ? fill(strings.rank.hintPlace, { name: selectedTitle })
                            : fill(strings.rank.hintMove, { name: selectedTitle })}
                      </p>
                      <p className="pool__hint pool__hint--touch">
                        {selectedTitle === null
                          ? strings.rank.hintPickTouch
                          : fill(strings.rank.hintPlaceTouch, { name: selectedTitle })}
                      </p>
                    </>
                  )}
                </div>
                {!allPlaced && (
                  <>
                    <ul className="pool__items" ref={tray} onScroll={readPage}>
                      {poolTiles}
                    </ul>
                    {shown.length === 0 && <p className="pool__none">{strings.rank.searchNone}</p>}
                    {edit?.owner !== undefined && menusOpened < MENU_HINT_UNTIL && (
                      // Hidden, not gone, while a card is picked: the cards above
                      // must not move between the two clicks of a double click.
                      <p
                        className="pool__hint pool__hint--menu"
                        style={selected === null ? undefined : { visibility: "hidden" }}
                      >
                        {strings.boards.menuHint}
                      </p>
                    )}
                    {pages > 1 && (
                      <div className="pool__dots" aria-hidden="true">
                        {Array.from({ length: Math.min(pages, TRAY_DOTS) }, (_, i) => (
                          <span
                            key={i}
                            className={i === page ? "pool__dot pool__dot--on" : "pool__dot"}
                          />
                        ))}
                        {pages > TRAY_DOTS && (
                          <span className="pool__dots-more">+{pages - TRAY_DOTS}</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {edit === undefined && !seeded && (
        <KeepDialog state={offer} onGoogle={onGoogle} onLinkOnly={onLinkOnly} />
      )}
      <DragGhost
        now={drag.current}
        subscribe={drag.subscribe}
        items={list.items}
        board={boardSize}
      />
    </section>
  );
}

/**
 * A row's props are its own: its cards, the pick, and where a carried card
 * would land in it. A move redraws the rows it changed; a card carried over
 * one row redraws that row alone.
 */
interface TierRowProps {
  meta: PublishedTier | undefined;
  /** The list's tiers, for a card's menu. */
  tiers: PublishedTier[];
  items: PublishedItem[];
  row: readonly number[];
  selected: number | null;
  tier: number;
  board: BoardSize;
  coarse: boolean;
  selectedTitle: string | null;
  dispatch: (action: BoardAction) => void;
  /** Where among the row's other cards a card carried over it would land; null when none is. */
  dropAt: number | null;
  pointerDownFor: PointerDownFor;
  lifted: number | null;
  locked: boolean;
  /** Places the picked card here; the board plans the tile's flight first. */
  onPlace: (tier: number) => void;
  dragNow: () => DragState;
  onMenu: () => void;
  /** The owner's: a card off the list, from the card's menu. */
  onRemove?: (item: number) => void;
  /** The owner's hold on the tier itself, by its band. */
  band?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    /** Where the row stands from its place while a tier is carried. */
    offset: number;
    lifted: boolean;
    carrying: boolean;
    open: () => void;
    /** One place up or down, from the keyboard. */
    step: (by: -1 | 1) => void;
  };
}

const TierRow = memo(function TierRow({
  meta,
  tiers,
  items,
  row,
  selected,
  tier,
  board,
  selectedTitle,
  coarse,
  dispatch,
  dropAt,
  pointerDownFor,
  lifted,
  locked,
  onPlace,
  dragNow,
  onMenu,
  onRemove,
  band,
}: TierRowProps) {
  if (meta === undefined) return null;
  const armed = !locked && selected !== null && !row.includes(selected);
  const targeted = dropAt !== null;
  // Keep the destination's geometry while crossing tiers. A new flex item
  // can wrap to another line and move the target out from under the pointer.
  const local = lifted !== null && targeted && row.includes(lifted);
  const others = local ? row.filter((item) => item !== lifted) : row;
  const landing = targeted ? Math.min(dropAt, others.length) : null;
  const shown =
    local && landing !== null
      ? [...others.slice(0, landing), lifted, ...others.slice(landing)]
      : row;
  const place = () => onPlace(tier);
  // The tier as the row's button says it: its letter, and its caption when it has one.
  const where =
    meta.caption === null || meta.caption === "" ? meta.label : `${meta.label} · ${meta.caption}`;
  // A card being placed has the band for its button; the tier is held only otherwise.
  const held = armed ? undefined : band;
  const classes = [
    "tier",
    "band",
    armed && "tier--armed",
    targeted && "tier--target",
    held?.lifted === true && "tier--lifted",
    held?.carrying === true && !held.lifted && "tier--shifting",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      style={
        {
          "--band-light": meta.colorLight,
          "--band-dark": meta.colorDark,
          transform: held?.offset ? `translateY(${held.offset}px)` : undefined,
        } as CSSProperties
      }
      onClick={armed ? place : undefined}
      data-drop={`tier:${tier}`}
    >
      <div
        className={held === undefined ? "tier__band" : "tier__band tier__band--held"}
        onPointerDown={held?.onPointerDown}
        onKeyDown={
          held === undefined
            ? undefined
            : (event) => {
                // Alt and an arrow on the band, its pencil focused: the tier one place up or down.
                if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                event.preventDefault();
                held.step(event.key === "ArrowUp" ? -1 : 1);
              }
        }
      >
        <TierLabel label={meta.label} caption={meta.caption} band={board} />
        {meta.caption !== null && <bdi className="tier__caption">{meta.caption}</bdi>}
        {armed && selectedTitle !== null && (
          <button
            type="button"
            className="tier__place"
            aria-label={fill(strings.rank.placeIn, { name: selectedTitle, tier: where })}
            aria-keyshortcuts={tier < 9 ? String(tier + 1) : undefined}
            onClick={(event) => {
              event.stopPropagation();
              place();
            }}
          />
        )}
        {held !== undefined && (
          <button
            type="button"
            className="tier__edit"
            aria-label={fill(strings.boards.editTierOf, { name: meta.label })}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onClick={held.open}
          >
            <Icon name="edit" />
          </button>
        )}
      </div>
      <ul className="tier__items" aria-label={meta.label}>
        {targeted && row.length === 0 && (
          <li className="tile-slot" aria-hidden="true">
            <span className="tile--slot" />
          </li>
        )}
        {shown.map((item, i) => (
          <Tile
            insertion={
              !local && landing !== null && i === Math.min(landing, row.length - 1)
                ? landing === row.length
                  ? "after"
                  : "before"
                : undefined
            }
            key={item}
            card={items[item]}
            tiers={tiers}
            item={item}
            board={board}
            coarse={coarse}
            selected={selected === item}
            lifted={lifted === item}
            locked={locked}
            dispatch={dispatch}
            pointerDownFor={pointerDownFor}
            dragNow={dragNow}
            onMenu={onMenu}
            current={tier}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </div>
  );
});

/**
 * A card that moves is drawn anew in its new row, and the button that had
 * focus goes with the old one. Focus follows it there, or to the card picked
 * next from the pool, so a keyboard keeps its place; and every move is said
 * aloud, a move between tiers too, which changes no count.
 */
function useMoveFollowing(
  section: RefObject<HTMLElement | null>,
  list: PublishedList,
  rows: Rows,
  selected: number | null,
  askForCards: boolean,
) {
  const focused = useRef<number | null>(null);
  const announcer = useRef<HTMLParagraphElement>(null);
  const before = useRef(rows);
  useLayoutEffect(() => {
    const was = before.current;
    before.current = rows;
    if (was === rows) return;
    // Each card's row looked up once per arrangement: searching the rows for
    // every card took millions of steps on a list of 2,000.
    const rowsBy = (of: Rows) =>
      new Map(of.flatMap((row, tier) => row.map((item) => [item, tier])));
    const wasIn = rowsBy(was);
    const nowIn = rowsBy(rows);
    const rowOf = (of: Map<number, number>, item: number) => of.get(item) ?? -1;
    const moved =
      was.length === rows.length
        ? list.items.findIndex((_, item) => rowOf(wasIn, item) !== rowOf(nowIn, item))
        : -1;
    const card = list.items[moved];
    if (card !== undefined && announcer.current !== null) {
      const tier = list.tiers[rowOf(nowIn, moved)];
      announcer.current.textContent =
        tier === undefined
          ? fill(strings.rank.cardInPool, { name: card.title })
          : fill(strings.rank.cardIn, { name: card.title, tier: tier.label });
    }
    const active = document.activeElement;
    if (focused.current === null || (active !== null && active !== document.body)) return;
    if (selected === null && askForCards) return;
    const target = selected ?? focused.current;
    section.current?.querySelector<HTMLElement>(`button[data-item="${target}"]`)?.focus();
  }, [rows, selected, list, section, askForCards]);
  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const item = event.target instanceof HTMLButtonElement ? event.target.dataset.item : undefined;
    if (item !== undefined) focused.current = Number(item);
  }, []);
  return { announcer, onFocus };
}
