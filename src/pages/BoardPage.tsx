import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { usePageTitle } from "../app/pageTitle";
import { RankingBoard } from "../features/tierboard/RankingBoard";
import { BoardFrameContext } from "../features/tierboard/boardFrame";
import type { Dock } from "../features/tierboard/dock";
import {
  addToPool,
  arrangeItems,
  newBoard,
  poolCount,
  rankedCount,
  rankedTiers,
  rename,
  restoreItem,
  restoreTier,
  setCategory,
  setDisplayMode,
  trashBoard,
  trashItem,
  BOARD_LIMITS,
  type Board,
} from "../features/boards/model";
import { BoardSettings, type PublishingDeps } from "../features/boards/BoardSettings";
import { RankedList } from "../features/boards/RankedList";
import { downloadShare, type Share } from "../features/ranking/share";
import {
  publish as publishList,
  republish as republishList,
  unpublish as unpublishList,
} from "../lib/api";
import { boards as site, type BoardsRepository } from "../features/boards/repository";
import { applyTierAction, editorTiersOf } from "../features/boards/tierEditing";
import { nextUid, useBoard } from "../features/boards/useBoards";
import { boardView, uidRows } from "../features/boards/view";
import { AddCardBox, type Upload } from "../features/editor/AddCardBox";
import type { EditorAction, EditorItem, EditorTier } from "../features/editor/model";
import { TierDialog } from "../features/editor/TierDialog";
import { TiersEditor } from "../features/editor/TiersEditor";
import type { Lookup } from "../features/editor/useCatalogue";
import { uploadPicture } from "../lib/pictures";
import { memoryStore } from "../lib/storage";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import type { BoardsPageState } from "./BoardsPage";
import "./ListPage.css";
import "../features/editor/owner.css";
import "../features/editor/editor.css";
import "./BoardPage.css";

interface BoardPageProps {
  repository?: BoardsRepository;
  now?: () => number;
  lookup?: Lookup;
  upload?: Upload;
  publishing?: PublishingDeps;
  share?: Share;
}

type Panel = "none" | "tiers" | "settings";

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
const sitePublishing: PublishingDeps = {
  publish: publishList,
  republish: republishList,
  unpublish: unpublishList,
};

export function BoardPage({
  repository = site,
  now = Date.now,
  lookup,
  upload = (file) => uploadPicture(file),
  publishing = sitePublishing,
  share = downloadShare,
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
  // The name is asked for once, on arrival at a board not yet kept: a reload
  // keeps the query, not the question.
  const [editingTitle, setEditingTitle] = useState(madeAt > 0 && stored === null);
  const [panel, setPanel] = useState<Panel>("none");
  // What is being typed into a tier's fields, as typed: the board keeps the
  // trimmed words, and a label emptied for a moment is not kept at all.
  const [typing, setTyping] = useState<Record<string, { label: string; caption: string | null }>>(
    {},
  );
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const forget = useCallback(() => setNotice(null), []);
  // The tier opened from the board, by its uid.
  const [openTier, setOpenTier] = useState<string | null>(null);
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

  // The tier editor's actions, each a change to the board; a tier taken away
  // can come back with its cards from the snackbar.
  const onTier = (action: EditorAction) => {
    if (action.type === "renameTier") {
      setTyping((held) => ({
        ...held,
        [action.key]: { label: action.label, caption: action.caption },
      }));
    }
    const change = applyTierAction(latest(), action, now(), nextUid);
    keep(change.board);
    const removed = change.removed;
    if (removed !== undefined) {
      setNotice({
        text: fill(strings.boards.tierRemoved, { name: removed.tier.label }),
        action: {
          text: strings.boards.undo,
          onClick: () => {
            const again = repository.get(uid);
            if (again !== null) {
              repository.save(restoreTier(again, removed.tier, removed.itemUids, now()));
            }
          },
        },
      });
    }
  };
  const editorTiers: EditorTier[] = editorTiersOf(board).map((tier) => {
    const typed = typing[tier.key];
    return typed === undefined ? tier : { ...tier, ...typed };
  });
  const closePanel = () => {
    setPanel("none");
    setTyping({});
  };
  // The tiers changed on the board itself, as on the phone; the same actions as the panel's.
  const tierEditing = {
    move: (from: number, to: number) => {
      const key = editorTiers[from]?.key;
      if (key !== undefined) onTier({ type: "placeTier", key, index: to });
    },
    open: (index: number) => setOpenTier(editorTiers[index]?.key ?? null),
    add: editorTiers.length < BOARD_LIMITS.tiers ? () => onTier({ type: "addTier" }) : undefined,
  };
  const opened = editorTiers.find((tier) => tier.key === openTier);

  const toTrash = () => {
    keep(trashBoard(board, now()));
    void navigate("/boards", { state: { trashed: [uid] } satisfies BoardsPageState });
  };

  // The picture of the board, drawn the way a ranking's is; the address under
  // it is the published list's when there is one, the site's otherwise.
  const shareBoard = () =>
    share(
      view.list,
      view.rows,
      board.publishedId === null
        ? window.location.origin
        : `${window.location.origin}/l/${encodeURIComponent(board.publishedId)}`,
    ).catch(() => setNotice({ text: strings.rank.downloadFailed }));

  const ranked = rankedCount(board);
  const inPool = poolCount(board);
  const tools = (
    <AddCardBox
      items={editorItems}
      category={board.category}
      dispatch={dispatch}
      lookup={lookup}
      upload={upload}
    />
  );

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
          <Button
            variant="tonal"
            icon="swap_vert"
            onClick={() => (panel === "tiers" ? closePanel() : setPanel("tiers"))}
          >
            {strings.boards.tiers}
          </Button>
          <Menu label={strings.boards.more} button={<Icon name="more_vert" />}>
            <>
              <li>
                <button type="button" className="menu__action" onClick={() => setPanel("settings")}>
                  {strings.boards.settings}
                </button>
              </li>
              <li>
                <button type="button" className="menu__action" onClick={() => setPanel("tiers")}>
                  {strings.boards.tiers}
                </button>
              </li>
              <li>
                <button type="button" className="menu__action" onClick={() => void shareBoard()}>
                  {strings.boards.shareImage}
                </button>
              </li>
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

      {panel === "tiers" && (
        <section className="board-panel" aria-label={strings.boards.tiers}>
          <div className="board-panel__head">
            <h2>{strings.boards.tiers}</h2>
            <Button onClick={closePanel}>{strings.boards.done}</Button>
          </div>
          <TiersEditor tiers={editorTiers} dispatch={onTier} />
        </section>
      )}
      {panel === "settings" && (
        <BoardSettings
          board={board}
          latest={latest}
          keep={keep}
          onCategory={(category) => keep(setCategory(latest(), category, now()))}
          onMode={(mode) => keep(setDisplayMode(latest(), mode, now()))}
          onPublished={(what) =>
            setNotice({
              text:
                what === "unpublished"
                  ? strings.boards.unpublished
                  : what === "updated"
                    ? strings.owner.saved
                    : strings.boards.publishedNote,
            })
          }
          publishing={publishing}
          onDone={closePanel}
          now={now}
        />
      )}

      {board.displayMode === "RANKED" ? (
        <section className="owner" aria-label={strings.owner.title}>
          <div className="ranking__tools">{tools}</div>
          <RankedList board={board} />
          <p className="board-page__ranked-note">
            {plural(strings.boards.pool, inPool)} · {strings.boards.rankedNote}
          </p>
        </section>
      ) : (
        <BoardFrameContext.Provider value={frame}>
          <section className="owner" aria-label={strings.owner.title}>
            <RankingBoard
              // The rows are held by index: a tier added, taken away or moved
              // means a fresh board over the same cards.
              key={`${board.uid}:${rankedTiers(board)
                .map((tier) => tier.uid)
                .join(",")}`}
              list={view.list}
              store={scratch}
              edit={{
                rows: view.rows,
                save: () => Promise.resolve(),
                cancel: () => undefined,
                owner: {
                  live: true,
                  moveMenu: true,
                  canSave: false,
                  onChange: onRows,
                  remove,
                  tools,
                  tiers: tierEditing,
                },
              }}
            />
          </section>
        </BoardFrameContext.Provider>
      )}
      {opened !== undefined && (
        <TierDialog
          key={opened.key}
          tier={opened}
          canRemove={editorTiers.length > 1}
          dispatch={onTier}
          onClose={() => setOpenTier(null)}
        />
      )}
      <Snackbar notice={notice} onDone={forget} />
    </article>
  );
}
