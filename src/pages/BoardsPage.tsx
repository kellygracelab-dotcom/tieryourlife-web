import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { CATEGORIES, isCategory, type Category } from "../api/types";
import { usePageTitle } from "../app/pageTitle";
import {
  arrangeBoards,
  isNarrowed,
  newBoard,
  poolCount,
  rankedCount,
  restoreBoard,
  setFavourite,
  shouldGroup,
  tierShares,
  trashBoard,
  type Board,
  type BoardSort,
  type PublishedFilter,
} from "../features/boards/model";
import { boards as site, type BoardsRepository } from "../features/boards/repository";
import { nextUid, useBoards } from "../features/boards/useBoards";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./BoardsPage.css";

interface BoardsPageProps {
  repository?: BoardsRepository;
  now?: () => number;
}

/** What a board page leaves in the history when it sends a board to the trash. */
export interface BoardsPageState {
  trashed?: string[];
}

const titleOf = (board: Board): string =>
  board.title.trim().length > 0 ? board.title : strings.boards.untitled;

/** The coloured bar under a board's name: each tier's share of the ranked cards. */
function SharesBar({ board }: { board: Board }) {
  const shares = tierShares(board);
  const ranked = shares.reduce((sum, share) => sum + share.count, 0);
  return (
    <span className="board-card__bar" aria-hidden="true">
      {ranked > 0 &&
        shares
          .filter((share) => share.count > 0)
          .map((share, index) => (
            <span
              key={index}
              className="band"
              style={
                {
                  flex: share.count,
                  "--band-light": share.color,
                  "--band-dark": share.colorDark,
                } as CSSProperties
              }
            />
          ))}
    </span>
  );
}

function BoardCard({
  board,
  selecting,
  selected,
  onSelect,
  onStar,
}: {
  board: Board;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onStar: () => void;
}) {
  const title = titleOf(board);
  const ranked = rankedCount(board);
  const inPool = poolCount(board);
  const meta =
    ranked === 0
      ? `${plural(strings.boards.inPool, inPool)} · ${strings.boards.nothingRanked}`
      : `${plural(strings.boards.ranked, ranked)} · ${plural(strings.boards.inPool, inPool)}`;
  const starred = board.favouritedAt !== null;
  return (
    <li className={selected ? "board-card board-card--selected" : "board-card"}>
      {selecting ? (
        <label className="board-card__pick">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={fill(strings.boards.select, { name: title })}
          />
        </label>
      ) : (
        <button
          type="button"
          className={starred ? "board-card__star board-card__star--on" : "board-card__star"}
          aria-label={fill(starred ? strings.boards.unstar : strings.boards.star, { name: title })}
          aria-pressed={starred}
          onClick={onStar}
        >
          <Icon name="star" />
        </button>
      )}
      {selecting ? (
        <button type="button" className="board-card__main" onClick={onSelect}>
          <span className="board-card__title">{title}</span>
          <span className="board-card__meta">{meta}</span>
          <SharesBar board={board} />
        </button>
      ) : (
        <Link
          className="board-card__main"
          to={`/b/${encodeURIComponent(board.uid)}`}
          aria-label={fill(strings.boards.open, { name: title })}
        >
          <span className="board-card__title">{title}</span>
          <span className="board-card__meta">{meta}</span>
          <SharesBar board={board} />
          {ranked === 0 && inPool > 0 && (
            <span className="board-card__hint">
              <Icon name="drag_indicator" />
              {strings.boards.startDragging}
            </span>
          )}
        </Link>
      )}
      {!selecting && <Icon name="expand_more" className="board-card__chevron" />}
    </li>
  );
}

function Group({
  heading,
  boards,
  selecting,
  selected,
  onSelect,
  onStar,
}: {
  heading: string | null;
  boards: Board[];
  selecting: boolean;
  selected: ReadonlySet<string>;
  onSelect: (uid: string) => void;
  onStar: (board: Board) => void;
}) {
  if (boards.length === 0) return null;
  return (
    <section className="boards__group" aria-label={heading ?? strings.boards.title}>
      {heading !== null && <h2 className="boards__heading">{heading}</h2>}
      <ul className="boards__list">
        {boards.map((board) => (
          <BoardCard
            key={board.uid}
            board={board}
            selecting={selecting}
            selected={selected.has(board.uid)}
            onSelect={() => onSelect(board.uid)}
            onStar={() => onStar(board)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The boards this device keeps, the way the phone's home shows them: starred
 * ones first, the rest newest first, narrowed by a word, a category or
 * whether they are public. Nothing here needs an account.
 */
export function BoardsPage({ repository = site, now = Date.now }: BoardsPageProps) {
  usePageTitle(strings.boards.title);
  const all = useBoards(repository);
  const navigate = useNavigate();
  const location = useLocation();
  const [sort, setSort] = useState<BoardSort>("newest");
  const [category, setCategory] = useState<Category | null>(null);
  const [published, setPublished] = useState<PublishedFilter | null>(null);
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
  const filters = { category, published, query };
  const arranged = arrangeBoards(all, sort, filters);
  const narrowed = isNarrowed(filters);
  const grouped = shouldGroup(arranged, narrowed);
  const shown = [...arranged.favourites, ...arranged.rest];
  const publicCount = live.filter((board) => board.publishedId !== null).length;

  const create = () => {
    const at = now();
    const board = newBoard(nextUid(), strings.boards.untitled, at, nextUid);
    repository.save(board);
    void navigate(`/b/${encodeURIComponent(board.uid)}?new=${at}`);
  };

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

  const clearFilters = () => {
    setCategory(null);
    setPublished(null);
    setQuery("");
  };

  return (
    <section className="boards">
      <header className="boards__head">
        <div className="boards__text">
          <h1 className="boards__title">{strings.boards.title}</h1>
          {live.length > 0 ? (
            <p className="boards__count">
              {[
                plural(strings.boards.count, live.length),
                publicCount > 0
                  ? plural(strings.boards.published, publicCount)
                  : strings.boards.private,
              ].join(" · ")}
            </p>
          ) : (
            <p className="boards__count">{strings.boards.intro}</p>
          )}
        </div>
        <div className="boards__actions">
          <Link className="btn btn--text" to="/trash">
            <Icon name="delete" className="btn__icon" />
            <span>{strings.boards.trash}</span>
          </Link>
          <Button variant="filled" icon="add" onClick={create}>
            {strings.boards.newBoard}
          </Button>
        </div>
      </header>

      {live.length === 0 ? (
        <div className="boards__empty">
          <Icon name="dashboard" className="boards__empty-icon" />
          <p className="boards__empty-title">{strings.boards.emptyTitle}</p>
          <p className="boards__empty-body">{strings.boards.emptyBody}</p>
          <Button variant="filled" icon="add" onClick={create}>
            {strings.boards.newBoard}
          </Button>
        </div>
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
              <div className="boards__chips" role="group" aria-label={strings.boards.sort}>
                <Chip selected={sort === "newest"} onClick={() => setSort("newest")}>
                  {strings.boards.sortNewest}
                </Chip>
                <Chip selected={sort === "oldest"} onClick={() => setSort("oldest")}>
                  {strings.boards.sortOldest}
                </Chip>
              </div>
              <div
                className="boards__chips"
                role="group"
                aria-label={strings.boards.filterVisibility}
              >
                <Chip
                  selected={published === "public"}
                  onClick={() => setPublished(published === "public" ? null : "public")}
                >
                  {strings.boards.filterPublic}
                </Chip>
                <Chip
                  selected={published === "private"}
                  onClick={() => setPublished(published === "private" ? null : "private")}
                >
                  {strings.boards.filterPrivate}
                </Chip>
              </div>
              <label className="boards__category">
                <span className="boards__category-label">{strings.boards.filterCategory}</span>
                <select
                  value={category ?? ""}
                  aria-label={strings.boards.filterCategory}
                  onChange={(event) =>
                    setCategory(isCategory(event.target.value) ? event.target.value : null)
                  }
                >
                  <option value="">{strings.boards.filterAny}</option>
                  {CATEGORIES.map((id) => (
                    <option key={id} value={id}>
                      {strings.category[id]}
                    </option>
                  ))}
                </select>
              </label>
              {narrowed && (
                <Button icon="close" onClick={clearFilters}>
                  {strings.boards.filterClear}
                </Button>
              )}
              {!selecting && (
                <Chip icon="check" onClick={() => setSelecting(true)}>
                  {strings.boards.deleteSelected}
                </Chip>
              )}
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
                {fill(strings.boards.noMatch, { q: query.trim() })}
              </p>
              <p className="boards__empty-body">{strings.boards.noMatchBody}</p>
            </div>
          ) : grouped ? (
            <>
              <Group
                heading={strings.boards.favourites}
                boards={arranged.favourites}
                selecting={selecting}
                selected={selected}
                onSelect={toggle}
                onStar={star}
              />
              <Group
                heading={strings.boards.allBoards}
                boards={arranged.rest}
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
              selecting={selecting}
              selected={selected}
              onSelect={toggle}
              onStar={star}
            />
          )}
        </>
      )}
      <Snackbar notice={notice} onDone={forget} />
    </section>
  );
}
