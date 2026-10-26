import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { usePageTitle } from "../app/pageTitle";
import { RankingBoard } from "../features/board/RankingBoard";
import { BoardFrameContext } from "../features/board/boardFrame";
import type { Dock } from "../features/board/dock";
import {
  addToPool,
  arrangeItems,
  newBoard,
  poolCount,
  rankedCount,
  rename,
  restoreItem,
  trashBoard,
  trashItem,
  type Board,
} from "../features/boards/model";
import { boards as site, type BoardsRepository } from "../features/boards/repository";
import { nextUid, useBoard } from "../features/boards/useBoards";
import { boardView, uidRows } from "../features/boards/view";
import { AddCardBox, type Upload } from "../features/editor/AddCardBox";
import type { EditorAction, EditorItem } from "../features/editor/model";
import type { Lookup } from "../features/editor/useCatalogue";
import { uploadPicture } from "../lib/pictures";
import { memoryStore } from "../lib/storage";
import { fill, plural, strings } from "../strings";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import type { BoardsPageState } from "./BoardsPage";
import "./ListPage.css";
import "../features/editor/owner.css";
import "./BoardPage.css";

interface BoardPageProps {
  repository?: BoardsRepository;
  now?: () => number;
  lookup?: Lookup;
  upload?: Upload;
}

/** The board's name, edited where it stands: a press on the pencil, Enter or leaving the field keeps it. */
function TitleEditor({
  board,
  editing,
  onEdit,
  onKeep,
}: {
  board: Board;
  editing: boolean;
  onEdit: () => void;
  onKeep: (title: string) => void;
}) {
  const [draft, setDraft] = useState(board.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    setDraft(board.title);
    input.current?.focus();
    input.current?.select();
    // The name on screen is what is edited; what the board holds at that moment is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const keep = () => onKeep(draft);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      keep();
    } else if (event.key === "Escape") {
      onKeep(board.title);
    }
  };

  if (editing) {
    return (
      <input
        ref={input}
        className="board-page__title-field"
        aria-label={strings.boards.titleField}
        value={draft}
        maxLength={80}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={keep}
        onKeyDown={onKey}
      />
    );
  }
  const shown = board.title.trim().length > 0 ? board.title : strings.boards.untitled;
  return (
    <span className="board-page__title-row">
      <h1 className="list-head__title">{shown}</h1>
      <button
        type="button"
        className="board-page__edit"
        aria-label={strings.boards.editTitle}
        onClick={onEdit}
      >
        <Icon name="edit" />
      </button>
    </span>
  );
}

function NotFound() {
  return (
    <section className="list-page list-page--trouble">
      <h1>{strings.boards.notFound}</h1>
      <p>{strings.boards.notFoundBody}</p>
      <Link className="btn btn--filled" to="/boards">
        <span>{strings.boards.back}</span>
      </Link>
    </section>
  );
}

/**
 * One of the person's own boards, the way the phone shows it: the rows, the
 * pool, and every move kept the moment it is made. Nothing here is sent
 * anywhere until the board is kept in an account or published.
 */
export function BoardPage({
  repository = site,
  now = Date.now,
  lookup,
  upload = (file) => uploadPicture(file),
}: BoardPageProps) {
  const { uid = "" } = useParams();
  const [params] = useSearchParams();
  const stored = useBoard(uid, repository);
  const navigate = useNavigate();
  // A new board is made here and kept only once it is touched: a name, a
  // card, a star. Left as it came, it was never kept, which is what the
  // phone's cross does with an untouched board.
  const madeAt = Number(params.get("new"));
  const fresh = useMemo(
    () => (madeAt > 0 ? newBoard(uid, strings.boards.untitled, madeAt, nextUid) : null),
    [uid, madeAt],
  );
  const board = stored ?? fresh;
  const [editingTitle, setEditingTitle] = useState(madeAt > 0);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const forget = useCallback(() => setNotice(null), []);
  const [boardDock, setBoardDock] = useState<Dock | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const frame = useMemo(() => ({ headSlot, report: setBoardDock }), [headSlot]);
  // The board's own scratch for the ranking board: nothing of it outlives the page.
  const [scratch] = useState(() => memoryStore());

  usePageTitle(board === null ? null : board.title || strings.boards.untitled);

  const view = useMemo(
    () => (board === null ? null : boardView(board, strings.boards.untitled)),
    [board],
  );

  if (board === null || view === null) return <NotFound />;

  // What the board is right now: what is kept, or the fresh one until it is.
  const latest = (): Board => repository.get(uid) ?? board;
  const keep = (next: Board) => {
    if (next !== board) repository.save(next);
  };

  const onRows = (rows: readonly (readonly number[])[]) => {
    const current = latest();
    keep(arrangeItems(current, uidRows(view, rows), now()));
  };

  const remove = (item: number) => {
    const itemUid = view.uids[item];
    const current = latest();
    if (itemUid === undefined) return;
    const card = current.items.find((it) => it.uid === itemUid);
    keep(trashItem(current, itemUid, now()));
    setNotice({
      text: fill(strings.boards.cardTrashed, { name: card?.title ?? "" }),
      action: {
        text: strings.boards.undo,
        onClick: () => {
          const again = repository.get(uid);
          if (again !== null) repository.save(restoreItem(again, itemUid, now()));
        },
      },
    });
  };

  // The add-card box speaks the editor's language; here its cards go to the pool.
  const dispatch = (action: EditorAction) => {
    if (action.type !== "addItem") return;
    const current = latest();
    const key = action.key;
    const taken = key !== undefined && current.items.some((it) => it.uid === key);
    const uidFor = key !== undefined && !taken ? () => key : nextUid;
    keep(
      addToPool(
        current,
        [
          {
            title: action.title.length > 0 ? action.title : strings.new.unnamed,
            imageUrl: action.imageUrl,
            pictureId: action.pictureId ?? null,
            source: action.key?.startsWith("tmdb:") ? "TMDB" : "MANUAL",
          },
        ],
        now(),
        uidFor,
      ),
    );
  };
  const editorItems: EditorItem[] = view.uids.map((itemUid, index) => ({
    key: itemUid,
    title: view.list.items[index]?.title ?? "",
    imageUrl: view.list.items[index]?.imageUrl ?? null,
    pictureId: null,
  }));

  const toTrash = () => {
    keep(trashBoard(board, now()));
    void navigate("/boards", { state: { trashed: [uid] } satisfies BoardsPageState });
  };

  const ranked = rankedCount(board);
  const inPool = poolCount(board);

  return (
    <article
      className={
        boardDock === null ? "list-page board-page" : `list-page board-page list-page--${boardDock}`
      }
    >
      <Link className="board-page__back" to="/boards">
        <Icon name="arrow_back" />
        <span>{strings.boards.back}</span>
      </Link>
      <header className="list-head">
        <div className="list-head__text">
          <TitleEditor
            board={board}
            editing={editingTitle}
            onEdit={() => setEditingTitle(true)}
            onKeep={(title) => {
              setEditingTitle(false);
              keep(rename(board, title.trim().length > 0 ? title : strings.boards.untitled, now()));
            }}
          />
          <p className="list-head__meta">
            {[
              ranked === 0 ? strings.boards.nothingRanked : plural(strings.boards.ranked, ranked),
              plural(strings.boards.inPool, inPool),
              ...(board.category === null ? [] : [strings.category[board.category]]),
            ].join(" · ")}
          </p>
        </div>
        <span className="list-head__tools">
          <Menu label={strings.boards.more} button={<Icon name="more_vert" />}>
            <>
              <li>
                <Link to="/trash">{strings.boards.trash}</Link>
              </li>
              <li className="menu__divider" role="separator" />
              <li>
                <button
                  type="button"
                  className="menu__action menu__action--danger"
                  onClick={toTrash}
                >
                  {strings.boards.delete}
                </button>
              </li>
            </>
          </Menu>
        </span>
        <span className="list-head__bar" ref={setHeadSlot} />
      </header>
      <BoardFrameContext.Provider value={frame}>
        <section className="owner" aria-label={strings.owner.title}>
          <RankingBoard
            key={board.uid}
            list={view.list}
            store={scratch}
            edit={{
              rows: view.rows,
              save: () => Promise.resolve(),
              cancel: () => undefined,
              owner: {
                live: true,
                canSave: false,
                onChange: onRows,
                remove,
                tools: (
                  <AddCardBox
                    items={editorItems}
                    category={board.category}
                    dispatch={dispatch}
                    lookup={lookup}
                    upload={upload}
                  />
                ),
              },
            }}
          />
        </section>
      </BoardFrameContext.Provider>
      <Snackbar notice={notice} onDone={forget} />
    </article>
  );
}
