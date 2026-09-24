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
} from "react";
import { createPortal } from "react-dom";
import type { ApiError } from "../../api/errors";
import type { SavedRanking } from "../../api/rank";
import type { PublishedList } from "../../api/types";
import { useSession } from "../../app/session";
import { keepRanking, noteTake } from "../../lib/api";
import { KeepDialog, type KeepState } from "../ranking/KeepDialog";
import { writeKept } from "../ranking/kept";
import { ResultBar, type FinishState } from "../ranking/ResultBar";
import { downloadShare, type Share } from "../ranking/shareImage";
import { errorOf } from "../list/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { DragGhost } from "./DragGhost";
import { flyIn } from "./flight";
import type { DragState } from "./drag";
import { loadDraft, localStorageStore, saveDraft, type DraftScope, type DraftStore } from "./draft";
import {
  canUndo,
  init,
  placedCount,
  pool,
  reduce,
  tierForKey,
  type BoardAction,
  type BoardState,
} from "./model";
import { useTileDrag, type HitTest } from "./useTileDrag";
import { BoardFrameContext } from "./boardFrame";
import type { DockRows } from "./dock";
import { DockToggle } from "./DockToggle";
import { useDock } from "./useDock";
import "./board.css";
import "./ranking.css";

export type Keep = (listId: string, rows: readonly (readonly number[])[]) => Promise<SavedRanking>;

/** The board as the owner's editor: it starts from what is saved, and Save writes it back. */
export interface EditMode {
  rows: readonly (readonly number[])[];
  save: (rows: readonly (readonly number[])[]) => Promise<unknown>;
  cancel: () => void;
}

interface RankingBoardProps {
  list: PublishedList;
  hitTest?: HitTest;
  store?: DraftStore;
  keep?: Keep;
  take?: (listId: string) => Promise<void>;
  share?: Share;
  edit?: EditMode;
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed"; error: ApiError };

type PointerDownFor = (item: number) => (event: ReactPointerEvent<HTMLElement>) => void;

/** The tray's side padding in ranking.css: a picked card stops this far from the edge. */
const TRAY_INSET = 14;
/** The tray's dots: one per this many tiles, this many at most, then "+n". An indicator, not a control. */
const TRAY_PAGE = 5;
/** A pool longer than this gets a search box in the side column. */
export const POOL_SEARCH_FROM = 24;
const TRAY_DOTS = 8;
/** The gap between tiles in ranking.css, part of a tile's stride. */
const TRAY_GAP = 8;

interface TileProps {
  list: PublishedList;
  item: number;
  selected: boolean;
  lifted: boolean;
  locked: boolean;
  dispatch: (action: BoardAction) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

function Tile({ list, item, selected, lifted, locked, dispatch, onPointerDown }: TileProps) {
  const card = list.items[item];
  if (card === undefined) return null;
  const classes = ["tile", selected && "tile--selected", lifted && "tile--lifted"]
    .filter(Boolean)
    .join(" ");
  return (
    <li>
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
          <img src={card.imageUrl} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="tile__name">{card.title}</span>
        )}
      </button>
    </li>
  );
}

const scopeOf = (list: PublishedList): DraftScope => ({
  id: list.id,
  updatedAt: list.updatedAt,
  itemCount: list.items.length,
  tierCount: list.tiers.length,
});

function useBoard(
  list: PublishedList,
  store: DraftStore,
  initialRows: readonly (readonly number[])[] | null = null,
) {
  const scope = scopeOf(list);
  const [state, dispatch] = useReducer(reduce, list, (l) =>
    init(l.tiers.length, l.items.length, loadDraft(store, scope) ?? initialRows),
  );
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
  const tray = useRef<HTMLUListElement>(null);

  // The pool's place on a wide screen, and what the page lends the board: a
  // slot in its header for the bar while the pool is docked under the board.
  const { dock, rows, wide, choose, resize } = useDock(store);
  const docked = wide && dock === "under";
  const frame = useContext(BoardFrameContext);
  useEffect(() => {
    frame.report(wide ? dock : null);
    return () => frame.report(null);
  }, [frame, wide, dock]);

  // The 6 px strip on the dock's top edge: drag it to show one to four rows of cards.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grip = event.currentTarget;
    const startY = event.clientY;
    let last = rows;
    grip.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const next = Math.min(
        4,
        Math.max(1, rows + Math.round((startY - move.clientY) / 100)),
      ) as DockRows;
      if (next === last) return;
      last = next;
      resize(next);
    };
    const onEnd = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onEnd);
      grip.removeEventListener("pointercancel", onEnd);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onEnd);
    grip.addEventListener("pointercancel", onEnd);
  };

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

  // The tray's page, for the dots under it.
  const [page, setPage] = useState(0);
  // The side column's search, for a pool too long to scan: it narrows what
  // the tray shows, and `/` puts the cursor in it.
  const [query, setQuery] = useState("");

  // On a phone the pool is one scrolling row; the picked card comes to its
  // start. Only the row scrolls: on a wide screen the pool may be off screen,
  // and the page must not jump to it after every key press. The distance is
  // measured on the screen and scrolled by, because where a row's scroll
  // position counts from differs between left-to-right and right-to-left,
  // and "start" is the right edge in Arabic.
  useEffect(() => {
    const row = tray.current;
    if (row === null || selected === null || typeof row.scrollBy !== "function") return;
    const holder = row.querySelector<HTMLElement>(`[data-item="${selected}"]`)?.parentElement;
    if (holder == null) return;
    const card = holder.getBoundingClientRect();
    const edge = row.getBoundingClientRect();
    const rightToLeft = getComputedStyle(row).direction === "rtl";
    const left = rightToLeft
      ? card.right - edge.right + TRAY_INSET
      : card.left - edge.left - TRAY_INSET;
    row.scrollBy({ left, behavior: "smooth" });
  }, [selected]);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        return dispatch({ type: "undo" });
      }
      const tier = tierForKey(event.key, list.tiers.length);
      if (tier !== null) placeSelected(tier);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, list.tiers.length, placeSelected, locked]);

  const left = pool(state);
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? left
      : left.filter((item) => list.items[item]?.title.toLowerCase().includes(needle) ?? false);
  const keyboardTiers = Math.min(list.tiers.length, 9);
  const pages = Math.ceil(shown.length / TRAY_PAGE);
  // Which page the tray is on: measured, because a tile's stride is the
  // stylesheet's, and scrollLeft counts from the right in Arabic.
  const readPage = useCallback(() => {
    const row = tray.current;
    const holder = row?.firstElementChild;
    if (row == null || !(holder instanceof HTMLElement)) return;
    const stride = holder.offsetWidth + TRAY_GAP;
    setPage(Math.min(pages - 1, Math.round(Math.abs(row.scrollLeft) / (stride * TRAY_PAGE))));
  }, [pages]);
  useEffect(() => {
    readPage();
  }, [readPage, shown.length]);
  const picked = selected !== null && left.includes(selected);
  const allPlaced = left.length === 0 && finish.status !== "done";
  // Finished with every card placed: the tray has nothing to say and goes.
  const restEmpty = finish.status === "done" && left.length === 0;
  const poolClasses = [
    "pool",
    drag.state.phase === "dragging" && drag.state.target?.kind === "pool" && "pool--target",
    picked && "pool--picked",
    lifted !== null && left.includes(lifted) && "pool--dragging",
    finish.status === "done" && "pool--rest",
  ]
    .filter(Boolean)
    .join(" ");

  const bar = (
    <div className={docked ? "ranking__bar ranking__bar--head" : "ranking__bar"}>
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
        {edit !== undefined && (
          <Button onClick={edit.cancel} disabled={locked}>
            {strings.rank.cancel}
          </Button>
        )}
        {edit !== undefined && (
          <Button
            variant="filled"
            icon="check"
            onClick={onSave}
            disabled={locked || placedCount(state) === 0}
          >
            {save.status === "saving" ? strings.rank.savingShort : strings.rank.saveChanges}
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

        <div className="board">
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
            />
          ))}
        </div>
      </div>

      <div className="ranking__side">
        {docked && frame.headSlot !== null ? createPortal(bar, frame.headSlot) : bar}

        {!restEmpty && (
          <div
            key={dock}
            className={poolClasses}
            data-drop="pool"
            style={{ "--dock-rows": rows } as CSSProperties}
          >
            {docked && (
              <div className="pool__grip" onPointerDown={startResize} aria-hidden="true" />
            )}
            {allPlaced ? (
              <div className="pool__done">
                <p className="pool__done-title">
                  <Icon name="check_circle" className="pool__done-icon" />
                  {plural(strings.rank.allPlaced, list.items.length)}
                </p>
                <p className="pool__done-note">
                  {edit === undefined ? strings.rank.allPlacedNote : strings.rank.allPlacedNoteEdit}
                </p>
                <Button
                  variant="filled"
                  icon="check"
                  onClick={edit === undefined ? onFinish : onSave}
                  disabled={locked}
                >
                  {edit === undefined ? strings.rank.finish : strings.rank.saveChanges}
                </Button>
              </div>
            ) : (
              <>
                <div className="pool__head">
                  <div className="pool__lead">
                    <h2 className="pool__title">{plural(strings.rank.left, left.length)}</h2>
                    <DockToggle dock={dock} onChoose={choose} />
                  </div>
                  {left.length > POOL_SEARCH_FROM && (
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
                  <p className="pool__hint pool__hint--keys">
                    {selectedTitle === null
                      ? fill(strings.rank.hintPick, { keys: `1–${keyboardTiers}` })
                      : fill(strings.rank.hintPlace, { name: selectedTitle })}
                  </p>
                  <p className="pool__hint pool__hint--touch">
                    {selectedTitle === null
                      ? strings.rank.hintPickTouch
                      : strings.rank.hintPlaceTouch}
                  </p>
                </div>
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
}: TierRowProps) {
  const meta = list.tiers[tier];
  const row = state.rows[tier] ?? [];
  if (meta === undefined) return null;
  const selected = state.selected;
  const armed = !locked && selected !== null && !row.includes(selected);
  const targeted =
    dragState.phase === "dragging" &&
    dragState.target?.kind === "tier" &&
    dragState.target.tier === tier;
  const place = () => onPlace(tier);
  const classes = ["tier", "band", armed && "tier--armed", targeted && "tier--target"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      style={{ "--band-light": meta.colorLight, "--band-dark": meta.colorDark } as CSSProperties}
      onClick={armed ? place : undefined}
      data-drop={`tier:${tier}`}
    >
      <div className="tier__band">
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
          />
        ))}
      </ul>
    </div>
  );
}
