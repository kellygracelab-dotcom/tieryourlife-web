import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { SectionProposal, SectionStats } from "../api/sections";
import { isSectionId } from "../api/types";
import { usePageTitle } from "../app/pageTitle";
import { RankingBoard } from "../features/tierboard/RankingBoard";
import { BoardFrameContext } from "../features/tierboard/boardFrame";
import type { Dock } from "../features/tierboard/dock";
import {
  addToPool,
  arrangeItems,
  itemsIn,
  liveItems,
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
import {
  BoardSettings,
  type LoadTopics,
  type PublishingDeps,
} from "../features/boards/BoardSettings";
import { RankedList } from "../features/boards/RankedList";
import { filedUnder } from "../features/boards/sectionChoices";
import { downloadShare, type Share } from "../features/ranking/share";
import type { EditorDeps } from "../features/sections/editorDeps";
import { myWaiting, PENDING_MAX } from "../features/sections/proposal";
import { SectionEditor } from "../features/sections/SectionEditor";
import { TooManyDialog } from "../features/sections/TooManyDialog";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import {
  proposeSection,
  publish as publishList,
  republish as republishList,
  unpublish as unpublishList,
} from "../lib/api";
import { boards as site, type BoardsRepository } from "../features/boards/repository";
import { applyTierAction, editorTiersOf } from "../features/boards/tierEditing";
import { nextUid, useBoard } from "../features/boards/useBoards";
import { boardView, sameOrder, uidRows } from "../features/boards/view";
import { AddCardBox, type Upload } from "../features/editor/AddCardBox";
import type { EditorAction, EditorItem, EditorTier } from "../features/editor/model";
import { TierDialog } from "../features/editor/TierDialog";
import type { Lookup } from "../features/editor/useCatalogue";
import { PictureRefused, uploadPicture } from "../lib/pictures";
import { useSession } from "../app/session";
import { memoryStore } from "../lib/storage";
import { fill, plural, strings } from "../strings";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { PlayButton } from "../features/play/PlayButton";
import { usePlay } from "../features/play/usePlay";
import type { PlayCard, PlayTier } from "../features/play/board";
import { localStorageStore } from "../lib/storage";
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
  topics?: LoadTopics;
  share?: Share;
  store?: SectionsStore;
  propose?: (proposal: SectionProposal) => Promise<SectionStats>;
  proposeDeps?: EditorDeps;
}

/** The settings sheet, or what its Propose a section opened in its place: the form, or the three already waiting. */
type Panel = "none" | "settings" | "propose" | "tooMany";

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
      <Link className="btn btn--filled" to="/b">
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
  topics,
  share = downloadShare,
  store = sectionsStore,
  propose = proposeSection,
  proposeDeps,
}: BoardPageProps) {
  const { uid = "" } = useParams();
  const [params] = useSearchParams();
  const stored = useBoard(uid, repository);
  const navigate = useNavigate();
  const { account, signIn } = useSession();
  const { sections } = useSections(store);
  const me = account?.kind === "signedIn" ? account.uid : null;
  // A new board is made here and kept only once it is touched: a name, a
  // card, a star. Left as it came, it was never kept, which is what the
  // phone's cross does with an untouched board.
  const madeAt = Number(params.get("new"));
  // A name or a section brought along, as from a search that found nothing:
  // the board starts with them.
  const named = params.get("title")?.trim() ?? "";
  const filed = params.get("category") ?? "";
  const fresh = useMemo(
    () =>
      madeAt > 0
        ? {
            ...newBoard(uid, named === "" ? strings.boards.untitled : named, madeAt, nextUid),
            category: isSectionId(filed) ? filed : null,
          }
        : null,
    [uid, madeAt, named, filed],
  );
  const board = stored ?? fresh;
  // The name is asked for once, on arrival at a board not yet kept: a reload
  // keeps the query, not the question.
  const [editingTitle, setEditingTitle] = useState(madeAt > 0 && stored === null);
  // ?settings=1 opens the sheet at once: the admin's anonymous publish leads here.
  const [panel, setPanel] = useState<Panel>(params.get("settings") === "1" ? "settings" : "none");
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

  // The cards keep their indexes while the page is open (see boardView): the
  // order drawn is kept, and taken afresh only when the cards change.
  const [drawn, setDrawn] = useState<readonly string[]>();
  const view = useMemo(
    () => (board === null ? null : boardView(board, strings.boards.untitled, drawn)),
    [board, drawn],
  );
  if (view !== null && !sameOrder(view.uids, drawn)) setDrawn(view.uids);

  // Play's cards and tiers: the board's own, by uid, best tier first.
  const playCards = useMemo<PlayCard[]>(
    () =>
      board === null
        ? []
        : liveItems(board).map((item) => ({
            id: item.uid,
            name: item.title,
            imageUrl: item.imageUrl,
          })),
    [board],
  );
  const playTiers = useMemo<PlayTier[]>(
    () =>
      board === null
        ? []
        : rankedTiers(board).map((tier) => ({
            id: tier.uid,
            label: tier.label,
            caption: tier.caption,
            colorLight: tier.colorLight,
            colorDark: tier.colorDark,
            cardIds: itemsIn(board, tier.uid).map((item) => item.uid),
          })),
    [board],
  );
  const play = usePlay(uid, playCards, playTiers, localStorageStore, {
    title: board?.title || strings.boards.untitled,
    notify: setNotice,
    // The result replaces the arrangement; Undo puts the one before it back.
    onApply: (rows) => {
      const before = repository.get(uid) ?? board;
      if (before === null) return;
      const was = rankedTiers(before).map((tier) =>
        itemsIn(before, tier.uid).map((item) => item.uid),
      );
      repository.save(arrangeItems(before, rows, now()));
      return () => {
        const current = repository.get(uid);
        if (current !== null) repository.save(arrangeItems(current, was, now()));
      };
    },
  });

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

  // The tier actions, each a change to the board; a tier taken away can come
  // back with its cards from the snackbar.
  const onTier = (action: EditorAction) => {
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
  const editorTiers: EditorTier[] = editorTiersOf(board);
  const closePanel = () => setPanel("none");
  // The tiers are changed on the board itself, as on the phone.
  const tierEditing = {
    move: (from: number, to: number) => {
      const key = editorTiers[from]?.key;
      if (key !== undefined) onTier({ type: "placeTier", key, index: to });
    },
    open: (index: number) => setOpenTier(editorTiers[index]?.key ?? null),
    add: editorTiers.length < BOARD_LIMITS.tiers ? () => onTier({ type: "addTier" }) : undefined,
  };
  const opened = editorTiers.find((tier) => tier.key === openTier);
  // New tier, from the settings: the sheet gives way to the tier editor, open on a tier added for it.
  const newTier = () => {
    const before = latest();
    const change = applyTierAction(before, { type: "addTier" }, now(), nextUid);
    if (change.board === before) return;
    keep(change.board);
    closePanel();
    setOpenTier(rankedTiers(change.board).at(-1)?.uid ?? null);
  };
  // Propose a section, from the end of the section picker: the form takes the
  // sheet's place, as a screen of its own does on the phone, and gives it back
  // when it closes. A guest signs in first, as the Public switch asks them to.
  const waiting = myWaiting(sections, me);
  const openProposal = () => {
    if (account?.kind === "signedIn") {
      setPanel(waiting.length >= PENDING_MAX ? "tooMany" : "propose");
      return;
    }
    void signIn().then((outcome) => {
      if (outcome.kind === "signedIn") setPanel("propose");
    });
  };

  const toTrash = () => {
    keep(trashBoard(board, now()));
    void navigate("/b", { state: { trashed: [uid] } satisfies BoardsPageState });
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

  // A picture belongs to an account: a guest is asked to sign in at the first
  // one, and the add box sends the rest only once that one is in.
  const uploadAsAccount: Upload = async (file) => {
    if (account?.kind !== "signedIn") {
      const outcome = await signIn();
      if (outcome.kind !== "signedIn") throw new PictureRefused("signIn");
    }
    return upload(file);
  };

  const ranked = rankedCount(board);
  const inPool = poolCount(board);
  const tools = (
    <AddCardBox
      items={editorItems}
      category={board.category}
      dispatch={dispatch}
      lookup={lookup}
      upload={uploadAsAccount}
    />
  );

  return (
    <article
      className={
        boardDock === null ? "list-page board-page" : `list-page board-page list-page--${boardDock}`
      }
    >
      <Link className="board-page__back" to="/b">
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
              ...(board.category === null ? [] : [filedUnder(board.category, sections, me)]),
            ].join(" · ")}
          </p>
        </div>
        <span className="list-head__tools">
          <PlayButton {...play.button} />
          <Menu label={strings.boards.more} button={<Icon name="more_vert" />}>
            <>
              <li>
                <button type="button" className="menu__action" onClick={() => setPanel("settings")}>
                  {strings.boards.settings}
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

      {panel === "settings" && (
        <BoardSettings
          board={board}
          latest={latest}
          keep={keep}
          sections={sections}
          onCategory={(category) => keep(setCategory(latest(), category, now()))}
          onPropose={openProposal}
          onMode={(mode) => keep(setDisplayMode(latest(), mode, now()))}
          onNewTier={newTier}
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
          topics={topics}
          onDone={closePanel}
          now={now}
        />
      )}
      {panel === "propose" && (
        <SectionEditor
          mode="propose"
          sections={sections}
          fileUnder={board.category ?? undefined}
          waiting={waiting.length}
          send={propose}
          deps={proposeDeps}
          onTooMany={() => setPanel("tooMany")}
          onClose={() => setPanel("settings")}
          onDone={() => {
            setPanel("settings");
            setNotice({ text: strings.propose.proposed });
            // The new proposal is offered in the picker at once: the sections are asked for again.
            store.invalidate();
            store.refresh(me ?? "guest");
          }}
        />
      )}
      {panel === "tooMany" && (
        <TooManyDialog waiting={waiting} onClose={() => setPanel("settings")} />
      )}

      {board.displayMode === "FLAT_RANKED" ? (
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
              strip={board.displayMode === "HORIZONTAL_SCROLL"}
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
      {play.view}
      <Snackbar notice={notice} onDone={forget} />
    </article>
  );
}
