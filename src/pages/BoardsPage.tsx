import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Category } from "../api/types";
import { usePageTitle } from "../app/pageTitle";
import {
  arrangeBoards,
  BOARD_SHOWS,
  BOARD_SORTS,
  isNarrowed,
  rankedCount,
  restoreBoard,
  setFavourite,
  shouldGroup,
  trashBoard,
  type Board,
  type BoardShow,
  type BoardSort,
} from "../features/boards/model";
import { boards as site, type BoardsRepository } from "../features/boards/repository";
import { useBoardSync } from "../features/boards/boardSync";
import { BoardRow } from "../features/boards/BoardRow";
import { BoardTile } from "../features/boards/BoardTile";
import { titleOf } from "../features/boards/boardText";
import { useBoards } from "../features/boards/useBoards";
import "../features/boards/boards.css";
import { localStorageStore, type KeyValueStore } from "../lib/storage";
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
}

/** Pictures in a grid, as the phone shows them first, or one board to a row with its tier ribbon. */
type BoardsView = "grid" | "rows";
export const VIEW_KEY = "boards.view";
const viewIn = (store: KeyValueStore): BoardsView =>
  store.read(VIEW_KEY) === "rows" ? "rows" : "grid";

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

/** Where an empty page starts: the phone's five suggestions, each a new list in its section. */
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
              title={titleOf(board)}
              selecting={selecting}
              selected={selected.has(board.uid)}
              onSelect={() => onSelect(board.uid)}
              onStar={() => onStar(board)}
            />
          ) : (
            <BoardRow
              key={board.uid}
              board={board}
              selecting={selecting}
              selected={selected.has(board.uid)}
              onSelect={() => onSelect(board.uid)}
              onStar={() => onStar(board)}
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
            <Link className="boards__start" to={`/b/new?category=${category}`}>
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
}: BoardsPageProps) {
  usePageTitle(strings.boards.title);
  const all = useBoards(repository);
  const { signedIn } = useBoardSync();
  const navigate = useNavigate();
  const location = useLocation();
  const [sort, setSort] = useState<BoardSort>("recent");
  const [view, setView] = useState<BoardsView>(() => viewIn(store));
  const showAs = (next: BoardsView) => {
    setView(next);
    store.write(VIEW_KEY, next);
  };
  const [show, setShow] = useState<BoardShow>("all");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const undoTrash = (uids: readonly string[]) => {
    const at = now();
    repository.saveAll(
      uids.flatMap((uid) => {
        const board = repository.get(uid);
        return board === null ? [] : [restoreBoard(board, at)];
      }),
    );
  };
  const trashedNotice = (uids: readonly string[]): SnackbarNotice => ({
    text: plural(strings.boards.deleted, uids.length),
    action: { text: strings.boards.undo, onClick: () => undoTrash(uids) },
  });

  // A board page that sent its board to the trash lands here and says so.
  const arrivedWith = (location.state as BoardsPageState | null)?.trashed ?? [];
  const [notice, setNotice] = useState<SnackbarNotice | null>(() =>
    arrivedWith.length > 0 ? trashedNotice(arrivedWith) : null,
  );
  const forget = useCallback(() => setNotice(null), []);
  useEffect(() => {
    // Said once: a reload must not say it again.
    if (arrivedWith.length > 0) void navigate(location.pathname, { replace: true, state: null });
  }, [arrivedWith.length, location.pathname, navigate]);

  const live = all.filter((board) => board.deletedAt === null);
  const filters = { show, query };
  const arranged = arrangeBoards(all, sort, filters);
  const narrowed = isNarrowed(filters);
  const grouped = shouldGroup(arranged, narrowed);
  const shown = [...arranged.favourites, ...arranged.rest];
  const publicCount = live.filter((board) => board.publishedId !== null).length;
  const rankings = live.reduce((sum, board) => sum + rankedCount(board), 0);

  const star = (board: Board) => {
    repository.save(setFavourite(board, board.favouritedAt === null ? now() : null));
  };

  const toggle = (uid: string) => {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      // Deselecting the last one leaves the mode: an empty bar is a dead end.
      if (next.size === 0) setSelecting(false);
      return next;
    });
  };
  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const deleteSelected = () => {
    const uids = [...selected];
    const at = now();
    repository.saveAll(
      uids.flatMap((uid) => {
        const board = repository.get(uid);
        return board === null ? [] : [trashBoard(board, at)];
      }),
    );
    leaveSelection();
    setNotice(trashedNotice(uids));
  };

  return (
    <section className="boards">
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
                {!selecting && (
                  <Chip icon="check" onClick={() => setSelecting(true)}>
                    {strings.boards.deleteSelected}
                  </Chip>
                )}
              </div>
            </div>
          </div>

          {selecting && (
            <div
              className="boards__selection"
              role="toolbar"
              aria-label={strings.boards.exitSelection}
            >
              <span className="boards__selected">
                {plural(strings.boards.selected, selected.size)}
              </span>
              <Button
                variant="tonal"
                icon="delete"
                onClick={deleteSelected}
                disabled={selected.size === 0}
              >
                {strings.boards.deleteSelected}
              </Button>
              <button
                type="button"
                className="boards__exit"
                aria-label={strings.boards.exitSelection}
                onClick={leaveSelection}
              >
                <Icon name="close" />
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="boards__empty boards__empty--search" role="status">
              <p className="boards__empty-title">
                {query.trim() === ""
                  ? strings.boards.emptyTitle
                  : fill(strings.boards.noMatch, { q: query.trim() })}
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
      {!signedIn && live.length > 0 && (
        <p className="boards__local-only">
          {fill(strings.sync.localOnly, { count: plural(strings.boards.count, live.length) })}
        </p>
      )}
      <Snackbar notice={notice} onDone={forget} />
    </section>
  );
}
