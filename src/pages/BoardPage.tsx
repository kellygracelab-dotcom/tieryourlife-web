import type { CoverFocus } from "../lib/coverFocus";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { isTmdbPicture, type EditorCredit } from "../api/pictureAttribution";
import type { SectionProposal, SectionStats } from "../api/sections";
import { isSectionId, type PublishedList } from "../api/types";
import { usePageTitle } from "../app/pageTitle";
import { RankingBoard } from "../features/tierboard/RankingBoard";
import { BoardFrameContext } from "../features/tierboard/boardFrame";
import type { Dock } from "../features/tierboard/dock";
import {
  addToPool,
  arrangeItems,
  creditOf,
  itemsIn,
  liveItems,
  moveItem,
  newBoard,
  pictureOf,
  setPicture,
  toPoolFront,
  type CardPicture,
  poolTier,
  rankedTiers,
  rename,
  renameItem,
  putBack,
  removeItem,
  restoreBoard,
  restoreTier,
  setCardCredit,
  setPictureFocus,
  setCategory,
  setDisplayMode,
  trashBoard,
  MAX_RANKED_TIERS,
  type Board,
} from "../features/boards/model";
import { PublishButton, publishKindOf } from "../features/boards/PublishButton";
import {
  BoardSettings,
  type LoadTopics,
  type PublishingDeps,
} from "../features/boards/BoardSettings";
import { PublishWindow } from "../features/boards/PublishWindow";
import { ViewButton, ViewItems } from "../features/boards/ViewButton";
import { PHONE, useMedia } from "../features/play/media";
import { CopyRankingOffer } from "../features/boards/CopyRankingOffer";
import { AS_COMMUNITY } from "../features/boards/ownList";
import { publishProblemsOf } from "../features/boards/publish";
import {
  publicationActions,
  publishedPath,
  usePublicationState,
  type OnPublished,
} from "../features/boards/usePublication";
import { noteRankingEdit } from "../features/boards/sourceRanking";
import { RankedList } from "../features/boards/RankedList";
import { filedUnder } from "../features/boards/sectionChoices";
import { shareBoard as shareBoardPicture, type Share } from "../features/ranking/share";
import type { EditorDeps } from "../features/sections/editorDeps";
import { myWaiting, PENDING_MAX } from "../features/sections/proposal";
import { SectionEditor } from "../features/sections/SectionEditor";
import { TooManyDialog } from "../features/sections/TooManyDialog";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import {
  findPictureBatch,
  findPictures,
  keepPicture,
  linkPicture,
  proposeSection,
  publish as publishList,
  republish as republishList,
  unpublish as unpublishList,
} from "../lib/api";
import { houseBoards, type BoardsRepository } from "../features/boards/repository";
import { boards as site } from "../features/boards/owners";
import { takenDown, unpublished } from "../features/boards/takeDown";
import {
  applyTierAction,
  editorTiersOf,
  newTierOf,
  tiersKeyOf,
  type RemovedTier,
} from "../features/boards/tierEditing";
import { nextUid, useBoard } from "../features/boards/useBoards";
import {
  arrangementOf,
  boardView,
  keepUnchanged,
  sameOrder,
  uidRows,
  type BoardView,
} from "../features/boards/view";
import {
  AddCardBox,
  pictureFailureText,
  type Keep,
  type LinkKeep,
  type Upload,
} from "../features/editor/AddCardBox";
import { draftForSignIn } from "../features/editor/draftAfterSignIn";
import { usePastedPictures, type Incoming } from "../lib/incoming";
import { refusedText } from "../features/editor/linkText";
import type { EditorAction, EditorItem, EditorTier } from "../features/editor/model";
import { TierDialog } from "../features/editor/TierDialog";
import type { FindPictureBatch } from "../features/editor/pasteBatch";
import type { FindPictures } from "../features/editor/usePictures";
import { keepWebPicture, PictureRefused, uploadPicture } from "../lib/pictures";
import { keepLinkedPicture, LinkRefused, linkRefusalOf } from "../lib/linkPictures";
import { useSession } from "../app/session";
import { type KeyValueStore, memoryStore, sessionStorageStore } from "../lib/storage";
import { HOUSE_PANE_PATH, HouseBar, type HouseSending } from "../features/admin/HouseBar";
import {
  boardFromHouseList,
  HOUSE_PARAM,
  houseBoardPath,
  houseLinkOf,
  houseLinkOfParam,
  houseRevisionOf,
  linkToHouse,
  markHouseCopy,
  markHouseRevision,
  withServerCredits,
  markHouseSeen,
  markHouseSent,
  unlinkFromHouse,
} from "../features/boards/houseList";
import { fill, plural, strings } from "../strings";
import { Icon } from "../ui/Icon";
import { ResetPoolItem } from "../features/tierboard/ResetPoolItem";
import { Menu } from "../ui/Menu";
import { Snackbar, useBoardNotice } from "../ui/Snackbar";
import { PlayButton } from "../features/play/PlayButton";
import { boardGames } from "../features/play/syncedGames";
import { usePlay } from "../features/play/usePlay";
import { usePlayBack } from "../features/play/usePlayBack";
import type { PlayCard, PlayTier } from "../features/play/board";
import { localStorageStore } from "../lib/storage";
import type { BoardsPageState } from "./BoardsPage";
import { useModerator, type LoadReports } from "../features/moderation/useModerator";
import { ListPageLoading } from "./ListPageStates";
import "./ListPage.css";
import "../features/editor/owner.css";
import "../features/editor/editor.css";
import "./BoardPage.css";

/** Play or Publish… chosen in the list's menu in Your lists (artboard 39): opened as the page opens. */
export interface BoardPageState {
  open: "play" | "publish";
}

interface BoardPageProps {
  repository?: BoardsRepository;
  now?: () => number;
  find?: FindPictures;
  /** A pasted list's names in batches; by default the backend's, unless `find` is given. */
  findMany?: FindPictureBatch;
  upload?: Upload;
  keepWeb?: Keep;
  /** How a picture from a link is kept. */
  linkWeb?: LinkKeep;
  publishing?: PublishingDeps;
  topics?: LoadTopics;
  share?: Share;
  store?: SectionsStore;
  propose?: (proposal: SectionProposal) => Promise<SectionStats>;
  proposeDeps?: EditorDeps;
  /** How a board edited for the house goes out. */
  house?: HouseSending;
  /** Where this device remembers which of its boards are the house's. */
  houseStore?: KeyValueStore;
  /** The boards this device edits for the house, apart from one's own and never synced. */
  houseRepository?: BoardsRepository;
  /** Asks whether this account is staff: the owner and moderators may read the reports. */
  loadReports?: LoadReports;
}

/** The settings sheet, or what its Propose a section opened in its place: the form, or the three already waiting. */
type Panel = "none" | "settings" | "publish" | "propose" | "tooMany";

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

  // Done from the keyboard, the field goes and the focus with it: the pencil takes it back.
  const pencil = useRef<HTMLButtonElement>(null);
  const backToPencil = useRef(false);
  useEffect(() => {
    if (editing || !backToPencil.current) return;
    backToPencil.current = false;
    pencil.current?.focus();
  }, [editing]);

  const keep = () => onKeep(draft);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      backToPencil.current = true;
      keep();
    } else if (event.key === "Escape") {
      backToPencil.current = true;
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
        ref={pencil}
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

/** A list in the trash, reached by Back after its Delete or by an old link: it says so, and Restore brings it back. */
function InTrash({ title, onRestore }: { title: string; onRestore: () => void }) {
  return (
    <section className="list-page list-page--trouble">
      <h1>{fill(strings.boards.inTrash, { name: title })}</h1>
      <p>{strings.boards.inTrashBody}</p>
      <span className="board-page__trash-actions">
        <button type="button" className="btn btn--filled" onClick={onRestore}>
          <Icon name="restore_from_trash" className="btn__icon" />
          <span>{strings.trash.restore}</span>
        </button>
        <Link className="btn btn--text" to="/b">
          <span>{strings.boards.back}</span>
        </Link>
      </span>
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

/**
 * A new board for the house is the staff's: the address alone makes one only
 * for the owner and the moderators, whom the backend lets publish as the
 * house. Anyone else following such a link gets a list of their own, kept
 * among their other lists. Until the backend says who this is, such a link
 * waits, since a board touched meanwhile would be kept in the wrong place.
 */
export function BoardPage(props: BoardPageProps) {
  const { uid = "" } = useParams();
  const [params] = useSearchParams();
  const { account } = useSession();
  const moderator = useModerator(props.loadReports);
  const own = useBoard(uid, props.repository ?? site);
  const forHouse = useBoard(uid, props.houseRepository ?? houseBoards);
  const known = own !== null || forHouse !== null;
  const staff = account?.kind === "signedIn" && moderator.status === "yes";
  const unsure =
    account === null || (account.kind === "signedIn" && moderator.status === "unknown");
  if (!known && !staff && unsure && houseLinkOfParam(params.get(HOUSE_PARAM)) !== null) {
    return <ListPageLoading note={strings.new.openingList} rows={2} />;
  }
  return <OpenBoard {...props} staff={staff} />;
}

/** The board a guest pressed Publish on, till they are signed in: this tab's. */
const PUBLISH_AFTER_SIGN_IN = "tyl:publishAfterSignIn";

function OpenBoard({
  repository: ownBoards = site,
  now = Date.now,
  find,
  findMany,
  upload = (file) => uploadPicture(file),
  keepWeb = (url) => keepWebPicture(url, keepPicture),
  linkWeb = (ask) => keepLinkedPicture(ask, linkPicture),
  publishing = sitePublishing,
  topics,
  share = shareBoardPicture,
  store = sectionsStore,
  propose = proposeSection,
  proposeDeps,
  house: houseSend,
  houseStore = localStorageStore,
  houseRepository = houseBoards,
  staff,
}: BoardPageProps & { staff: boolean }) {
  const { uid = "" } = useParams();
  const [params] = useSearchParams();
  const own = useBoard(uid, ownBoards);
  const forHouse = useBoard(uid, houseRepository);
  const navigate = useNavigate();
  // A board edited for the house: the address says so on arrival, and this
  // device remembers it once the board is kept, so it stays the house's
  // wherever it is opened from. It then goes out only as the house. It is
  // kept apart from one's own boards, on this device only: a house list is
  // nobody's, and the account's sync never carries it. A board of one's own
  // stays one's own, whatever an older link says.
  const remembered = forHouse === null ? null : houseLinkOf(uid, houseStore);
  const asked =
    own === null && (forHouse !== null || staff) ? houseLinkOfParam(params.get(HOUSE_PARAM)) : null;
  const house = remembered ?? asked ?? (forHouse === null ? null : { listId: null });
  const repository = house === null ? ownBoards : houseRepository;
  const stored = house === null ? own : forHouse;
  const { account, signIn } = useSession();
  const { sections, homes } = useSections(store);
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
  // Once a board for the house is kept, this device remembers it as the house's.
  const houseListId = house?.listId ?? null;
  const toRemember = house !== null && remembered === null && stored !== null;
  useEffect(() => {
    if (toRemember) linkToHouse(uid, houseListId, houseStore);
  }, [toRemember, uid, houseListId, houseStore]);
  // The name is asked for once, on arrival at a board not yet kept: a reload
  // keeps the query, not the question.
  const [editingTitle, setEditingTitle] = useState(madeAt > 0 && stored === null);
  // Once that name is in, an empty board's cursor goes on to the cards.
  const askedName = useRef(editingTitle);
  const empty = board === null || liveItems(board).length === 0;
  useEffect(() => {
    if (editingTitle || !askedName.current) return;
    askedName.current = false;
    if (empty) document.querySelector<HTMLInputElement>(".pool__tools input[type='text']")?.focus();
  }, [editingTitle, empty]);
  const [panel, setPanel] = useState<Panel>("none");
  const openSettings = () => setPanel("settings");
  // The Publish window, opened to go on by itself (start) after a sign-in or
  // a section proposed from it.
  const [publishStart, setPublishStart] = useState(false);
  const openPublish = (start = false) => {
    setPublishStart(start);
    setPanel("publish");
  };
  // A topic to be a section of its own: the proposal form starts with its name.
  const [sectionDraft, setSectionDraft] = useState<{
    name: string;
    fileUnder: string | null;
  } | null>(null);
  // A guest's Publish signs them in first; once the account is here, the
  // window opens on Publish again and the publish goes on by itself. Kept for
  // the tab, so a sign-in by a redirect comes back to it too.
  const signInToPublish = async () => {
    sessionStorageStore.write(PUBLISH_AFTER_SIGN_IN, uid);
    const outcome = await signIn();
    if (outcome.kind === "failed" || outcome.kind === "cancelled") {
      sessionStorageStore.remove(PUBLISH_AFTER_SIGN_IN);
    }
    return outcome;
  };
  useEffect(() => {
    if (me === null || sessionStorageStore.read(PUBLISH_AFTER_SIGN_IN) !== uid) return;
    // Once the account's boards are in: the window that opens is the account's.
    const timer = setTimeout(() => {
      if (sessionStorageStore.read(PUBLISH_AFTER_SIGN_IN) !== uid) return;
      sessionStorageStore.remove(PUBLISH_AFTER_SIGN_IN);
      setPublishStart(true);
      setPanel("publish");
    });
    return () => clearTimeout(timer);
  }, [me, uid]);
  // Brief, and gone at the board's next action (Friends, 16.11).
  const { notice, setNotice, done: forget, acted } = useBoardNotice();
  // Where a publish stands: the header's button and the sheet's press the same one.
  const publication = usePublicationState(`${uid}:${me ?? ""}`);
  // A paste or a drop for a new card, on its way to the add box.
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const incomingTaken = useCallback(() => setIncoming(null), []);
  // The card the draft just made, shown for a moment in the pool.
  const [freshUid, setFreshUid] = useState<string | null>(null);
  // A guest's draft coming back from a sign-in that left the page: the tools open for it.
  const [toolsOpen] = useState(() => draftForSignIn(window.location.pathname) !== null);
  // Ctrl+V on a board shown as one ranked column: the add box above it takes it.
  usePastedPictures(board?.displayMode === "FLAT_RANKED" && board.deletedAt === null, setIncoming);
  // The tier opened from the board, by its uid; or a tier still to be made, by Add tier.
  const [openTier, setOpenTier] = useState<string | null>(null);
  const [makingTier, setMakingTier] = useState(false);
  // A tier moved from the keyboard (Alt+arrow on its band) keeps the keyboard:
  // the board is drawn afresh for the new order, so its pencil is found again.
  const tierFocus = useRef<number | null>(null);
  // A Delete already taking the public copy down.
  const trashing = useRef(false);
  useEffect(() => {
    const at = tierFocus.current;
    if (at === null) return;
    tierFocus.current = null;
    document.querySelectorAll<HTMLElement>(".owner .board > .tier .tier__edit")[at]?.focus();
  });
  const [boardDock, setBoardDock] = useState<Dock | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  // A phone's one-row head carries the count and Undo under the name (artboard 18).
  const phoneHead = useMedia(PHONE);
  const tightHead = useTightHead(phoneHead);
  const frame = useMemo(
    () => ({ headSlot, report: setBoardDock, phoneHead }),
    [headSlot, phoneHead],
  );
  // The board's own scratch for the ranking board: nothing of it outlives the
  // page. Where the pool sits and the menu's hint are the device's, and stay.
  const [scratch] = useState(() => memoryStore());

  usePageTitle(board === null ? null : board.title || strings.boards.untitled);

  // The cards keep their indexes while the page is open (see boardView): the
  // order drawn is kept, and taken afresh only when the cards change.
  const [drawn, setDrawn] = useState<readonly string[]>();
  const drawnView = useMemo(
    () => (board === null ? null : boardView(board, strings.boards.untitled, drawn)),
    [board, drawn],
  );
  // The cards that read as before stay the same objects, so a move redraws
  // only the card moved (see keepUnchanged). Adjusted during the render, as
  // the order drawn is.
  const [kept, setKept] = useState<{ from: BoardView | null; view: BoardView | null }>({
    from: null,
    view: null,
  });
  let view = kept.view;
  if (kept.from !== drawnView) {
    view = drawnView === null ? null : keepUnchanged(kept.view, drawnView);
    setKept({ from: drawnView, view });
  }
  if (view !== null && !sameOrder(view.uids, drawn)) setDrawn(view.uids);

  // Play's cards and tiers: the board's own, by uid, best tier first.
  const playCards = useMemo<PlayCard[]>(
    () =>
      board === null
        ? []
        : liveItems(board)
            .sort((a, b) => a.position - b.position)
            .map((item) => ({
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
  // Every picture search from the list says its section, and its topic when
  // the backend knows it, so the search can judge what it found (picture search, stage 1).
  const listSection = board?.category ?? null;
  const topicId = board?.topic?.id ?? null;
  const listFind = useMemo<FindPictures>(() => {
    const base = find ?? findPictures;
    return (ask) =>
      base({
        ...ask,
        ...(listSection === null || listSection === "" ? {} : { section: listSection }),
        ...(topicId === null || topicId === "" ? {} : { topic: topicId }),
      });
  }, [find, listSection, topicId]);
  // A pasted list asks for its names ten at a time, judged the same way (stage 2).
  // A page given its own `find` (a test) searches name by name unless given this too.
  const listFindMany = useMemo<FindPictureBatch | undefined>(() => {
    const base = findMany ?? (find === undefined ? findPictureBatch : undefined);
    if (base === undefined) return undefined;
    return (ask) =>
      base({
        ...ask,
        ...(listSection === null || listSection === "" ? {} : { section: listSection }),
        ...(topicId === null || topicId === "" ? {} : { topic: topicId }),
      });
  }, [find, findMany, listSection, topicId]);
  // One's own board keeps its game in the board itself, so the account
  // carries it to the phone; without changing when the board was last edited.
  const poolId = board === null ? null : (poolTier(board)?.uid ?? null);
  const games = useMemo(
    () =>
      boardGames(
        () => repository.get(uid)?.play ?? null,
        (game) => {
          const current = repository.get(uid);
          // A game started here takes the place of one this site cannot read.
          if (current !== null) {
            repository.save({
              ...current,
              play: game,
              ...(game === null ? {} : { otherPlay: undefined }),
            });
          }
        },
        poolId,
      ),
    [repository, uid, poolId],
  );
  // The board on screen holds its rows itself: an arrangement made elsewhere
  // (Play's result, its Undo) draws a fresh one over the cards.
  const [arranged, setArranged] = useState(0);
  // An arrangement written elsewhere (another tab, the account's copy coming
  // down) is drawn too: rows held from before would write the old one back
  // over it at the next move. The board's own moves are told apart by the
  // arrangement they wrote.
  const arrangement = board === null ? null : arrangementOf(board);
  const [shownArrangement, setShownArrangement] = useState(arrangement);
  const [ownArrangement, setOwnArrangement] = useState<string | null>(null);
  if (arrangement !== shownArrangement) {
    setShownArrangement(arrangement);
    if (arrangement !== ownArrangement && shownArrangement !== null) {
      setArranged((round) => round + 1);
    }
  }
  // The arrangement before the last game, by card uid, and the board drawn
  // over its result: that board's Undo turns the game's step over, before
  // the game and after it. Any other fresh board leaves it behind.
  const [gameStep, setGameStep] = useState<{ round: number; rows: string[][] } | null>(null);
  // A game has just put its result on the board: the offer to show it may come.
  const [afterGame, setAfterGame] = useState(false);
  // The last tier taken away, with its cards, and the tiers it left: the
  // header's Undo can bring it back (night pass W15).
  const [tierStep, setTierStep] = useState<(RemovedTier & { tiers: string }) | null>(null);
  const play = usePlay(uid, playCards, playTiers, localStorageStore, {
    title: board?.title || strings.boards.untitled,
    games,
    notify: setNotice,
    share: () => void shareBoard(),
    // The result replaces the arrangement, one step of the board's history.
    onApply: (rows) => {
      const before = repository.get(uid) ?? board;
      if (before === null) return;
      const was = rankedTiers(before).map((tier) =>
        itemsIn(before, tier.uid).map((item) => item.uid),
      );
      if (before.takenFrom !== null) noteRankingEdit(before.uid);
      const after = arrangeItems(before, rows, now());
      // Drawn afresh here, not again as an arrangement that came from elsewhere.
      setOwnArrangement(arrangementOf(after));
      repository.save(after);
      const round = arranged + 1;
      setArranged(round);
      setGameStep({ round, rows: was });
      // The game's step is the one Undo turns over now.
      setTierStep(null);
      setAfterGame(true);
    },
  });
  usePlayBack(play);
  const location = useLocation();
  const fromMenu = useRef((location.state as Partial<BoardPageState> | null)?.open ?? null);
  useEffect(() => {
    const what = fromMenu.current;
    if (what === null || board === null) return;
    fromMenu.current = null;
    // Once: Back and a reload find the board as it is.
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    if (what === "play") play.open();
    else openPublish();
  });

  if (board === null || view === null) return <NotFound />;
  // Not a board to edit while it is in the trash: an edit would be kept on a
  // list Your lists no longer shows.
  if (board.deletedAt !== null) {
    return (
      <InTrash
        title={board.title.trim().length > 0 ? board.title : strings.boards.untitled}
        onRestore={() => {
          const current = repository.get(uid);
          if (current !== null) repository.save(restoreBoard(current));
        }}
      />
    );
  } // Publish, Update or Show in Rankings beside Play.
  const publishKind = publishKindOf(board, house !== null);

  // What the board is right now: what is kept, or the fresh one until it is.
  const latest = (): Board => repository.get(uid) ?? board;
  const keep = (next: Board) => {
    if (next === board) return;
    acted();
    const nextOrder = arrangementOf(next);
    if (next.takenFrom !== null && nextOrder !== arrangement) noteRankingEdit(next.uid);
    setOwnArrangement(nextOrder);
    repository.save(next);
  };

  // Said under the board: out, sent again, in a list's Rankings, or down.
  // Out where others see it, with View to go and look (Danylo, 16.11.2026).
  const onPublished: OnPublished = (what, _id, dropped = 0) => {
    const said =
      what === "unpublished"
        ? strings.boards.unpublished
        : what === "held"
          ? strings.boards.publishedHeld
          : what === "updated"
            ? strings.boards.updatedShort
            : what === "ranking"
              ? strings.boards.rankedShort
              : strings.boards.publishedShort;
    // Pictures from other sites that could not be fetched or checked in time (QA S11).
    const lost = plural(strings.boards.picturesDropped, dropped);
    const text =
      dropped === 0 ? said : /[.!?。]$/.test(said) ? `${said} ${lost}` : `${said}. ${lost}`;
    const where = what === "unpublished" ? null : publishedPath(latest());
    setNotice(
      where === null
        ? { text }
        : {
            text,
            action: {
              text: strings.boards.seePublished,
              onClick: () => void navigate(where, { state: AS_COMMUNITY }),
            },
          },
    );
  };
  // A house list never goes out under the person's name: it has none of this.
  const ownPublishing = house === null ? publishing : null;
  const publish = publicationActions(publication, {
    latest,
    keep,
    publishing: ownPublishing,
    account,
    onPublished,
    now,
  });
  // The header's button (Danylo's canvas, 16.11.2026): Update sends the
  // changes at once, and the window opens only to say why it could not; the
  // others open the Publish window, as does a press while a send is on its way.
  const publishFromHeader = () => {
    const sending = publication.busy !== "idle";
    if (
      publishKind !== "update" ||
      sending ||
      me === null ||
      publishProblemsOf(latest()).length > 0
    ) {
      openPublish();
      return;
    }
    void publish.send("updated").then((out) => {
      if (!out) openPublish();
    });
  };

  // Out as the house: the board is tied to the list from now on, and the address says which.
  // The revision the list now has goes with it: the next Update stands on it.
  const sentToHouse = (
    what: "published" | "updated",
    id: string,
    updatedAt: number | null,
    revision: number | null,
    list: PublishedList | null = null,
  ) => {
    // The credits the server filled in from their pages, read back with the
    // list, unless somebody else wrote it in between.
    if (list !== null && (revision === null || list.revision === revision)) {
      const before = latest();
      const filled = withServerCredits(before, list);
      if (filled !== before) repository.save(filled);
    }
    linkToHouse(uid, id, houseStore);
    markHouseSent(uid, latest().editedAt, houseStore);
    markHouseSeen(uid, updatedAt, houseStore);
    markHouseRevision(uid, revision, houseStore);
    void navigate(houseBoardPath(uid, id), { replace: true });
    setNotice({
      text: what === "published" ? strings.admin.housePublished : strings.admin.houseUpdated,
      action: { text: strings.admin.house, onClick: () => void navigate(HOUSE_PANE_PATH) },
    });
  };
  // The list it updated is gone: the board can still go out as a new one.
  const houseGone = () => {
    linkToHouse(uid, null, houseStore);
    markHouseRevision(uid, null, houseStore);
    void navigate(houseBoardPath(uid, null), { replace: true });
  };
  // The list moved on while this board was edited, and the editor loaded it:
  // the board becomes the list as it stands, under its own uid and address.
  const houseLoaded = (list: PublishedList) => {
    const asItStands = { ...boardFromHouseList(list, now(), nextUid), uid };
    repository.save(asItStands);
    markHouseCopy(asItStands, list, houseStore);
  };

  const onRows = (rows: readonly (readonly number[])[], pool: readonly number[]) => {
    const [poolUids = []] = uidRows(view, [pool]);
    keep(arrangeItems(latest(), uidRows(view, rows), now(), poolUids));
  };

  const remove = (item: number) => {
    const itemUid = view.uids[item];
    const current = latest();
    if (itemUid === undefined) return;
    const card = current.items.find((it) => it.uid === itemUid);
    if (card === undefined) return;
    keep(removeItem(current, itemUid, now()));
    setNotice({
      text: fill(strings.boards.cardTrashed, { name: card.title }),
      action: {
        text: strings.boards.undo,
        onClick: () => {
          const again = repository.get(uid);
          if (again !== null) {
            repository.save(putBack(again, card, now(), current.coverImageUrls));
          }
        },
      },
    });
  };

  // Another name for a card, from its menu or the add box's names for uploads
  // (night pass W22): kept, and synced and published, as any other edit is.
  const renameCard = (itemUid: string, title: string) =>
    keep(renameItem(latest(), itemUid, title, now()));

  // The add-card box speaks the editor's language; here its cards go to the pool.
  const dispatch = (action: EditorAction) => {
    if (action.type !== "addItem") return;
    const current = latest();
    const key = action.key;
    const taken = key !== undefined && current.items.some((it) => it.uid === key);
    const cardUid = key !== undefined && !taken ? key : nextUid();
    const title = action.title.length > 0 ? action.title : strings.new.unnamed;
    const added = addToPool(
      current,
      [
        {
          title,
          imageUrl: action.imageUrl,
          pictureId: action.pictureId ?? null,
          credit: creditOf(action.credit),
          attribution: action.attribution ?? null,
          // TMDB's by the attribution; by the catalogue id only for a hit without one.
          source: isTmdbPicture(action.attribution, action.key) ? "TMDB" : "MANUAL",
        },
      ],
      now(),
      () => cardUid,
    );
    if (action.drafted !== true || added === current) {
      keep(added);
      return;
    }
    // A card made in the draft goes first in the pool, is shown, and can be undone.
    keep(toPoolFront(added, cardUid, now()));
    setFreshUid(cardUid);
    setNotice({
      text: fill(strings.link.added, { name: title }),
      action: {
        text: strings.boards.undo,
        onClick: () => {
          const again = repository.get(uid);
          if (again !== null) repository.save(removeItem(again, cardUid, now()));
        },
      },
    });
  };
  const editorItems: EditorItem[] = view.uids.map((itemUid, index) => ({
    key: itemUid,
    title: view.list.items[index]?.title ?? "",
    imageUrl: view.list.items[index]?.imageUrl ?? null,
    pictureId: null,
  }));

  // The tier actions, each a change to the board; a tier taken away can come
  // back with its cards from the snackbar, and from the header's Undo after it.
  const onTier = (action: EditorAction) => {
    const change = applyTierAction(latest(), action, now(), nextUid);
    keep(change.board);
    const removed = change.removed;
    if (removed !== undefined) {
      setTierStep({ ...removed, tiers: tiersKeyOf(change.board) });
      const cards = removed.itemUids.length;
      setNotice({
        text:
          cards === 0
            ? fill(strings.boards.tierRemoved, { name: removed.tier.label })
            : fill(plural(strings.boards.tierRemovedCards, cards), { name: removed.tier.label }),
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
  // The header's Undo brings the tier back once the board's own moves since
  // are undone (night pass W15): only while the tiers are as the removal left
  // them, so a tier added, moved or brought back since ends it.
  const undoPast =
    tierStep === null || tierStep.tiers !== tiersKeyOf(board)
      ? null
      : () => {
          setTierStep(null);
          keep(restoreTier(latest(), tierStep.tier, tierStep.itemUids, now()));
        };
  const editorTiers: EditorTier[] = editorTiersOf(board);
  const closePanel = () => setPanel("none");
  // The tiers are changed on the board itself, as on the phone.
  const roomForTier = editorTiers.length < MAX_RANKED_TIERS;
  const tierEditing = {
    move: (from: number, to: number, keyboard = false) => {
      const key = editorTiers[from]?.key;
      if (key === undefined || to < 0 || to >= editorTiers.length) return;
      if (keyboard) tierFocus.current = to;
      onTier({ type: "placeTier", key, index: to });
    },
    open: (index: number) => setOpenTier(editorTiers[index]?.key ?? null),
    // The editor opens on the tier to be; it is made only by its Add tier.
    add: roomForTier ? () => setMakingTier(true) : undefined,
  };
  const openedAt = editorTiers.findIndex((tier) => tier.key === openTier);
  const opened = editorTiers[openedAt];
  // A topic proposed as a section of its own (Continue): the form to propose
  // a section takes the window's place, its name and where the list waits
  // filled in, and gives it back when it closes. Once it is sent, the list
  // goes into it and out by itself.
  const waiting = myWaiting(sections, me);
  const openProposal = (name: string, fileUnder: string | null) => {
    setSectionDraft({ name, fileUnder });
    setPanel(waiting.length >= PENDING_MAX ? "tooMany" : "propose");
  };

  // The public copy comes down first, as on the phone; while it cannot, the
  // board stays and says why.
  const toTrash = async () => {
    if (trashing.current) return;
    // A board kept for the house is only this device's way of editing the
    // list: it goes, and the list stays out until the House pane takes it down.
    if (house !== null) {
      repository.remove(uid);
      unlinkFromHouse(uid, houseStore);
      void navigate(HOUSE_PANE_PATH);
      return;
    }
    trashing.current = true;
    const down = await takenDown(latest(), publishing.unpublish);
    trashing.current = false;
    if (!down) {
      setNotice({ text: strings.trash.stillPublic });
      return;
    }
    keep(trashBoard(unpublished(latest(), now()), now()));
    // In place of the board, so Back does not open a list now in the trash.
    void navigate("/b", { replace: true, state: { trashed: [uid] } satisfies BoardsPageState });
  };

  // The picture of the board as the phone draws it, every tier and the pool;
  // the address under it is the published list's when there is one, the site's
  // otherwise. A house board is tied to its list by the house's link, not by an id of its own.
  // A list held for a moderator answers 404 to everybody: the picture names the site instead.
  const listId = board.heldForReview === true ? null : (board.publishedId ?? houseListId);
  // Drawing takes a moment while the pictures load: the page says so at once (designer 17.11).
  const making = { text: strings.rank.downloading };
  const shareBoard = () => {
    setNotice(making);
    return share(
      view.list,
      view.rows,
      listId === null
        ? window.location.origin
        : `${window.location.origin}/l/${encodeURIComponent(listId)}`,
    ).then(
      // A computer's download shows next to nothing: the page says the picture is saved.
      (how) =>
        setNotice((shown) =>
          how === "saved" ? { text: strings.boards.imageSaved } : shown === making ? null : shown,
        ),
      () => setNotice({ text: strings.rank.downloadFailed }),
    );
  };

  // A picture belongs to an account: a guest is asked to sign in at the first
  // one, and the add box sends the rest only once that one is in.
  const uploadAsAccount: Upload = async (file) => {
    if (account?.kind !== "signedIn") {
      const outcome = await signIn();
      if (outcome.kind !== "signedIn") throw new PictureRefused("signIn");
    }
    return upload(file);
  };
  const keepAsAccount: Keep = async (url) => {
    if (account?.kind !== "signedIn") {
      const outcome = await signIn();
      if (outcome.kind !== "signedIn") throw new PictureRefused("signIn");
    }
    return keepWeb(url);
  };
  const linkAsAccount: LinkKeep = async (ask) => {
    if (account?.kind !== "signedIn") {
      const outcome = await signIn();
      if (outcome.kind !== "signedIn") throw new LinkRefused("signIn");
    }
    return linkWeb(ask);
  };

  // A picture or a link dropped on a card, or pasted with it picked: the
  // card keeps its name and place, and only its picture changes, with an Undo.
  const replacePicture = (itemUid: string, what: Incoming) => {
    const file = what.kind === "files" ? what.files[0] : undefined;
    let picture: Promise<CardPicture>;
    if (what.kind === "link") {
      picture = linkAsAccount({ url: what.url }).then((linked) => ({
        imageUrl: linked.imageUrl,
        pictureId: linked.pictureId,
        credit: linked.credit,
        attribution: linked.attribution,
        source: isTmdbPicture(linked.attribution) ? "TMDB" : "MANUAL",
      }));
    } else if (file !== undefined) {
      picture = uploadAsAccount(file).then(({ pictureId, previewUrl }) => ({
        imageUrl: previewUrl,
        pictureId,
        credit: null,
        attribution: null,
        source: "MANUAL",
      }));
    } else return;
    picture.then(
      (next) => {
        const current = latest();
        const before = current.items.find((it) => it.uid === itemUid && it.deletedAt === null);
        if (before === undefined) return;
        const was = pictureOf(before);
        keep(setPicture(current, itemUid, next, now()));
        setNotice({
          text: fill(strings.link.changed, { name: before.title }),
          action: {
            text: strings.boards.undo,
            onClick: () => {
              const again = repository.get(uid);
              if (again !== null) repository.save(setPicture(again, itemUid, was, now()));
            },
          },
        });
      },
      (failure: unknown) => {
        if (file !== undefined) {
          setNotice({ text: pictureFailureText(file.name, failure) });
          return;
        }
        const refused = linkRefusalOf(failure);
        setNotice({
          text: refusedText(refused),
        });
      },
    );
  };
  const takePictures = (what: Incoming, item: number | null) => {
    const itemUid = item === null ? undefined : view.uids[item];
    if (itemUid === undefined) setIncoming(what);
    else replacePicture(itemUid, what);
  };
  const freshAt = freshUid === null ? -1 : view.uids.indexOf(freshUid);
  // A house board's editor credits a card's picture in About the picture; it
  // goes out with the next publish or update. Nobody else's board edits credits.
  const creditCard =
    house === null
      ? undefined
      : (itemUid: string, given: EditorCredit | null) =>
          keep(setCardCredit(latest(), itemUid, given, now()));

  // The board before the last game, by the cards' numbers on the board drawn over its result.
  const beforeGame =
    gameStep !== null &&
    gameStep.round === arranged &&
    gameStep.rows.length === rankedTiers(board).length
      ? gameStep.rows.map((row) =>
          row.map((itemUid) => view.uids.indexOf(itemUid)).filter((index) => index >= 0),
        )
      : null;

  const tools = (
    <AddCardBox
      items={editorItems}
      category={board.category}
      dispatch={dispatch}
      find={listFind}
      findMany={listFindMany}
      upload={uploadAsAccount}
      keep={keepAsAccount}
      link={linkAsAccount}
      incoming={incoming}
      onIncomingTaken={incomingTaken}
      house={house !== null}
      onRename={renameCard}
    />
  );

  return (
    <article
      className={
        boardDock === null ? "list-page board-page" : `list-page board-page list-page--${boardDock}`
      }
    >
      <Link className="board-page__back" to={house === null ? "/b" : HOUSE_PANE_PATH}>
        <Icon name="arrow_back" />
        <span>{house === null ? strings.boards.back : strings.admin.house}</span>
      </Link>
      <header className={tightHead ? "list-head list-head--tight" : "list-head"}>
        {/* Narrow, the way back is an arrow at the head's start, not a row of its own (audit C2). */}
        <Link
          className="list-head__back"
          to={house === null ? "/b" : HOUSE_PANE_PATH}
          aria-label={house === null ? strings.boards.back : strings.admin.house}
        >
          <Icon name="arrow_back" />
        </Link>
        <div className="list-head__text">
          <TitleEditor
            board={board}
            editing={editingTitle}
            onEdit={() => setEditingTitle(true)}
            onKeep={(title) => {
              setEditingTitle(false);
              keep(rename(board, title, now()));
            }}
          />
          {board.takenFrom !== null && (
            <Link to={`/l/${encodeURIComponent(board.takenFrom)}?rankings=1`}>
              {strings.rankings.progressOriginal}
            </Link>
          )}
          {/* Its section; how far it is placed is the one count, the bar's (audit C2). */}
          {board.category !== null && (
            <p className="list-head__meta">{filedUnder(board.category, sections, me, homes)}</p>
          )}
        </div>
        <span className="list-head__tools">
          <ViewButton
            mode={board.displayMode}
            onMode={(mode) => keep(setDisplayMode(latest(), mode, now()))}
          />
          {publishKind !== null && (
            <PublishButton
              kind={publishKind}
              main={view.pool.length === 0}
              busy={publication.busy === "publishing" || publication.busy === "updating"}
              onClick={publishFromHeader}
            />
          )}
          <PlayButton {...play.button} />
          <Menu label={strings.boards.more} button={<Icon name="more_vert" />}>
            <>
              {/* On a phone the header has no room for the view's button: its choices are here (artboard 18). */}
              <ViewItems
                mode={board.displayMode}
                onMode={(mode) => keep(setDisplayMode(latest(), mode, now()))}
                className="view-menu__phone"
              />
              <li className="menu__divider view-menu__phone" role="separator" />
              <ResetPoolItem
                onReset={
                  view.rows.some((row) => row.length > 0)
                    ? () => {
                        repository.save(arrangeItems(latest(), [], now()));
                        setArranged((round) => round + 1);
                        // All back in the deck: a tier brought back now would take its old cards out again.
                        setTierStep(null);
                      }
                    : null
                }
              />
              <li>
                <button type="button" className="menu__action" onClick={openSettings}>
                  {strings.boards.cover}
                </button>
              </li>
              {/* Publish, Update and Take it down are the Publish window's, opened
                  from beside Play, and the trash is reached from the boards
                  page (Danylo's canvas, 16.11.2026). */}
              <li>
                <button type="button" className="menu__action" onClick={() => void shareBoard()}>
                  {strings.boards.shareImage}
                </button>
              </li>
              <li className="menu__divider" role="separator" />
              <li>
                <button
                  type="button"
                  className="menu__action menu__action--danger"
                  onClick={() => void toTrash()}
                >
                  {strings.boards.delete}
                </button>
              </li>
            </>
          </Menu>
        </span>
        <span className="list-head__bar" ref={setHeadSlot} />
      </header>
      {house === null && board.takenFrom !== null && board.publishedId === null && (
        <CopyRankingOffer
          key={JSON.stringify([board.uid, me])}
          board={board}
          sourceId={board.takenFrom}
          repository={repository}
          notify={setNotice}
          afterGame={afterGame}
        />
      )}
      {house !== null && (
        <HouseBar
          board={board}
          latest={latest}
          listId={house.listId}
          base={() => houseRevisionOf(uid, houseStore)}
          send={houseSend}
          onSent={sentToHouse}
          onGone={houseGone}
          onLoaded={houseLoaded}
        />
      )}

      {panel === "settings" && (
        <BoardSettings
          key={JSON.stringify(["settings", board.uid, me])}
          upload={upload}
          board={board}
          latest={latest}
          keep={keep}
          sections={sections}
          // A house list never goes out under the person's name: it chooses its section here.
          chooseFiling={ownPublishing === null}
          onCategory={(category) => keep(setCategory(latest(), category, now()))}
          // Its cover takes the editor's own credit, as its cards' pictures do.
          house={house !== null}
          topics={topics}
          onDone={closePanel}
          now={now}
        />
      )}
      {panel === "publish" && ownPublishing !== null && (
        <PublishWindow
          // Drawn afresh for whose it is: a sign-in that comes back to Publish starts it again.
          key={JSON.stringify(["publish", board.uid, me, publishStart])}
          board={board}
          latest={latest}
          keep={keep}
          sections={sections}
          proposalHomes={homes}
          onCategory={(category) => keep(setCategory(latest(), category, now()))}
          onProposeSection={openProposal}
          onPublished={onPublished}
          publishing={ownPublishing}
          publication={publication}
          topics={topics}
          onClose={closePanel}
          now={now}
          start={publishStart}
          signInToPublish={signInToPublish}
          upload={upload}
        />
      )}
      {panel === "propose" && (
        <SectionEditor
          mode="propose"
          sections={sections}
          name={sectionDraft?.name}
          fileUnder={sectionDraft?.fileUnder ?? board.category ?? undefined}
          waiting={waiting.length}
          send={propose}
          deps={proposeDeps}
          onTooMany={() => {
            setPanel("tooMany");
            // Another tab or device proposed meanwhile: the dialog lists what the backend counted.
            store.invalidate();
            store.refresh(me ?? "guest");
          }}
          onClose={() => openPublish()}
          onDone={(section) => {
            setSectionDraft(null);
            // The list waits in the section proposed, and goes out into it now.
            keep(setCategory(latest(), section.id, now()));
            setNotice({ text: strings.propose.proposed });
            // The new proposal is offered among the sections at once: they are asked for again.
            store.invalidate();
            store.refresh(me ?? "guest");
            openPublish(true);
          }}
        />
      )}
      {panel === "tooMany" && <TooManyDialog waiting={waiting} onClose={() => openPublish()} />}

      {board.displayMode === "FLAT_RANKED" ? (
        <section className="owner" aria-label={strings.owner.title}>
          <div className="ranking__tools">{tools}</div>
          <RankedList
            board={board}
            onMove={(itemUid, tierUid) => {
              const current = latest();
              const to = tierUid ?? poolTier(current)?.uid;
              if (to !== undefined) keep(moveItem(current, itemUid, to, Infinity, now()));
            }}
            onRemove={(itemUid) => remove(view.uids.indexOf(itemUid))}
            onRename={renameCard}
            onCredit={creditCard}
          />
        </section>
      ) : (
        <BoardFrameContext.Provider value={frame}>
          <section className="owner" aria-label={strings.owner.title}>
            <RankingBoard
              // The rows are held by index: a tier added, taken away or moved
              // means a fresh board over the same cards, as does Play's result.
              key={`${board.uid}:${arranged}:${tiersKeyOf(board)}`}
              list={view.list}
              store={scratch}
              device={localStorageStore}
              undoTo={beforeGame}
              undoToggles
              undoPast={undoPast}
              strip={board.displayMode === "HORIZONTAL_SCROLL"}
              edit={{
                rows: view.rows,
                poolOrder: view.pool,
                save: () => Promise.resolve(),
                cancel: () => undefined,
                owner: {
                  live: true,
                  canSave: false,
                  onChange: onRows,
                  remove,
                  rename: (item: number, title: string) => {
                    const itemUid = view.uids[item];
                    if (itemUid !== undefined) renameCard(itemUid, title);
                  },
                  tools,
                  tiers: tierEditing,
                  pictures: takePictures,
                  fresh: freshAt === -1 ? null : freshAt,
                  toolsOpen,
                  ...(creditCard === undefined
                    ? {}
                    : {
                        credit: (item: number, given: EditorCredit | null) => {
                          const itemUid = view.uids[item];
                          if (itemUid !== undefined) creditCard(itemUid, given);
                        },
                      }),
                  focus: (item: number, placed: CoverFocus | null) => {
                    const itemUid = view.uids[item];
                    if (itemUid !== undefined) {
                      keep(setPictureFocus(latest(), itemUid, placed, now()));
                    }
                  },
                },
              }}
            />
          </section>
        </BoardFrameContext.Provider>
      )}
      {opened !== undefined && (
        <TierDialog
          key={opened.key}
          mode="edit"
          tier={opened}
          canRemove={editorTiers.length > 1}
          place={{ index: openedAt, count: editorTiers.length }}
          dispatch={onTier}
          onClose={() => setOpenTier(null)}
        />
      )}
      {makingTier && (
        <TierDialog
          mode="new"
          tier={newTierOf(board)}
          canRemove={false}
          dispatch={onTier}
          onClose={() => setMakingTier(false)}
        />
      )}
      {play.view}
      <Snackbar notice={notice} onDone={forget} onBoard />
    </article>
  );
}

/**
 * Whether a phone's head is scrolled into its one row (artboard 38): the
 * buttons over the whole name until the page moves, then back, the name cut
 * short, Publish, Play and the menu in one line. It goes tight past 56 px and
 * opens again only at the top, so the height it gives up cannot bounce it, and
 * a page with too little to scroll keeps it open. While ⋮ is open it stays as
 * it is.
 */
function useTightHead(phone: boolean): boolean {
  const [tight, setTight] = useState(false);
  useEffect(() => {
    if (!phone) return;
    const check = () => {
      // With ⋮ open the head keeps its shape: the menu would move from under the finger.
      if (document.querySelector(".board-page .list-head details[open]") !== null) return;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      setTight((was) => (was ? window.scrollY > 2 : window.scrollY > 56 && room > 160));
    };
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [phone]);
  return phone && tight;
}
