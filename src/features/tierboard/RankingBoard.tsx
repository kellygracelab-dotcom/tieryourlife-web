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
import type { PublishedList, PublishedTier } from "../../api/types";
import { useSession } from "../../app/session";
import { keepRanking, noteTake } from "../../lib/api";
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
import type { DragState } from "./drag";
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
} from "./model";
import { useTileDrag, type HitTest } from "./useTileDrag";
import { useTierMove, type TierEditing } from "./useTierMove";
import { BoardFrameContext } from "./boardFrame";
import { DockToggle } from "./DockToggle";
import { useDock } from "./useDock";
import { useFixedDock } from "./useFixedDock";
import { TRAY_DOTS, useTray } from "./useTray";
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
    /** A menu on every card for moving it without a drag: a finger without a keyboard, or a tenth tier. */
    moveMenu?: boolean;
    /** The tiers themselves, changed on the board: carried by their band, opened by a double tap. */
    tiers?: TierEditing;
  };
}

interface RankingBoardProps {
  list: PublishedList;
  hitTest?: HitTest;
  store?: KeyValueStore;
  keep?: Keep;
  take?: (listId: string) => Promise<void>;
  share?: Share;
  edit?: EditMode;
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed"; error: ApiError };

type PointerDownFor = (item: number) => (event: ReactPointerEvent<HTMLElement>) => void;

/** The widest a tile is drawn (board.css): pictures are asked for at this size. */
const TILE_WIDTH = 64;

/** A pool longer than this gets a search box in the side column. */
export const POOL_SEARCH_FROM = 24;

interface TileProps {
  list: PublishedList;
  item: number;
  selected: boolean;
  lifted: boolean;
  locked: boolean;
  dispatch: (action: BoardAction) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** The owner may take a card off the list; a button beside the tile, never inside it. */
  onRemove?: () => void;
  /** A menu beside the tile for moving without a drag: every tier, the pool, off the list. */
  move?: { tiers: readonly PublishedTier[]; current: number | null };
  /** Where a card dragged over this row would land, next to this one. */
  insert?: "before" | "after";
}

function Tile({
  list,
  item,
  selected,
  lifted,
  locked,
  dispatch,
  onPointerDown,
  onRemove,
  move,
  insert,
}: TileProps) {
  const [moving, setMoving] = useState(false);
  const closeMove = useCallback(() => setMoving(false), []);
  const card = list.items[item];
  if (card === undefined) return null;
  const classes = ["tile", selected && "tile--selected", lifted && "tile--lifted"]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      className={
        [
          (onRemove !== undefined || move !== undefined) && "tile-holder--removable",
          insert !== undefined && `tile-holder--insert-${insert}`,
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
    >
      <button
        type="button"
        className={classes}
        aria-pressed={selected}
        aria-label={card.title}
        title={card.title}
        disabled={locked}
        data-item={item}
        onClick={(event) => {
          // The armed row underneath would take the same tap as "place here".
          event.stopPropagation();
          dispatch({ type: "select", item });
        }}
        onPointerDown={locked ? undefined : onPointerDown}
      >
        {card.imageUrl !== null ? (
          <img {...sizedFor(card.imageUrl, TILE_WIDTH)} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="tile__name">{card.title}</span>
        )}
      </button>
      {onRemove !== undefined && (
        <button
          type="button"
          className="tile__remove"
          aria-label={fill(strings.new.remove, { name: card.title })}
          disabled={locked}
          onClick={onRemove}
        >
          <Icon name="close" />
        </button>
      )}
      {move !== undefined && !locked && (
        <>
          <button
            type="button"
            className="tile__more"
            aria-label={fill(strings.boards.moveMenu, { name: card.title })}
            aria-haspopup="dialog"
            aria-expanded={moving}
            onClick={(event) => {
              event.stopPropagation();
              setMoving(true);
            }}
          >
            <Icon name="more_vert" />
          </button>
          {moving && (
            <MoveSheet
              name={card.title}
              tiers={move.tiers}
              current={move.current}
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
        </>
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

/** Where the board keeps a list's rows on this device; the list page reads the same place. */
function useBoard(
  list: PublishedList,
  store: KeyValueStore,
  initialRows: readonly (readonly number[])[] | null = null,
) {
  const scope = scopeOf(list);
  const [state, dispatch] = useReducer(reduce, list, (l) =>
    init(l.tiers.length, l.items.length, loadDraft(store, scope) ?? initialRows),
  );
  // The list changed shape under the board — the owner added or took away a
  // card — and the rows come from the page again. A state that follows a prop
  // is adjusted during the render, React's way, not in an effect.
  if (state.itemCount !== list.items.length || state.rows.length !== list.tiers.length) {
    dispatch({
      type: "reset",
      tierCount: list.tiers.length,
      itemCount: list.items.length,
      rows: loadDraft(store, scope) ?? initialRows,
    });
  }
  useEffect(() => {
    saveDraft(store, scope, state.rows);
    // Only the rows are worth keeping; scope fields are derived from the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rows, store, list.id, list.updatedAt, list.items.length, list.tiers.length]);
  return [state, dispatch] as const;
}

export function RankingBoard({
  list,
  hitTest,
  store = localStorageStore,
  keep = keepRanking,
  take = noteTake,
  share = downloadShare,
  edit,
}: RankingBoardProps) {
  const [state, dispatch] = useBoard(list, store, edit?.rows ?? null);
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
  const tierMove = useTierMove(boardBox, tierEditing);

  // The pool's place on a wide screen, and what the page lends the board: a
  // slot in its header for the bar while the pool is docked under the board.
  const { dock, rows, wide, choose, startResize } = useDock(store);
  // On a narrow window the box that brings cards in waits behind Add, in the
  // pool, whichever head the pool shows; on a wide one it stands in the pool.
  const [adding, setAdding] = useState(false);
  const tools = edit?.owner?.tools;
  const addButton = tools !== undefined && !wide && (
    <button
      type="button"
      className="btn btn--tonal pool__add"
      aria-expanded={adding}
      onClick={() => setAdding((open) => !open)}
    >
      <Icon name="add" className="btn__icon" />
      <span>{strings.new.add}</span>
    </button>
  );
  const toolsPanel = tools !== undefined && (wide || adding) && (
    <div className={wide ? "pool__tools" : "pool__tools pool__tools--sheet"}>{tools}</div>
  );
  const docked = wide && dock === "under";
  const frame = useContext(BoardFrameContext);
  // On a wide screen the count and the actions stand in the page's header,
  // wherever the pool is: moving the pool does not move the buttons.
  const inHead = wide && frame.headSlot !== null;
  useEffect(() => {
    frame.report(wide ? dock : null);
    return () => frame.report(null);
  }, [frame, wide, dock]);

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
  const { tray, page, pages, readPage } = useTray(selected, shown.length);
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
    fixed: docked && !restEmpty,
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
      aria-label={strings.rank.yours}
      ref={section}
    >
      <div className="ranking__main">
        {save.status === "failed" && (
          <p className="ranking__error" role="alert">
            {save.error.kind === "offline" ? strings.rank.failedOffline : strings.rank.failedOther}
          </p>
        )}

        {edit === undefined && (
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

        <div className="board" ref={boardBox}>
          {list.tiers.map((tier, index) => (
            <TierRow
              key={`${index}-${tier.label}`}
              list={list}
              state={state}
              tier={index}
              selectedTitle={selectedTitle}
              dispatch={dispatch}
              dragState={drag.state}
              pointerDownFor={drag.onPointerDown}
              lifted={lifted}
              locked={locked}
              onPlace={placeSelected}
              onRemove={edit?.owner?.moveMenu ? edit.owner.remove : undefined}
              moveMenu={edit?.owner?.moveMenu}
              band={
                tierEditing === undefined || locked
                  ? undefined
                  : {
                      onPointerDown: tierMove.onPointerDown(index),
                      offset: tierMove.offsetOf(index),
                      lifted: tierMove.lifted === index,
                      carrying: tierMove.lifted !== null,
                      open: () => tierEditing.open(index),
                    }
              }
            />
          ))}
          {tierEditing?.add !== undefined && (
            <Button className="board__add-tier" icon="add" onClick={tierEditing.add}>
              {strings.new.addTier}
            </Button>
          )}
          <div className="board__end" ref={boardEnd} aria-hidden="true" />
        </div>
      </div>

      <div className="ranking__side">
        {inHead && frame.headSlot !== null ? createPortal(bar, frame.headSlot) : bar}

        {!restEmpty && (
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
            {allPlaced && !wide ? (
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
                <div className={allPlaced ? "pool__head pool__head--done" : "pool__head"}>
                  <div className="pool__lead">
                    {allPlaced ? (
                      <p className="pool__done-title">
                        <Icon name="check_circle" className="pool__done-icon" />
                        {plural(strings.rank.allPlaced, list.items.length)}
                      </p>
                    ) : (
                      <h2 className="pool__title">
                        {plural(
                          edit?.owner?.live ? strings.boards.pool : strings.rank.left,
                          left.length,
                        )}
                      </h2>
                    )}
                    {addButton}
                    <DockToggle dock={dock} onChoose={choose} />
                  </div>
                  {toolsPanel}
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
                          : strings.rank.hintPlaceTouch}
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
                          selected={selected === item}
                          lifted={lifted === item}
                          locked={locked}
                          dispatch={dispatch}
                          onPointerDown={drag.onPointerDown(item)}
                          onRemove={
                            edit?.owner === undefined ? undefined : () => edit.owner?.remove(item)
                          }
                          move={
                            edit?.owner?.moveMenu ? { tiers: list.tiers, current: null } : undefined
                          }
                        />
                      ))}
                    </ul>
                    {shown.length === 0 && <p className="pool__none">{strings.rank.searchNone}</p>}
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

      {edit === undefined && (
        <KeepDialog state={offer} onGoogle={onGoogle} onLinkOnly={onLinkOnly} />
      )}
      <DragGhost state={drag.state} items={list.items} />
    </section>
  );
}

interface TierRowProps {
  list: PublishedList;
  state: BoardState;
  tier: number;
  selectedTitle: string | null;
  dispatch: (action: BoardAction) => void;
  dragState: DragState;
  pointerDownFor: PointerDownFor;
  lifted: number | null;
  locked: boolean;
  /** Places the picked card here; the board plans the tile's flight first. */
  onPlace: (tier: number) => void;
  /** The owner's: a card off the list, and the menu for moving one without a drag. */
  onRemove?: (item: number) => void;
  moveMenu?: boolean;
  /** The owner's hold on the tier itself, by its band. */
  band?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    /** Where the row stands from its place while a tier is carried. */
    offset: number;
    lifted: boolean;
    carrying: boolean;
    open: () => void;
  };
}

function TierRow({
  list,
  state,
  tier,
  selectedTitle,
  dispatch,
  dragState,
  pointerDownFor,
  lifted,
  locked,
  onPlace,
  onRemove,
  moveMenu = false,
  band,
}: TierRowProps) {
  const meta = list.tiers[tier];
  const row = state.rows[tier] ?? [];
  if (meta === undefined) return null;
  const selected = state.selected;
  const armed = !locked && selected !== null && !row.includes(selected);
  const target = dragState.phase === "dragging" ? dragState.target : null;
  const targeted = target?.kind === "tier" && target.tier === tier;
  // The mark between two cards: before the card at the landing place, or
  // after the last one. The held card itself does not count.
  const others = row.filter((item) => item !== lifted);
  const landing = targeted ? Math.min(target.index, others.length) : null;
  const insertOf = (item: number): "before" | "after" | undefined => {
    if (landing === null || item === lifted) return undefined;
    const place = others.indexOf(item);
    if (place === landing) return "before";
    return landing === others.length && place === others.length - 1 ? "after" : undefined;
  };
  const place = () => onPlace(tier);
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
      >
        <span className="tier__label">{meta.label}</span>
        {meta.caption !== null && <span className="tier__caption">{meta.caption}</span>}
        {tier < 9 && (
          <span className="tier__key" aria-hidden="true">
            {tier + 1}
          </span>
        )}
        {armed && selectedTitle !== null && (
          <button
            type="button"
            className="tier__place"
            onClick={(event) => {
              // The row would place it a second time and drop the pick of the next card.
              event.stopPropagation();
              place();
            }}
          >
            {fill(strings.rank.placeIn, { name: selectedTitle, tier: meta.label })}
          </button>
        )}
        {held !== undefined && (
          <button
            type="button"
            className="tier__edit"
            aria-label={fill(strings.boards.editTierOf, { name: meta.label })}
            onClick={held.open}
          >
            <Icon name="edit" />
          </button>
        )}
      </div>
      <ul className="tier__items" aria-label={meta.label}>
        {row.map((item) => (
          <Tile
            key={item}
            list={list}
            item={item}
            selected={selected === item}
            lifted={lifted === item}
            locked={locked}
            dispatch={dispatch}
            onPointerDown={pointerDownFor(item)}
            insert={insertOf(item)}
            onRemove={onRemove === undefined ? undefined : () => onRemove(item)}
            move={moveMenu ? { tiers: list.tiers, current: tier } : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
