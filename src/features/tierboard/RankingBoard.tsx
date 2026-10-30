import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ApiError } from "../../api/errors";
import type { SavedRanking } from "../../api/rank";
import type { PublishedList } from "../../api/types";
import { useSession } from "../../app/session";
import { keepListRanking, keepRanking, noteTake } from "../../lib/api";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { KeepDialog, type KeepState } from "../ranking/KeepDialog";
import { writeKept } from "../ranking/kept";
import { ResultBar, type FinishState } from "../ranking/ResultBar";
import { downloadShare, type Share } from "../ranking/share";
import { errorOf } from "../../api/errors";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { MoveSheet } from "./MoveSheet";
import { DragGhost } from "./DragGhost";
import { flyIn } from "./flight";
import { DOUBLE_TAP_MS, type DragState } from "./drag";
import { loadDraft, saveDraft, scopeOf } from "./draft";
import {
  canUndo,
  init,
  placedCount,
  pool,
  reduce,
  tierForKey,
  tierOf,
  type BoardAction,
  type BoardState,
  type Rows,
} from "./model";
import { useTileDrag, type HitTest } from "./useTileDrag";
import { useTierMove, type TierEditing } from "./useTierMove";
import { BoardFrameContext } from "./boardFrame";
import { DockToggle } from "./DockToggle";
import { useDock } from "./useDock";
import { useFixedDock } from "./useFixedDock";
import { TRAY_DOTS, useTray } from "./useTray";
import { CardName } from "./CardName";
import { useBoardSize } from "./useBoardSize";
import type { BoardSize } from "./nameFit";
import "./board.css";
import "./ranking.css";
import { sizedFor } from "../../lib/pictureSize";

export type Keep = (listId: string, rows: readonly (readonly number[])[]) => Promise<SavedRanking>;

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
  onStart: (rows: Rows) => void;
}

interface RankingBoardProps {
  list: PublishedList;
  hitTest?: HitTest;
  store?: KeyValueStore;
  keep?: Keep;
  take?: (listId: string) => Promise<void>;
  /** Puts a signed-in reader's finished placing among the list's rankings. */
  tell?: (list: PublishedList, rows: readonly (readonly number[])[]) => Promise<unknown>;
  share?: Share;
  edit?: EditMode;
  /** Every tier one line of cards that scrolls sideways: the phone's Single strip. */
  strip?: boolean;
  seed?: Seed;
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

interface TileProps {
  list: PublishedList;
  item: number;
  board: BoardSize;
  selected: boolean;
  lifted: boolean;
  locked: boolean;
  dispatch: (action: BoardAction) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** The drag as it is right now: a press that lifted a card opens no menu. */
  dragNow: () => DragState;
  /** Where the card is, for its menu: a tier, or null in the pool. */
  current: number | null;
  /** The owner may take a card off the list, from its menu. */
  onRemove?: () => void;
  /** The card's menu opened: the board counts it, for its hint. */
  onMenu: () => void;
}

/**
 * A card on a board one can change. A tap picks it, for a tier's tap or a
 * number key to place; a double tap or a double click opens its menu, as on
 * the phone: every tier, back to the pool, and off the list for the owner.
 * Nothing sits on the card itself, so a press meant for the card cannot take
 * it off the list. The keyboard opens the menu with the context-menu key or
 * Shift+F10.
 */
function Tile({
  list,
  item,
  board,
  selected,
  lifted,
  locked,
  dispatch,
  onPointerDown,
  dragNow,
  current,
  onRemove,
  onMenu,
}: TileProps) {
  const [moving, setMoving] = useState(false);
  const closeMove = useCallback(() => setMoving(false), []);
  // When the last click came; two within DOUBLE_TAP_MS are a double click.
  // Clicks are timed rather than read from dblclick, which a double tap does
  // not send on every phone, and a drag between them sends no click at all.
  const lastClick = useRef(0);
  const card = list.items[item];
  if (card === undefined) return null;
  const classes = ["tile", selected && "tile--selected", lifted && "tile--lifted"]
    .filter(Boolean)
    .join(" ");
  const openMenu = () => {
    // Nothing picked while the menu is open: a number key does nothing, and a
    // move from the menu does not pass the pick on to the next card.
    dispatch({ type: "select", item: null });
    setMoving(true);
    onMenu();
  };
  return (
    <li>
      <button
        type="button"
        className={classes}
        aria-pressed={selected}
        aria-label={card.title}
        aria-haspopup="dialog"
        aria-keyshortcuts="Shift+F10"
        title={card.title}
        disabled={locked}
        data-item={item}
        onClick={(event) => {
          // The armed row underneath would take the same tap as "place here".
          event.stopPropagation();
          // Enter and Space click too (detail 0): they pick, and twice is not a double click.
          const at = event.detail > 0 ? Date.now() : 0;
          if (at > 0 && at - lastClick.current < DOUBLE_TAP_MS) {
            lastClick.current = 0;
            openMenu();
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
          openMenu();
        }}
        onKeyDown={(event) => {
          // Where the browser turns neither key into a context menu, Safari among them.
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          openMenu();
        }}
        onPointerDown={locked ? undefined : onPointerDown}
      >
        {card.imageUrl !== null ? (
          <img {...sizedFor(card.imageUrl, TILE_WIDTH)} alt="" loading="lazy" draggable={false} />
        ) : (
          <CardName title={card.title} board={board} />
        )}
      </button>
      {moving && !locked && (
        <MoveSheet
          name={card.title}
          tiers={list.tiers}
          current={current}
          onPlace={(tier) => {
            setMoving(false);
            dispatch({ type: "place", item, tier });
          }}
          onUnplace={() => {
            setMoving(false);
            dispatch({ type: "unplace", item });
          }}
          onRemove={
            onRemove === undefined
              ? undefined
              : () => {
                  setMoving(false);
                  onRemove();
                }
          }
          onClose={closeMove}
        />
      )}
    </li>
  );
}

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
) {
  const scope = scopeOf(list);
  const kept = () => (seeded ? null : loadDraft(store, scope));
  const [state, dispatch] = useReducer(reduce, list, (l) =>
    init(l.tiers.length, l.items.length, kept() ?? initialRows),
  );
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
  return [state, dispatch] as const;
}

export function RankingBoard({
  list,
  hitTest,
  store = localStorageStore,
  keep = keepRanking,
  take = noteTake,
  tell = keepListRanking,
  share = downloadShare,
  edit,
  strip = false,
  seed,
}: RankingBoardProps) {
  const seeded = seed !== undefined;
  const [state, dispatch] = useBoard(list, store, seed?.rows ?? edit?.rows ?? null, seeded);
  const boardSize = useBoardSize();
  const [finish, setFinish] = useState<FinishState>({ status: "idle" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const locked = finish.status === "saving" || finish.status === "done" || save.status === "saving";
  const { account, signIn } = useSession();
  const guest = account?.kind !== "signedIn";
  const [offer, setOffer] = useState<KeepState>("closed");
  const drag = useTileDrag(dispatch, hitTest);
  const lifted = drag.state.phase === "dragging" ? drag.state.item : null;
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
  const { dock, rows, wide, choose, startResize } = useDock(store);
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
  useEffect(() => {
    if (!askForCards) return;
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    poolBox.current?.querySelector<HTMLInputElement>(".pool__tools input[type='text']")?.focus();
  }, [askForCards]);
  const docked = wide && dock === "under";
  const frame = useContext(BoardFrameContext);
  // On a wide screen the count and the actions stand in the page's header,
  // wherever the pool is: moving the pool does not move the buttons.
  const inHead = wide && frame.headSlot !== null;
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
  const [menusOpened, setMenusOpened] = useState(() => Number(store.read(MENU_COUNT_KEY)) || 0);
  const onMenu = useCallback(() => {
    const next = (Number(store.read(MENU_COUNT_KEY)) || 0) + 1;
    store.write(MENU_COUNT_KEY, String(next));
    setMenusOpened(next);
  }, [store]);

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
    keep(list.id, state.rows).then(
      (kept) => {
        writeKept(store, list.id, kept);
        setFinish({ status: "done", code: kept.code });
        if (guest) setOffer("open");
        void take(list.id);
        // The /r/ link is the site's own; the rankings the app shows are the
        // account's, so a reader with one is counted there too. A miss there
        // costs nothing the link has not kept.
        if (!guest && edit === undefined) tell(list, state.rows).catch(() => undefined);
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

  // The owner's page keeps the draft: every placement goes out as it happens.
  const report = useRef(edit?.owner?.onChange);
  useEffect(() => {
    report.current = edit?.owner?.onChange;
  });
  useEffect(() => {
    report.current?.(state.rows);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        return dispatch({ type: "undo" });
      }
      const tier = tierForKey(event.key, list.tiers.length);
      if (tier !== null) placeSelected(tier);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, list.tiers.length, placeSelected, locked, selected, state]);

  const left = pool(state);
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? left
      : left.filter((item) => list.items[item]?.title.toLowerCase().includes(needle) ?? false);
  const keyboardTiers = Math.min(list.tiers.length, 9);
  // On a phone the pool is one scrolling row with dots under it.
  // The tray waits out a double tap before it scrolls, or the second tap lands on another card.
  const { tray, page, pages, readPage } = useTray(selected, shown.length, DOUBLE_TAP_MS);
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
    drag.state.phase === "dragging" && drag.state.target?.kind === "pool" && "pool--target",
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
      className={docked ? "ranking ranking--under" : "ranking"}
      aria-label={seed?.label ?? strings.rank.yours}
      ref={section}
    >
      <div className="ranking__main">
        {save.status === "failed" && (
          <p className="ranking__error" role="alert">
            {save.error.kind === "offline" ? strings.rank.failedOffline : strings.rank.failedOther}
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
            kept={!guest}
            save={guest ? () => setOffer("open") : undefined}
          />
        )}

        {!inHead && edit?.owner?.status}

        <div className={strip ? "board board--strip" : "board"} ref={boardBox}>
          {list.tiers.map((tier, index) => (
            <TierRow
              key={`${index}-${tier.label}`}
              list={list}
              state={state}
              tier={index}
              board={boardSize}
              selectedTitle={selectedTitle}
              dispatch={dispatch}
              dragState={drag.state}
              pointerDownFor={drag.onPointerDown}
              lifted={lifted}
              locked={locked}
              onPlace={placeSelected}
              keys={!seeded}
              dragNow={drag.current}
              onMenu={onMenu}
              onRemove={edit?.owner?.remove}
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
        {seed !== undefined && selected !== null && (
          <p className="ranking__seed-hint" role="status">
            {seed.hint}
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
              <div className="pool__grip" onPointerDown={startResize} aria-hidden="true" />
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
                    <DockToggle dock={dock} onChoose={choose} />
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
                      {shown.map((item) => (
                        <Tile
                          key={item}
                          list={list}
                          item={item}
                          board={boardSize}
                          selected={selected === item}
                          lifted={lifted === item}
                          locked={locked}
                          dispatch={dispatch}
                          onPointerDown={drag.onPointerDown(item)}
                          dragNow={drag.current}
                          onMenu={onMenu}
                          current={null}
                          onRemove={
                            edit?.owner === undefined ? undefined : () => edit.owner?.remove(item)
                          }
                        />
                      ))}
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
      <DragGhost state={drag.state} items={list.items} board={boardSize} />
    </section>
  );
}

interface TierRowProps {
  list: PublishedList;
  state: BoardState;
  tier: number;
  board: BoardSize;
  selectedTitle: string | null;
  dispatch: (action: BoardAction) => void;
  dragState: DragState;
  pointerDownFor: PointerDownFor;
  lifted: number | null;
  locked: boolean;
  /** Places the picked card here; the board plans the tile's flight first. */
  onPlace: (tier: number) => void;
  /** The tier's number key on its band; Theirs on show has none. */
  keys: boolean;
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

function TierRow({
  list,
  state,
  tier,
  board,
  selectedTitle,
  dispatch,
  dragState,
  pointerDownFor,
  lifted,
  locked,
  onPlace,
  keys,
  dragNow,
  onMenu,
  onRemove,
  band,
}: TierRowProps) {
  const meta = list.tiers[tier];
  const row = state.rows[tier] ?? [];
  if (meta === undefined) return null;
  const selected = state.selected;
  const armed = !locked && selected !== null && !row.includes(selected);
  const target = dragState.phase === "dragging" ? dragState.target : null;
  const targeted = target?.kind === "tier" && target.tier === tier;
  // A card carried over the row takes its place there at once, the others
  // making room: the card itself when it is this row's, an empty slot of its
  // size when it comes from elsewhere (null below). Where it lands is read
  // from the others' middles, so the room it takes does not move the place.
  const others = row.filter((item) => item !== lifted);
  const landing = targeted ? Math.min(target.index, others.length) : null;
  const shown: readonly (number | null)[] =
    landing === null
      ? row
      : [
          ...others.slice(0, landing),
          lifted !== null && row.includes(lifted) ? lifted : null,
          ...others.slice(landing),
        ];
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
        <span className="tier__label">{meta.label}</span>
        {meta.caption !== null && <span className="tier__caption">{meta.caption}</span>}
        {/*
         * While a card is picked the corner's number becomes the row's own
         * button, a pill: the number for a keyboard, a plus for a finger and
         * past the ninth tier. It is in the tab order only while there is
         * something to place; the rest of the row takes a tap as well.
         */}
        {armed && selectedTitle !== null ? (
          <button
            type="button"
            className="tier__place"
            aria-label={fill(strings.rank.placeIn, { name: selectedTitle, tier: where })}
            onClick={(event) => {
              // The row would place it a second time and drop the pick of the next card.
              event.stopPropagation();
              place();
            }}
          >
            {tier < 9 && <span className="tier__place-key">{tier + 1}</span>}
            <Icon
              name="add"
              className={tier < 9 ? "tier__place-add" : "tier__place-add tier__place-add--only"}
            />
          </button>
        ) : (
          keys &&
          tier < 9 && (
            <span className="tier__key" aria-hidden="true">
              {tier + 1}
            </span>
          )
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
        {shown.map((item) =>
          item === null ? (
            <li key="slot" className="tile-slot" aria-hidden="true">
              <span className="tile tile--slot" />
            </li>
          ) : (
            <Tile
              key={item}
              list={list}
              item={item}
              board={board}
              selected={selected === item}
              lifted={lifted === item}
              locked={locked}
              dispatch={dispatch}
              onPointerDown={pointerDownFor(item)}
              dragNow={dragNow}
              onMenu={onMenu}
              current={tier}
              onRemove={onRemove === undefined ? undefined : () => onRemove(item)}
            />
          ),
        )}
      </ul>
    </div>
  );
}
