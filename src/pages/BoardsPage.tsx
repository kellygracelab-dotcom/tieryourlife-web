import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Category } from "../api/types";
import { usePageTitle } from "../app/pageTitle";
import { useSession } from "../app/session";
import { SignInButton } from "../app/SignInButton";
import {
  arrangeBoards,
  BOARD_SHOWS,
  BOARD_SORTS,
  isNarrowed,
  isOut,
  rankedCount,
  restoreBoard,
  setFavourite,
  shouldGroup,
  trashBoard,
  type Board,
  type BoardShow,
  type BoardSort,
} from "../features/boards/model";
import { type BoardsRepository } from "../features/boards/repository";
import { boards as site } from "../features/boards/owners";
import { useBoardSync } from "../features/boards/boardSync";
import { BoardRow } from "../features/boards/BoardRow";
import { BoardTile } from "../features/boards/BoardTile";
import { keepOldDraft } from "../features/boards/ownList";
import { takenDown, unpublished } from "../features/boards/takeDown";
import { nextUid, useBoards } from "../features/boards/useBoards";
import type { UnpublishBoard } from "../features/boards/BoardSettings";
import "../features/boards/boards.css";
import { unpublish as unpublishList } from "../lib/api";
import { localStorageStore, sessionStorageStore, type KeyValueStore } from "../lib/storage";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./BoardsPage.css";

interface BoardsPageProps {
  repository?: BoardsRepository;
  now?: () => number;
  /** Where the chosen view is remembered on this device. */
  store?: KeyValueStore;
  /** Where the search, the filter and the order wait while a list is open. */
  shelfStore?: KeyValueStore;
  unpublish?: UnpublishBoard;
}

/** Pictures in a grid, as the phone shows them first, or one board to a row with its tier ribbon. */
type BoardsView = "grid" | "rows";
export const VIEW_KEY = "boards.view";
const viewIn = (store: KeyValueStore): BoardsView =>
  store.read(VIEW_KEY) === "rows" ? "rows" : "grid";

/** The search, the filter and the order: the shelf as it was left, found again on the way back from a list. */
interface Shelf {
  sort: BoardSort;
  show: BoardShow;
  query: string;
}
export const SHELF_KEY = "boards.shelf";
function shelfIn(store: KeyValueStore): Shelf {
  const fresh: Shelf = { sort: "recent", show: "all", query: "" };
  try {
    const kept = JSON.parse(store.read(SHELF_KEY) ?? "null") as Partial<Shelf> | null;
    if (kept === null || typeof kept !== "object") return fresh;
    return {
      sort: BOARD_SORTS.find((sort) => sort === kept.sort) ?? fresh.sort,
      show: BOARD_SHOWS.find((show) => show === kept.show) ?? fresh.show,
      query: typeof kept.query === "string" ? kept.query : fresh.query,
    };
  } catch {
    return fresh;
  }
}

/** Which of them a link asks to show, by its ?show=. */
const shownIn = (search: string): string | null => new URLSearchParams(search).get("show");

/** What a board page leaves in the history when it sends a board to the trash. */
export interface BoardsPageState {
  trashed?: string[];
}

const SHOW_TEXT: Record<BoardShow, string> = {
  all: strings.boards.showAll,
  inProgress: strings.boards.showInProgress,
  public: strings.boards.filterPublic,
  saved: strings.boards.showSaved,
};

const SORT_TEXT: Record<BoardSort, string> = {
  recent: strings.boards.sortRecent,
  name: strings.boards.sortName,
  ranked: strings.boards.sortRanked,
  pool: strings.boards.sortPool,
};

/** Where an empty page starts: the phone's five suggestions, each a new list of that name in its section. */
const STARTS: { text: string; category: Category }[] = [
  { text: strings.boards.suggestFilms, category: "film_tv" },
  { text: strings.boards.suggestGames, category: "games" },
  { text: strings.boards.suggestRestaurants, category: "food" },
  { text: strings.boards.suggestAlbums, category: "music" },
  { text: strings.boards.suggestBooks, category: "books" },
];

function Group({
  heading,
  boards,
  view,
  selecting,
  selected,
  onSelect,
  onStar,
}: {
  heading: string | null;
  boards: Board[];
  view: BoardsView;
  selecting: boolean;
  selected: ReadonlySet<string>;
  onSelect: (uid: string) => void;
  onStar: (board: Board) => void;
}) {
  if (boards.length === 0) return null;
  return (
    <section className="boards__group" aria-label={heading ?? strings.boards.title}>
      {heading !== null && <h2 className="boards__heading">{heading}</h2>}
      <ul className={view === "grid" ? "boards__grid" : "boards__list"}>
        {boards.map((board) =>
          view === "grid" ? (
            <BoardTile
              key={board.uid}
              board={board}
              selecting={selecting}
              selected={selected.has(board.uid)}
              onSelect={onSelect}
              onStar={onStar}
            />
          ) : (
            <BoardRow
              key={board.uid}
              board={board}
              selecting={selecting}
              selected={selected.has(board.uid)}
              onSelect={onSelect}
              onStar={onStar}
            />
          ),
        )}
      </ul>
    </section>
  );
}

/** No lists yet: the phone's suggestions to start from, and New list for anything else. */
function Empty() {
  return (
    <div className="boards__empty">
      <Icon name="view_list" className="boards__empty-icon" />
      <p className="boards__empty-title">{strings.boards.emptyTitle}</p>
      <p className="boards__start-with">{strings.boards.startWith}</p>
      <ul className="boards__starts">
        {STARTS.map(({ text, category }) => (
          <li key={category}>
            <Link
              className="boards__start"
              to={`/b/new?${new URLSearchParams({ title: text, category }).toString()}`}
            >
              <Icon name="add" />
              {text}
            </Link>
          </li>
        ))}
      </ul>
      <Link className="btn btn--text" to="/b/new">
        <span>{strings.boards.newBoard}</span>
      </Link>
    </div>
  );
}

/**
 * The boards this device keeps, the way the phone's home shows them: starred
 * ones first, the rest in the order chosen, narrowed by a word or by which
 * of them to show. Nothing here needs an account.
 */
export function BoardsPage({
  repository = site,
  now = Date.now,
  store = localStorageStore,
  shelfStore = sessionStorageStore,
  unpublish = unpublishList,
}: BoardsPageProps) {
  usePageTitle(strings.boards.title);
  const all = useBoards(repository);
  const { signedIn } = useBoardSync();
  const { account } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Read once, before the first paint, so the scroll put back on the way back lands on the same lists.
  const [shelf] = useState(() => shelfIn(shelfStore));
  const [sort, setSort] = useState<BoardSort>(shelf.sort);
  const [view, setView] = useState<BoardsView>(() => viewIn(store));
  const showAs = (next: BoardsView) => {
    setView(next);
    store.write(VIEW_KEY, next);
  };
  // A link may ask for some of them: /b?show=public is where "Your public lists" went.
  const [show, setShow] = useState<BoardShow>(
    () => BOARD_SHOWS.find((asked) => asked === shownIn(location.search)) ?? shelf.show,
  );
  const [query, setQuery] = useState(shelf.query);
  useEffect(() => {
    shelfStore.write(SHELF_KEY, JSON.stringify({ sort, show, query } satisfies Shelf));
  }, [shelfStore, sort, show, query]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Boards on their way to the trash while their public copies come down: off
  // the shelf at once, so nothing looks undone and none is deleted twice.
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  // A list begun in the old editor is found here, with the others.
  useEffect(() => {
    keepOldDraft(store, repository, now(), nextUid);
  }, [store, repository, now]);
  const undoTrash = (uids: readonly string[]) => {
    repository.saveAll(
      uids.flatMap((uid) => {
        const board = repository.get(uid);
        return board === null ? [] : [restoreBoard(board)];
      }),
    );
  };
  // A public copy taken down is said, as on the phone: Undo brings the list back, not its copy.
  const trashedNotice = (uids: readonly string[], tookDown = false): SnackbarNotice => ({
    text: plural(tookDown ? strings.boards.deletedTakenDown : strings.boards.deleted, uids.length),
    action: { text: strings.boards.undo, onClick: () => undoTrash(uids) },
  });

  // A board page that sent its board to the trash lands here and says so.
  const arrivedWith = (location.state as BoardsPageState | null)?.trashed ?? [];
  // Notices wait their turn, as on the phone: a deletion's Undo first, then
  // why some of the lists stayed.
  const [notices, setNotices] = useState<readonly SnackbarNotice[]>(() =>
    arrivedWith.length > 0 ? [trashedNotice(arrivedWith)] : [],
  );
  const notice = notices[0] ?? null;
  const forget = useCallback(() => setNotices((queued) => queued.slice(1)), []);
  useEffect(() => {
    // Said once: a reload must not say it again.
    if (arrivedWith.length > 0) void navigate(location.pathname, { replace: true, state: null });
  }, [arrivedWith.length, location.pathname, navigate]);

  const kept = deleting.size === 0 ? all : all.filter((board) => !deleting.has(board.uid));
  const live = kept.filter((board) => board.deletedAt === null);
  const filters = { show, query };
  const arranged = arrangeBoards(kept, sort, filters);
  const narrowed = isNarrowed(filters);
  const grouped = shouldGroup(arranged, narrowed);
  const shown = [...arranged.favourites, ...arranged.rest];
  const publicCount = live.filter(isOut).length;
  const rankings = live.reduce((sum, board) => sum + rankedCount(board), 0);

  // Only the lists on screen are deleted: one chosen and then hidden by a
  // filter or a search stays out of it until it is shown again.
  const chosen = shown.filter((board) => selected.has(board.uid));

  // The same two functions on every render, so a tile is drawn again only when its own board changes.
  const star = useCallback(
    (board: Board) => {
      repository.save(setFavourite(board, board.favouritedAt === null ? now() : null));
    },
    [repository, now],
  );

  const toggle = useCallback((uid: string) => {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      // Deselecting the last one leaves the mode: an empty bar is a dead end.
      if (next.size === 0) setSelecting(false);
      return next;
    });
  }, []);
  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  // The control pressed to start or end choosing goes as it is pressed: the
  // focus moves to the first list to choose, or back to the chip that starts
  // it, rather than falling to the page.
  const page = useRef<HTMLElement>(null);
  const focusNext = useRef<"firstList" | "chip" | null>(null);
  useEffect(() => {
    const where = focusNext.current;
    if (where === null) return;
    focusNext.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    page.current
      ?.querySelector<HTMLElement>(
        where === "chip"
          ? ".boards__choose"
          : ".boards__group [aria-pressed], .boards__group input[type='checkbox']",
      )
      ?.focus();
  });
  const startSelection = () => {
    focusNext.current = "firstList";
    setSelecting(true);
  };
  const exitSelection = () => {
    focusNext.current = "chip";
    leaveSelection();
  };
  // Escape leaves choosing, as the phone's back does. Heard before the menus
  // hear it, so a menu or a dialog open over the page closes alone.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role='dialog'], details.menu[open]") !== null) return;
      focusNext.current = "chip";
      setSelecting(false);
      setSelected(new Set());
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [selecting]);

  // Public copies come down first, as on the phone: a board whose copy could
  // not be taken down stays, and a notice after the others' Undo says so.
  const deleteSelected = async () => {
    const going = chosen;
    const uids = going.map((board) => board.uid);
    leaveSelection();
    setDeleting((was) => new Set([...was, ...uids]));
    // Which copies this account really took down: one already gone, or another
    // account's, is let go without a word about it.
    const tookDown = new Set<string>();
    const down = await Promise.all(
      going.map((board) =>
        takenDown(board, async (id) => {
          await unpublish(id);
          tookDown.add(id);
        }),
      ),
    );
    const at = now();
    const trashed = going.filter((_, index) => down[index]);
    repository.saveAll(
      trashed.flatMap(({ uid }) => {
        const board = repository.get(uid);
        return board === null ? [] : [trashBoard(unpublished(board, at), at)];
      }),
    );
    setDeleting((was) => new Set([...was].filter((uid) => !uids.includes(uid))));
    // Undo takes the focus when there is one; without it, the chip does.
    if (trashed.length === 0) focusNext.current = "chip";
    setNotices([
      ...(trashed.length > 0
        ? [
            trashedNotice(
              trashed.map((board) => board.uid),
              trashed.some(
                (board) => board.publishedId !== null && tookDown.has(board.publishedId),
              ),
            ),
          ]
        : []),
      ...(trashed.length < going.length ? [{ text: strings.trash.stillPublic }] : []),
    ]);
  };
  const countId = useId();

  return (
    <section className="boards" ref={page}>
      <header className="boards__head">
        <div className="boards__text">
          <h1 className="boards__title">{strings.boards.title}</h1>
          {live.length > 0 && (
            <p className="boards__count">
              {[
                plural(strings.boards.count, live.length),
                plural(strings.boards.rankings, rankings),
                ...(publicCount > 0 ? [plural(strings.boards.published, publicCount)] : []),
              ].join(" · ")}
            </p>
          )}
        </div>
        <div className="boards__actions">
          <Link className="btn btn--text" to="/trash">
            <Icon name="delete" className="btn__icon" />
            <span>{strings.boards.trash}</span>
          </Link>
          {live.length > 0 && (
            <Link className="btn btn--filled" to="/b/new">
              <Icon name="add" className="btn__icon" />
              <span>{strings.boards.newBoard}</span>
            </Link>
          )}
        </div>
      </header>

      {live.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="boards__tools">
            <label className="boards__search">
              <Icon name="search" />
              <input
                type="search"
                value={query}
                placeholder={strings.boards.search}
                aria-label={strings.boards.search}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="boards__filters">
              <div className="boards__chips" role="group" aria-label={strings.boards.show}>
                {BOARD_SHOWS.map((option) => (
                  <Chip key={option} selected={show === option} onClick={() => setShow(option)}>
                    {SHOW_TEXT[option]}
                  </Chip>
                ))}
              </div>
              <div className="boards__end">
                <Menu
                  label={fill(strings.boards.sortLabel, { sort: SORT_TEXT[sort] })}
                  buttonClassName="chip boards__sort"
                  button={
                    <>
                      <span>{SORT_TEXT[sort]}</span>
                      <Icon name="expand_more" className="chip__icon" />
                    </>
                  }
                >
                  {BOARD_SORTS.map((option) => (
                    <li key={option}>
                      <button
                        type="button"
                        className="menu__action boards__sort-option"
                        aria-current={sort === option}
                        onClick={() => setSort(option)}
                      >
                        {SORT_TEXT[option]}
                        {sort === option && <Icon name="check" />}
                      </button>
                    </li>
                  ))}
                </Menu>
                <div className="boards__view" role="group" aria-label={strings.boards.view}>
                  <button
                    type="button"
                    className="boards__view-option"
                    aria-pressed={view === "grid"}
                    aria-label={strings.boards.viewGrid}
                    title={strings.boards.viewGrid}
                    onClick={() => showAs("grid")}
                  >
                    <Icon name="grid_view" />
                  </button>
                  <button
                    type="button"
                    className="boards__view-option"
                    aria-pressed={view === "rows"}
                    aria-label={strings.boards.viewRows}
                    title={strings.boards.viewRows}
                    onClick={() => showAs("rows")}
                  >
                    <Icon name="view_agenda" />
                  </button>
                </div>
                {/* An action, not a filter: a plain button in the chips' dress. */}
                {!selecting && (
                  <button type="button" className="chip boards__choose" onClick={startSelection}>
                    <Icon name="check" className="chip__icon" />
                    <span>{strings.boards.choose}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {selecting && (
            <div
              className="boards__selection"
              // A group, not a toolbar: a toolbar promises the arrow keys between its two buttons.
              role="group"
              aria-labelledby={countId}
            >
              <span className="boards__selected" id={countId}>
                {chosen.length === 0
                  ? strings.boards.pickToDelete
                  : plural(strings.boards.selected, chosen.length)}
              </span>
              <Button
                variant="tonal"
                icon="delete"
                onClick={() => void deleteSelected()}
                disabled={chosen.length === 0}
              >
                {strings.boards.deleteSelected}
              </Button>
              <button
                type="button"
                className="boards__exit"
                aria-label={strings.boards.exitSelection}
                onClick={exitSelection}
              >
                <Icon name="close" />
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="boards__empty boards__empty--search" role="status">
              <p className="boards__empty-title">
                {query.trim() !== ""
                  ? fill(strings.boards.noMatch, { q: query.trim() })
                  : fill(strings.boards.noneShown, { filter: SHOW_TEXT[show] })}
              </p>
              {query.trim() !== "" && (
                <p className="boards__empty-body">{strings.boards.noMatchBody}</p>
              )}
            </div>
          ) : grouped ? (
            <>
              <Group
                heading={strings.boards.favourites}
                boards={arranged.favourites}
                view={view}
                selecting={selecting}
                selected={selected}
                onSelect={toggle}
                onStar={star}
              />
              <Group
                heading={strings.boards.allBoards}
                boards={arranged.rest}
                view={view}
                selecting={selecting}
                selected={selected}
                onSelect={toggle}
                onStar={star}
              />
            </>
          ) : (
            <Group
              heading={null}
              boards={shown}
              view={view}
              selecting={selecting}
              selected={selected}
              onSelect={toggle}
              onStar={star}
            />
          )}
        </>
      )}
      {/* Lists kept only in this browser, and the way to keep them for good, as the phone offers. */}
      {account?.kind === "guest" && !signedIn && live.length > 0 && (
        <div className="boards__local-only">
          <p>
            {fill(strings.sync.localOnly, { count: plural(strings.boards.count, live.length) })}
          </p>
          <p>{strings.sync.guestNote}</p>
          <SignInButton label={strings.nav.signIn} />
        </div>
      )}
      <Snackbar notice={notice} onDone={forget} />
    </section>
  );
}
