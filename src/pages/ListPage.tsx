import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import type { ReaderRanking } from "../api/community";
import { errorOf } from "../api/errors";
import { tierWordsToSend } from "../api/rank";
import { isOwnList, type BasedOn, type ListSource, type PublishedList } from "../api/types";
import { PageTitle } from "../app/pageTitle";
import { useVisit } from "../app/visitMemory";
import { useSession } from "../app/session";
import { boards as site } from "../features/boards/owners";
import { boardOfList, seenAsCommunity } from "../features/boards/ownList";
import { isBehind, sentAsItIs, type Board } from "../features/boards/model";
import { sameAsPublished } from "../features/boards/publishedChanges";
import type { BoardsRepository } from "../features/boards/repository";
import { AuthorLine } from "../features/community/AuthorLine";
import { isAuthorHidden, isOutOfSight } from "../features/community/hidden";
import {
  keepingReader,
  placedBy,
  readerKeptIn,
  readerLabels,
  readerName,
} from "../features/community/rankings";
import type { AccountAction } from "../api/client";
import { captureAccountAction } from "../lib/accountAction";
import { RankingOffer, settleRankingOffer } from "../features/boards/RankingOffer";
import { useBoards } from "../features/boards/useBoards";
import { copyOfList, mineOfCopy } from "../features/boards/listCopies";
import {
  findMyRanking,
  ownCardsOfBoard,
  ownCardsOfRanking,
  withOwnCards,
  type OwnCards,
} from "../features/boards/ownCards";
import { useSaveToMine, type Shown } from "../features/boards/useSaveToMine";
import { RankingsSheet } from "../features/community/RankingsSheet";
import { shareBoard } from "../features/ranking/share";
import { useHidden } from "../features/community/useHidden";
import { useRankings } from "../features/community/useRankings";
import { readKept } from "../features/ranking/kept";
import { arrange } from "../features/tierboard/arrange";
import { BoardFrameContext } from "../features/tierboard/boardFrame";
import type { Dock } from "../features/tierboard/dock";
import {
  clearDraft,
  draftKey,
  loadDraft,
  loadDraftLabels,
  loadPoolOrder,
  loadPlacedDraft,
  saveDraft,
  scopeOf,
  withLabels,
  type TierLabels,
} from "../features/tierboard/draft";
import { flyIn } from "../features/tierboard/flight";
import type { Rows } from "../features/tierboard/model";
import { RankingBoard } from "../features/tierboard/RankingBoard";
import { ReadOnlyBoard } from "../features/tierboard/ReadOnlyBoard";
import {
  keepListRanking,
  loadList,
  loadListAsWritten,
  loadListRankings,
  listAtHand,
  preloadHidesAuthor,
  report as sendReport,
  unpublish as unpublishList,
} from "../lib/api";
import { isEditorial, isEditorialAuthor } from "../lib/editorial";
import { spendPreload } from "../lib/preload";
import { type KeyValueStore, localStorageStore } from "../lib/storage";
import { useResource } from "../lib/useResource";
import { currentLocale, fill, plural, strings } from "../strings";
import { sectionName } from "../features/sections/model";
import { sectionsStore } from "../features/sections/useSections";
import { fillNodes } from "../strings/fillNodes";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Snackbar, useBoardNotice } from "../ui/Snackbar";
import { useBackCloses } from "../ui/useBackCloses";
import { PlayButton } from "../features/play/PlayButton";
import { localGames } from "../features/play/savedGames";
import { wantsMine, wantsResume, wantsSave } from "../features/started/started";
import { usePlay } from "../features/play/usePlay";
import type { PlayCard, PlayTier } from "../features/play/board";
import { AuthorTools, VisitorTools, type Report, type Unpublish } from "./ListPageMenus";
import { ListPageLoading, ListPageTrouble } from "./ListPageStates";
import "./ListPage.css";
import { siteOrigin } from "../lib/links";
import { listFinished, listOpened } from "../lib/usageEvents";

/**
 * Whose arrangement the board holds: the author's (or a reader's), to be
 * moved and so start one's own from, or this person's own version.
 */
type View = "theirs" | "mine";

/**
 * Where the page stands: the board, whether one's own version gives way to
 * somebody else's for a look, and the reader whose placing was chosen. An
 * Undo puts all three back as they were.
 */
interface Place {
  view: View;
  peek: boolean;
  chosen: ReaderRanking | null;
}

/** The spec's 200 ms for the cards to move when the page changes boards. */
const MOVE_MS = 200;

/** A reader without a name is "Someone" on the strip too, in this language. */
const named = (ranking: ReaderRanking): ReaderRanking => ({
  ...ranking,
  authorName: readerName(ranking.authorName) ?? strings.profile.someone,
});

/**
 * A device that has placed nothing of a list saved to one's lists starts
 * Mine from the saved board, so Mine is that board and Save reads Saved.
 * True when it did.
 */
function mineFromCopy(
  store: KeyValueStore,
  list: PublishedList,
  boards: readonly Board[],
): boolean {
  if (loadPlacedDraft(store, scopeOf(list)) !== null) return false;
  const copy = copyOfList(boards, list.id);
  const mine = copy === null ? null : mineOfCopy(copy, list);
  if (mine === null) return false;
  saveDraft(store, scopeOf(list), mine.rows, null, mine.poolOrder);
  return true;
}

/** This device has a version of its own: something placed, or its cards put in an order of its own. */
const mineBegun = (store: KeyValueStore, list: PublishedList): boolean =>
  loadPlacedDraft(store, scopeOf(list)) !== null ||
  loadPoolOrder(store, scopeOf(list)) !== undefined;

/** This device began ranking the list, or finished: then it opens on one's own version. */
const begunHere = (store: KeyValueStore, list: PublishedList): boolean =>
  mineBegun(store, list) || readKept(store, list.id) !== null;

/**
 * Changing boards moves the same cards rather than swapping one picture for
 * another: each tile flies from where it sat on the board that was shown to
 * where it sits on the new one. `remember` is called just before the change;
 * the render after it moves them.
 */
function useCardsMove(box: RefObject<HTMLElement | null>): () => void {
  const before = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    if (from === null) return;
    for (const tile of box.current?.querySelectorAll<HTMLElement>(".tile[data-item]") ?? []) {
      const rect = from.get(tile.dataset.item ?? "");
      if (rect !== undefined) flyIn(tile, rect, undefined, MOVE_MS);
    }
  });
  return () => {
    const tiles = box.current?.querySelectorAll<HTMLElement>(".tile[data-item]") ?? [];
    before.current = new Map(
      [...tiles].map((tile) => [tile.dataset.item ?? "", tile.getBoundingClientRect()]),
    );
  };
}

/** The page of a list this person hid: no board, a way back, a way home. */
function HiddenView({ list }: { list: PublishedList }) {
  const { hidden, showList, showAuthor } = useHidden();
  const byAuthor = isAuthorHidden(hidden, list.authorUid);
  return (
    <div className="list-page__hidden" role="status">
      <Icon name="visibility_off" className="list-page__hidden-icon" />
      <h2>
        {byAuthor
          ? fill(strings.list.hiddenAuthorTitle, { name: list.authorName })
          : strings.list.hiddenTitle}
      </h2>
      <p>{strings.list.hiddenBody}</p>
      <div className="list-page__hidden-actions">
        <Button
          variant="filled"
          onClick={() => {
            showList(list.id);
            if (byAuthor) showAuthor(list.authorUid);
          }}
        >
          {strings.list.unhide}
        </Button>
        <Link className="btn btn--tonal" to="/">
          <span>{strings.list.goHome}</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * The list this one was made from: its title leads there and its author's
 * name to their page, two links in one sentence. An original that stands
 * without an author, or an editorial one, credits nobody.
 */
function BasedOnLine({ basedOn }: { basedOn: BasedOn }) {
  const title = <Link to={`/l/${encodeURIComponent(basedOn.id)}`}>{basedOn.title}</Link>;
  const name = basedOn.authorName?.trim() ?? "";
  const uid = basedOn.authorUid ?? "";
  if (name === "" || isEditorialAuthor(uid)) {
    return (
      <p className="list-head__based-on">{fillNodes(strings.list.basedOnUnnamed, { title })}</p>
    );
  }
  const author =
    uid === "" ? (
      name
    ) : (
      <Link to={`/u/${encodeURIComponent(uid)}`} state={{ author: { name, photoUrl: null } }}>
        {name}
      </Link>
    );
  return (
    <p className="list-head__based-on">
      {fillNodes(strings.list.basedOn, { title, name: author })}
    </p>
  );
}

/** Where a house list's cards came from: "Source: {label}", the label leading to its page. */
function SourceLine({ source }: { source: ListSource }) {
  const label = (
    <a href={source.url} target="_blank" rel="noopener noreferrer">
      {source.label}
    </a>
  );
  return <p className="list-head__based-on">{fillNodes(strings.list.source, { label })}</p>;
}

interface StripProps {
  /** Whose arrangement is on show: "danylo’s ranking". */
  title: string;
  /** The way back: to one's own version, or from a reader's placing to the author's. */
  back: string;
  onBack: () => void;
  backRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Somebody else's arrangement on show in place of one's own, or a reader's
 * in place of the author's: a strip over the board says whose it is, and its
 * one button goes back (Danylo and Android, 25.11.2026: no Author | Mine).
 */
function WhoseStrip({ title, back, onBack, backRef }: StripProps) {
  return (
    <div className="list-strip" role="region" aria-label={title}>
      <p className="list-strip__title">
        <bdi>{title}</bdi>
      </p>
      <button
        type="button"
        className="btn btn--tonal list-strip__back"
        onClick={onBack}
        ref={backRef}
      >
        <span>{back}</span>
      </button>
    </div>
  );
}

interface ListPageProps {
  report?: Report;
  unpublish?: Unpublish;
  /** Where "Save to my lists" puts the copy; the browser's own boards unless told otherwise. */
  repository?: BoardsRepository;
}

export function ListPage(props: ListPageProps) {
  const { id = "" } = useParams();
  const { account } = useSession();
  // Only a list whose page copy names nobody is read again once an account is
  // known; any other keeps its key, and so its board, when the account arrives.
  const asAccount = account?.kind === "signedIn" && preloadHidesAuthor(id);
  const load = useCallback(() => loadList(id, asAccount), [id, asAccount]);
  const visit = useVisit();
  const reader = account?.kind === "signedIn" ? account.uid : "";
  // The list in the page's own HTML is drawn in the first frame, and stays
  // drawn while the account arrives and the list is asked again for it: a
  // reload never shows the skeleton in place of a board already there.
  const peek = useCallback(() => listAtHand(id, asAccount), [id, asAccount]);
  const { state, retry } = useResource(
    JSON.stringify([id, currentLocale(), reader, asAccount]),
    load,
    visit?.lists,
    { peek, group: id },
  );
  // Republished while it was ranked: read again from the network, since the
  // page's copy may be as old as the list a Finish was just refused for.
  const reread = useCallback(() => {
    spendPreload();
    retry();
  }, [retry]);

  // One's own list opens as one's own board when this browser has it, as on
  // the phone (#226): the board is where it is changed. The boards here are
  // the account's own, so one that published the list says whose it is
  // without waiting for the list. Not when the board's settings asked to see
  // it as the community does, and not while it is still unknown who is here.
  const location = useLocation();
  const board = seenAsCommunity(location.state) ? null : boardOfList(props.repository ?? site, id);
  // In place of this page, so Back returns to where the list was tapped.
  if (board !== null && account?.kind === "signedIn") {
    return <Navigate to={`/b/${encodeURIComponent(board.uid)}`} replace />;
  }

  if (state.status === "loading" || (board !== null && account === null)) {
    return <ListPageLoading note={strings.list.opening} rows={3} />;
  }
  if (state.status === "error") {
    return <ListPageTrouble error={state.error} retry={retry} words={strings.list} />;
  }
  // A list of its own: what was chosen on another one does not carry over.
  return (
    <OpenList
      key={JSON.stringify([state.value.id, reader])}
      list={state.value}
      onListChanged={reread}
      {...props}
    />
  );
}

function OpenList({
  list,
  report = sendReport,
  unpublish = unpublishList,
  repository,
  onListChanged,
}: ListPageProps & { list: PublishedList; onListChanged?: () => void }) {
  const { account, signIn } = useSession();
  const { hidden } = useHidden();
  // The author has nobody's arrangement to compare with but their own: they
  // see the list as they published it, and the way to change it.
  const own = account?.kind === "signedIn" && isOwnList(list, account.uid);
  const editorial = isEditorial(list);
  // The author's board, when it has changes the list does not show yet: the
  // link shows this list, so the page says so and leads to Update (23.11).
  const ownBoard = own ? boardOfList(repository ?? site, list.id) : null;
  // A board that reads as ahead of its list while the list shows it as it is:
  // nothing to Update after all, whatever made it read so, a sending time
  // guessed for a board from the account above all (QA, Coordinator, 23.11).
  // Told once the pictures are compared by their source; until then, as it reads.
  const boards = repository ?? site;
  const behindUid = ownBoard !== null && isBehind(ownBoard) ? ownBoard.uid : null;
  const behindAt = behindUid === null ? null : (ownBoard?.editedAt ?? null);
  const [settledAt, setSettledAt] = useState<number | null>(null);
  useEffect(() => {
    if (behindUid === null || behindAt === null) return;
    const board = boards.get(behindUid);
    if (board === null || board.editedAt !== behindAt) return;
    let current = true;
    void sameAsPublished(board, list).then((same) => {
      if (!current || !same) return;
      // The board as it was compared, not an edit made since.
      const now = boards.get(behindUid);
      if (now !== null && isBehind(now) && now.editedAt === behindAt) {
        boards.save(sentAsItIs(now));
        setSettledAt(behindAt);
      }
    });
    return () => {
      current = false;
    };
  }, [behindUid, behindAt, list, boards]);
  const behindBoard =
    ownBoard !== null && isBehind(ownBoard) && settledAt !== ownBoard.editedAt ? ownBoard : null;
  // The sections' names as last known here; the nine stand in until the backend answered.
  const knownSections = useSyncExternalStore(
    sectionsStore.subscribe,
    sectionsStore.get,
    sectionsStore.get,
  ).sections;
  const outOfSight = !own && isOutOfSight(hidden, list);
  const author = useMemo(() => arrange(list), [list]);
  // Somebody else's list or the house's, once it is known whose it is.
  const whoseKnown = account !== null;
  useEffect(() => {
    if (whoseKnown && !own) listOpened();
  }, [whoseKnown, own]);
  // What somebody came for, as in the app: the author's ranking, ready to be
  // moved, unless this device has a version of its own, which opens instead
  // (Danylo and Android, 25.11.2026: no Author | Mine). A list whose author
  // placed nothing opens on one's own board, its cards in the deck.
  // Mine starts from the board the list was saved to; once anything is placed,
  // here or there, it is never put over Mine again while the page is open.
  const minePlaced = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  // A reader's placing chosen in the rankings sheet. It is kept in the
  // history entry too, so Back, Forward and a reload bring it back as the
  // app's saved state does.
  const [chosen, setChosen] = useState<ReaderRanking | null>(() => {
    const kept = readerKeptIn(location.state, list);
    return kept === null ? null : named(kept);
  });
  const [view, setView] = useState<View>(() => {
    mineFromCopy(localStorageStore, list, (repository ?? site).all());
    // New here?'s ready list opens on one's own board, where the first tip waits.
    if (wantsMine(location.state) || begunHere(localStorageStore, list)) return "mine";
    // Nothing of one's own yet: the author's arrangement, or the reader's placing chosen.
    return author.known || chosen !== null ? "theirs" : "mine";
  });
  // One's own version stays where it is while somebody else's is looked at, read-only.
  const [peek, setPeek] = useState(() => view === "mine" && chosen !== null);
  const keepChosen = (ranking: ReaderRanking | null) => {
    setChosen(ranking === null ? null : named(ranking));
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      {
        replace: true,
        preventScrollReset: true,
        state: keepingReader(location.state, list, ranking),
      },
    );
  };
  const [sheet, setSheet] = useState(
    () => new URLSearchParams(location.search).get("rankings") === "1",
  );
  const rankings = useRankings(list.id);
  // Brief, and gone at the board's next action; the long Undo of a replaced Mine stays.
  const { notice, setNotice, done: clearNotice, acted } = useBoardNotice();
  // The shape the board took on a wide screen, so the header lays itself out
  // to match, and a place in the header for the bar while the pool is under.
  const [boardDock, setBoardDock] = useState<Dock | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const frame = useMemo(() => ({ headSlot, report: setBoardDock }), [headSlot]);

  const theirsKnown = author.known || chosen !== null;
  const shown: View = own || (theirsKnown && view === "theirs") ? "theirs" : "mine";
  // One's own version is there, and somebody else's is on show over it for a look.
  const peeking = !own && shown === "mine" && peek && theirsKnown;
  // Somebody else's arrangement on show, where a move starts one's own version.
  const seeding = !outOfSight && !own && shown !== "mine";
  const page = useRef<HTMLElement>(null);
  const remember = useCardsMove(page);

  const place: Place = { view, peek, chosen };
  // Where the page stands now: an Undo pressed later, or boards that came
  // late, go by this rather than by the render they were made in.
  const placeNow = useRef(place);
  useLayoutEffect(() => {
    placeNow.current = { view, peek, chosen };
  }, [view, peek, chosen]);
  const goTo = (next: Place) => {
    remember();
    setView(next.view);
    setPeek(next.peek);
    if (next.chosen !== placeNow.current.chosen) keepChosen(next.chosen);
    placeNow.current = next;
  };
  // One's own version, the author's arrangement or a reader's put aside.
  const toMine: Place = { view: "mine", peek: false, chosen: null };
  // Whoever's placing was chosen: a look beside one's own version, or, with
  // none yet, an arrangement to start one from.
  const choose = (ranking: ReaderRanking | null) => {
    setSheet(false);
    const mineHeld = view === "mine" && (author.known || mineBegun(localStorageStore, list) || own);
    const back = ranking === null && !author.known;
    goTo(
      mineHeld
        ? { view: "mine", peek: !back, chosen: ranking }
        : { view: "theirs", peek: false, chosen: ranking },
    );
  };
  // The strip's and the version line's buttons hand the focus to each other,
  // as the one they were pressed on goes.
  const stripBack = useRef<HTMLButtonElement>(null);
  const seeTheirs = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    next?.current?.focus();
  });
  const lookAtAuthors = () => {
    focusNext.current = stripBack;
    goTo({ view: "mine", peek: true, chosen: null });
  };
  const backToYours = () => {
    focusNext.current = seeTheirs;
    goTo(toMine);
  };
  // Mine shown to others from this page, or taken back: until then the
  // rankings say whether it is among them.
  const [mineShown, setMineShown] = useState<boolean | null>(null);
  // One's own placing on the board as it is withdrawn gives way to the author's.
  const withdraw = (done?: (withdrawn: boolean) => void) => {
    if (chosen?.mine === true) goTo({ ...place, peek: false, chosen: null });
    if (account?.kind === "signedIn") settleRankingOffer(account.uid, list.id);
    const was = mineShown;
    setMineShown(false);
    rankings.withdraw((withdrawn) => {
      if (!withdrawn) setMineShown(was);
      done?.(withdrawn);
    });
  };

  // Play over somebody else's list: the cards by their place in it, starting
  // from this device's own ranking or else the author's, and the result goes
  // into Mine. The board below is drawn afresh from the draft it writes.
  const [mineRound, setMineRound] = useState(0);
  const [mineRows, setMineRows] = useState(() => loadDraft(localStorageStore, scopeOf(list)));
  // The words Mine's tiers wear: a reader's once Mine started from their placing, as in the app.
  const [mineLabels, setMineLabels] = useState(() =>
    loadDraftLabels(localStorageStore, scopeOf(list)),
  );
  const mineList = useMemo(() => withLabels(list, mineLabels), [list, mineLabels]);
  // What Mine held before rows were put in it: the board's own Undo goes back
  // there. Before a game it is the other side of the game's step, which Undo
  // turns over: before the game, after it, and back.
  const [mineBefore, setMineBefore] = useState<{ rows: Rows; toggles: boolean } | null>(null);
  // A game has just put its result in Mine: the offer to show it may come.
  const [afterGame, setAfterGame] = useState(false);
  // Rows into Mine, which is drawn afresh from the draft: Play's result, or
  // Theirs with a first move made on it, whose tier words come too. Play's
  // result leaves the words Mine wears.
  // Mine is finished once every card of the list has a tier.
  const mineFinished = (rows: Rows) =>
    listFinished(list.items.length, list.items.length - new Set(rows.flat()).size);
  const putInMine = (
    rows: Rows,
    labels?: TierLabels | null,
    poolOrder?: readonly number[],
    beforeGame?: Rows,
  ) => {
    const placed = rows.map((row) => [...row]);
    mineFinished(placed);
    const before = loadPlacedDraft(localStorageStore, scopeOf(list));
    setMineBefore(
      beforeGame !== undefined
        ? { rows: beforeGame, toggles: true }
        : before === null
          ? null
          : { rows: before, toggles: false },
    );
    saveDraft(localStorageStore, scopeOf(list), placed, labels, poolOrder);
    minePlaced.current = true;
    setMineRows(placed);
    setMineLabels(loadDraftLabels(localStorageStore, scopeOf(list)));
    setMineRound((round) => round + 1);
    goTo(toMine);
  };
  // Undo for all of them: Mine's draft as it was, byte for byte, and the page where it stood.
  const restoreMine = (before: string | null, back: Place) => {
    if (before === null) clearDraft(localStorageStore, list.id);
    else localStorageStore.write(draftKey(list.id), before);
    setMineRows(loadDraft(localStorageStore, scopeOf(list)));
    setMineLabels(loadDraftLabels(localStorageStore, scopeOf(list)));
    setMineBefore(null);
    setMineRound((round) => round + 1);
    goTo(back);
  };
  const mineOrder = useMemo(() => {
    const order = loadPoolOrder(localStorageStore, scopeOf(list)) ?? [];
    return [...new Set([...order, ...list.items.keys()])];
  }, [list, mineRound, mineRows]);
  const playCards = useMemo<PlayCard[]>(
    () =>
      mineOrder.map((index) => ({
        id: String(index),
        name: list.items[index]!.title,
        imageUrl: list.items[index]!.imageUrl,
      })),
    [list, mineOrder],
  );
  const playTiers = useMemo<PlayTier[]>(() => {
    const rows = mineRows ?? author.rows;
    return mineList.tiers.map((tier, index) => ({
      id: String(index),
      label: tier.label,
      caption: tier.caption,
      colorLight: tier.colorLight,
      colorDark: tier.colorDark,
      cardIds: (rows[index] ?? []).map(String),
    }));
  }, [mineList, author, mineRows]);
  // A card's id is its place in the list, so a game is kept for this
  // publication only, as the draft is: after a republish its answers would
  // be about other films.
  const games = useMemo(
    () => localGames(localStorageStore, Date.now, `${list.updatedAt}:${list.items.length}`),
    [list.updatedAt, list.items.length],
  );
  const play = usePlay(`list:${list.id}`, playCards, playTiers, localStorageStore, {
    title: list.title,
    theirs: true,
    // A house list has no author for the picker to name.
    house: editorial,
    // Until the visitor places a card themselves, the tiers are the author's.
    placedByAuthor: mineRows === null,
    games,
    notify: setNotice,
    // The end window's ways on (artboard 35): Mine as a picture, and Mine among the list's rankings.
    share: () => {
      void shareBoard(
        mineList,
        loadPlacedDraft(localStorageStore, scopeOf(list)) ?? [],
        `${siteOrigin()}/l/${encodeURIComponent(list.id)}`,
      ).then(
        (how) => {
          if (how === "saved") setNotice({ text: strings.boards.imageSaved });
        },
        () => setNotice({ text: strings.rank.downloadFailed }),
      );
    },
    rankings: { signedIn: account?.kind === "signedIn", show: () => void showToOthers() },
    // The game ends on Mine, its result one step of the board's history:
    // Undo puts Mine back as it was before the game, and again brings the
    // game's arrangement back.
    onApply: (rows) => {
      const beforeRows = mineRows ?? author.rows;
      const placed = new Set(beforeRows.flat());
      const was = loadDraft(localStorageStore, scopeOf(list)) ?? list.tiers.map((): number[] => []);
      putInMine(
        rows.map((row) => row.map(Number)),
        undefined,
        [...mineOrder.filter((i) => !placed.has(i)), ...beforeRows.flat()],
        was,
      );
      setAfterGame(true);
    },
  });
  // Resume game in "Continue" (audit B1): back into the game saved here, once, as the page opens.
  const resumeAsked = useRef(wantsResume(location.state));
  useEffect(() => {
    if (!resumeAsked.current) return;
    resumeAsked.current = false;
    play.resumeSaved();
  });
  // Back closes the sheet first, then Play, before it leaves the list: one
  // blocker for both, the router keeping only one.
  const { playing, quit } = play;
  const closeTop = useCallback(() => {
    if (sheet) setSheet(false);
    else quit();
  }, [sheet, quit]);
  useBackCloses(sheet || playing, closeTop);

  const theirs = useMemo(
    () =>
      chosen === null
        ? { tiers: list.tiers, items: list.items, ...author }
        : placedBy(list, chosen),
    [list, author, chosen],
  );
  // Whose ranking Mine starts from, by name, as the app says it: the reader
  // chosen, or the author unless the list stands without one.
  const authorName = editorial || list.authorName.trim() === "" ? null : list.authorName;
  const theirsName = chosen?.authorName ?? authorName;
  // "danylo’s ranking", or "The author’s ranking" for a list without the name.
  const theirsTitle =
    theirsName === null
      ? strings.list.authorsRankingUnnamed
      : fill(strings.list.authorsRanking, { name: theirsName });
  // The board's own name, as before: the reader's, or theirs.
  const theirsLabel = chosen?.authorName ?? (own ? strings.owner.title : strings.list.theirRanking);

  // A first move on Theirs starts Mine from it, as on the phone, and says so.
  // There is no Mine to replace: one's own version opens instead of Theirs,
  // which is then only looked at. Undo puts the draft back byte for byte and
  // shows Theirs again.
  const takeTheirs = (rows: Rows) => {
    const before = localStorageStore.read(draftKey(list.id));
    const back = place;
    // What was on screen, the reader's tier words included (the app's mine.copy(tiers = theirs.tiers)),
    // each as short as a saved ranking keeps it, so Mine shows the words Finish will save.
    // Cards a reader added of their own (K3) are theirs: Mine holds the list's.
    putInMine(
      rows.map((row) => row.filter((item) => item < list.items.length)),
      chosen === null ? null : tierWordsToSend(readerLabels(list.tiers.length, chosen)),
    );
    // As long as the app's long snackbar.
    setNotice({
      text:
        theirsName === null
          ? strings.list.startedFromUnnamed
          : fill(strings.list.startedFrom, { name: theirsName }),
      action: { text: strings.list.undo, onClick: () => restoreMine(before, back) },
      long: true,
    });
  };
  // Somebody else's tier words over the same cards: the board draws Theirs under them.
  // A reader's cards of their own come after the list's, as their rows name them.
  const theirsList = useMemo(
    () => ({ ...list, tiers: theirs.tiers, items: [...theirs.items] }),
    [list, theirs],
  );
  const keptBoards = useBoards(repository ?? site);
  // The account's boards may come after the page: the saved board then starts
  // Mine, and, as one's own version, takes the author's place on the board
  // nothing was moved on yet. A reader's placing chosen stays on show for a look.
  useEffect(() => {
    if (loadPlacedDraft(localStorageStore, scopeOf(list)) !== null) minePlaced.current = true;
    if (minePlaced.current || !mineFromCopy(localStorageStore, list, keptBoards)) return;
    minePlaced.current = true;
    setMineRows(loadDraft(localStorageStore, scopeOf(list)));
    setMineLabels(loadDraftLabels(localStorageStore, scopeOf(list)));
    setMineRound((round) => round + 1);
    const now = placeNow.current;
    if (now.view === "theirs") {
      setView("mine");
      setPeek(now.chosen !== null);
    }
  }, [list, keptBoards]);
  const knownChoice = keptBoards.some(
    (board) => board.takenFrom === list.id && board.rankingChoice !== undefined,
  );
  // Save keeps one's own version once there is one, even while the author's
  // is looked at; before, the author's arrangement as it is shown.
  const authorShown = shown === "theirs" && author.known;
  const toSave = useMemo<Shown>(
    () =>
      authorShown
        ? { whose: "author", rows: author.rows, tiers: list.tiers }
        : {
            whose: "mine",
            rows: mineRows,
            tiers: mineList.tiers,
            poolOrder: loadPoolOrder(localStorageStore, scopeOf(list)),
          },
    [authorShown, author, list, mineRows, mineList],
  );
  const saveCopy = useSaveToMine(list, toSave, setNotice, { repository });
  const saving = {
    ...saveCopy,
    // A board saved here is what was shown: it never comes back over Mine.
    start: () => {
      minePlaced.current = true;
      saveCopy.start();
    },
    label: authorShown ? strings.list.saveAuthors : strings.list.saveMyList,
  };
  // Save my list in a begun list's menu in Your lists (artboard 39): once, as
  // the page opens on Mine; on the author's ranking it waits rather than save theirs.
  const saveAsked = useRef(wantsSave(location.state));
  useEffect(() => {
    if (!saveAsked.current || authorShown || own) return;
    saveAsked.current = false;
    saving.start();
  });
  // Over the board, whose arrangement stands in for one's own and the way
  // back: to one's own version from a look at somebody else's, or from a
  // reader's placing to the author's, before there is a version to go back to.
  const strip: StripProps | null = outOfSight
    ? null
    : own
      ? chosen === null
        ? null
        : { title: theirsTitle, back: strings.list.backToYours, onBack: () => choose(null) }
      : peeking
        ? {
            title: theirsTitle,
            back: strings.list.backToYours,
            onBack: backToYours,
            backRef: stripBack,
          }
        : shown === "theirs" && chosen !== null
          ? {
              title: theirsTitle,
              back: !author.known
                ? strings.list.backToYours
                : authorName === null
                  ? strings.list.backToAuthorsUnnamed
                  : fill(strings.list.backToAuthors, { name: authorName }),
              onBack: () => choose(null),
            }
          : null;
  // One's own version on show of a list the author arranged: a grey line
  // under the title says so, and leads to the author's for a look.
  const versionLine = !own && !outOfSight && author.known && shown === "mine" && !peeking;

  // The menu's two ways over one's own version, each at once with an Undo in
  // the snackbar (Danylo and Android, 25.11.2026). Start from scratch puts
  // every card back in the deck: the ones placed last, in their order, after
  // the rest. Before there is a version it starts an empty one.
  const scratchRows: Rows =
    shown === "theirs" && !own
      ? theirs.rows.map((row) => row.filter((item) => item < list.items.length))
      : (mineRows ?? []);
  const startFromScratch =
    own || outOfSight || !scratchRows.some((row) => row.length > 0)
      ? null
      : () => {
          const before = localStorageStore.read(draftKey(list.id));
          const back = place;
          const placed = scratchRows.flat();
          const left = new Set(placed);
          putInMine(
            mineList.tiers.map(() => []),
            undefined,
            [...mineOrder.filter((i) => !left.has(i)), ...placed],
          );
          setNotice({
            text: strings.list.scratchDone,
            action: { text: strings.list.undo, onClick: () => restoreMine(before, back) },
            long: true,
          });
        };
  // Back to the author's ranking: one's own version becomes the author's arrangement again.
  const backToAuthors =
    own || outOfSight || !author.known || shown !== "mine"
      ? null
      : {
          label:
            authorName === null
              ? strings.list.backToAuthorsUnnamed
              : fill(strings.list.backToAuthors, { name: authorName }),
          run: () => {
            const before = localStorageStore.read(draftKey(list.id));
            const back = place;
            putInMine(
              author.rows.map((row) => [...row]),
              null,
            );
            setNotice({
              text:
                authorName === null
                  ? strings.list.replacedYoursUnnamed
                  : fill(strings.list.replacedYours, { name: authorName }),
              action: { text: strings.list.undo, onClick: () => restoreMine(before, back) },
              long: true,
            });
          },
        };
  // Who else ranked it is a line of the menu, the one place the number is said.
  // Always there, as in the app: the author's own ranking heads the sheet.
  // The count the list came with, and one's own as it is shown or withdrawn here.
  const rankingsEntry = outOfSight
    ? null
    : {
        count: Math.max(0, (list.rankingCount ?? 0) + rankings.state.countChange),
        open: () => setSheet(true),
      };

  // Mine among the list's rankings, as the app's Show my ranking to others:
  // only somebody else's list, only once Mine is arranged, and only signed in.
  // Its rows name the cards by their place in the list, so the list is read
  // again first; one its author changed since sends nothing.
  const [showing, setShowing] = useState(false);
  const arranged = mineRows !== null && mineRows.some((row) => row.length > 0);
  const allPlaced =
    list.items.length > 0 && new Set(mineRows?.flat() ?? []).size === list.items.length;
  const showToOthers = async (confirmed?: AccountAction) => {
    if (account?.kind !== "signedIn") {
      void signIn();
      return false;
    }
    const rows = loadPlacedDraft(localStorageStore, scopeOf(list));
    const action = confirmed ?? captureAccountAction(account.uid);
    if (showing || rows === null || !action?.isCurrent()) return false;
    const snapshot = withLabels(list, loadDraftLabels(localStorageStore, scopeOf(list)));
    setShowing(true);
    try {
      const fresh = await loadListAsWritten(list.id);
      if (!action.isCurrent()) return false;
      if (fresh.updatedAt !== list.updatedAt) {
        setNotice({
          text: strings.rank.failedChanged,
          ...(onListChanged === undefined
            ? {}
            : { action: { text: strings.rank.loadAgain, onClick: onListChanged } }),
        });
        return false;
      }
      // Mine never goes out without the cards of one's own the ranking has:
      // the board saved from the list holds them, else the ranking as it went
      // out does (Coordinator, 14.11). Mine's places for the list's cards.
      const copy = copyOfList(keptBoards, list.id);
      let own: OwnCards | null = copy === null ? null : ownCardsOfBoard(copy, fresh);
      if (copy === null) {
        const known =
          rankings.state.rankings.find((one) => one.mine && one.isAuthor !== true) ??
          (await findMyRanking((after) => loadListRankings(list.id, after)));
        if (!action.isCurrent()) return false;
        own = known === null ? null : ownCardsOfRanking(known);
      }
      const sent = own === null ? null : withOwnCards(rows, fresh.items.length, own);
      const ranking =
        sent === null
          ? await keepListRanking(snapshot, rows, action)
          : await keepListRanking(snapshot, sent.rows, action, { addedCards: sent.addedCards });
      if (!action.isCurrent()) return false;
      settleRankingOffer(action.uid, list.id);
      rankings.put(ranking);
      setMineShown(true);
      setNotice({ text: strings.rankings.shown });
      return true;
    } catch (reason: unknown) {
      if (!action.isCurrent()) return false;
      const error = errorOf(reason);
      setNotice(
        error.kind === "banned"
          ? { text: strings.rankings.showBanned }
          : error.kind === "notSignedIn"
            ? {
                text: strings.rankings.signInToShow,
                action: { text: strings.nav.signIn, onClick: () => void signIn() },
              }
            : {
                text:
                  error.kind === "sourceChanged"
                    ? strings.rank.failedChanged
                    : error.kind === "notFound"
                      ? strings.rank.failedGone
                      : error.kind === "offline"
                        ? strings.rank.failedOffline
                        : strings.rank.failedOther,
              },
      );
      return false;
    } finally {
      setShowing(false);
    }
  };
  const signedIn = account?.kind === "signedIn";
  const mineOut =
    signedIn &&
    (mineShown ?? rankings.state.rankings.some((one) => one.mine && one.isAuthor !== true));
  // Whether Mine is out there is read from the rankings as the page opens.
  const asksRankings = signedIn && !own && !outOfSight && arranged;
  const openRankings = rankings.open;
  useEffect(() => {
    if (asksRankings) openRankings();
  }, [asksRankings, openRankings]);
  const removeMine = () =>
    withdraw((withdrawn) =>
      setNotice({
        text: withdrawn ? strings.rankings.removed : strings.rankings.withdrawFailed,
      }),
    );
  const showMine =
    own || outOfSight || !arranged
      ? null
      : {
          signedIn,
          busy: showing,
          show: () => void showToOthers(),
          remove: mineOut ? removeMine : null,
        };

  return (
    <article
      ref={page}
      className={
        boardDock === null
          ? "list-page board-frame"
          : `list-page board-frame list-page--${boardDock}`
      }
    >
      <header className={own ? "list-head" : "list-head list-head--visitor"}>
        <PageTitle title={list.title} />
        <div className="list-head__text">
          <h1 className="list-head__title">
            <bdi>{list.title}</bdi>
          </h1>
          {/* How to start one's own, under the title where it is read first: under the
              last tier it stood at the page's foot (Danylo, 25.11). */}
          {seeding && <p className="list-head__start">{strings.list.seedStart}</p>}
          {/* "Your version · see danylo’s": the board is one's own, and the author's is a press away. */}
          {versionLine && (
            <p className="list-head__version">
              {fillNodes(strings.list.yourVersion, {
                see: (
                  <button
                    type="button"
                    className="list-head__see"
                    ref={seeTheirs}
                    onClick={lookAtAuthors}
                  >
                    {authorName === null
                      ? strings.list.seeAuthorsUnnamed
                      : fill(strings.list.seeAuthors, { name: authorName })}
                  </button>
                ),
              })}
            </p>
          )}
          {/* Its section and how many cards it has: "Anime · 25 cards" (artboard 21),
              then how many others ranked it, a way into their rankings (artboard 36). */}
          {/* On a phone the count stands in the author's line; a list without one keeps it here. */}
          <p
            className={
              editorial
                ? "list-head__meta list-head__count list-head__count--alone"
                : "list-head__meta list-head__count"
            }
          >
            {[
              sectionName(list.category, knownSections),
              plural(strings.card.items, list.itemCount),
            ].join(" · ")}
            {rankingsEntry !== null && rankingsEntry.count > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  className="list-head__rankings"
                  aria-haspopup="dialog"
                  onClick={rankingsEntry.open}
                >
                  {fill(strings.list.rankingsLink, {
                    rankings: plural(strings.card.rankings, rankingsEntry.count),
                  })}
                </button>
              </>
            )}
          </p>
          {/* One's own anonymous list says it is one's own, and that nobody else sees so. */}
          {own && list.anonymous === true && (
            <div className="list-head__lines">
              <p className="byline byline--anonymous">
                <Icon name="visibility_off" />
                {strings.card.yoursAnonymous}
              </p>
            </div>
          )}
          {/* Held for a moderator, the list is the author's and the moderators' alone for now. */}
          {own && list.underReview === true && (
            <div className="list-head__lines">
              <p className="byline">{strings.boards.heldBody}</p>
            </div>
          )}
          {/* A list that stands without an author has no line naming one. */}
          {!editorial && (
            <div className="list-head__lines">
              <AuthorLine
                uid={list.authorUid}
                name={list.authorName}
                photoUrl={list.authorPhotoUrl}
                own={own}
                notify={setNotice}
                count={own ? undefined : plural(strings.card.items, list.itemCount)}
              />
            </div>
          )}
          {behindBoard !== null && (
            <p className="list-head__behind">
              <span className="list-head__behind-dot" aria-hidden="true" />
              {strings.boards.notPublishedYet}
              {" · "}
              <Link to={`/b/${encodeURIComponent(behindBoard.uid)}`}>{strings.boards.update}</Link>
            </p>
          )}
          {list.basedOn != null && <BasedOnLine basedOn={list.basedOn} />}
          {list.listSource !== undefined && <SourceLine source={list.listSource} />}
        </div>
        <span className="list-head__tools">
          {own ? (
            <AuthorTools
              list={list}
              unpublish={unpublish}
              notify={setNotice}
              rankings={rankingsEntry}
              repository={repository}
            />
          ) : (
            <>
              {/* A list hidden here keeps its cards out of sight, Play's too. */}
              {!outOfSight && <PlayButton {...play.button} />}
              <VisitorTools
                list={list}
                report={report}
                notify={setNotice}
                saving={saving}
                rankings={rankingsEntry}
                showMine={showMine}
                startFromScratch={startFromScratch}
                backToAuthors={backToAuthors}
              />
            </>
          )}
        </span>
        <span className="list-head__bar" ref={setHeadSlot} />
      </header>
      {!outOfSight && !own && shown === "mine" && !peeking && !sheet && !playing && (
        <RankingOffer
          listId={list.id}
          due={arranged && (afterGame || allPlaced)}
          known={knownChoice}
          share={showToOthers}
        />
      )}
      {outOfSight && <HiddenView list={list} />}
      {strip !== null && <WhoseStrip {...strip} />}
      {!outOfSight &&
        (shown === "mine" && !peeking ? (
          <BoardFrameContext.Provider value={frame}>
            {/* Play starts from Mine as it stands, hand moves made since included. */}
            <RankingBoard
              key={`${list.id}:${mineRound}`}
              besideOnWide
              list={mineList}
              undoTo={mineBefore?.rows ?? null}
              undoToggles={mineBefore?.toggles === true}
              onRows={(rows) => {
                // A move, not the board drawn again (it says its rows as it comes).
                if (!sameRows(rows, mineRows ?? [])) {
                  acted();
                  mineFinished(rows);
                }
                // Undo took the game back: the offer it brought goes with it (QA 25).
                if (afterGame && mineBefore?.toggles === true && sameRows(rows, mineBefore.rows)) {
                  setAfterGame(false);
                }
                // Nothing placed in Mine: Play starts from the author's, as before.
                setMineRows(
                  rows.some((row) => row.length > 0) ||
                    loadPoolOrder(localStorageStore, scopeOf(list)) !== undefined
                    ? rows.map((row) => [...row])
                    : null,
                );
              }}
            />
          </BoardFrameContext.Provider>
        ) : own || peeking ? (
          // The author sees the list as it was published; it is changed on its board, behind Edit.
          // A visitor with a version of their own looks at somebody else's the same way:
          // their own stays as it is, a press away (Danylo and Android, 25.11.2026).
          <ReadOnlyBoard
            label={theirsLabel}
            tiers={theirs.tiers}
            items={theirs.items}
            rows={theirs.rows}
            pool={chosen === null ? author.pool : []}
          />
        ) : (
          // A visitor with no version yet may start one from what is on show: a card moved here moves in Mine.
          // Outside the frame, so the header keeps the layout it has for Theirs.
          // What it left unranked is its pool, where a card can be taken out too.
          <>
            <RankingBoard
              besideOnWide
              key={`theirs:${list.id}:${chosen?.uid ?? ""}:${mineRound}`}
              list={theirsList}
              seed={{
                rows: theirs.rows,
                label: theirsLabel,
                hint:
                  theirsName === null
                    ? strings.list.seedHintUnnamed
                    : fill(strings.list.seedHint, { name: theirsName }),
                dropHint: strings.list.dropToStart,
                onStart: takeTheirs,
              }}
            />
          </>
        ))}
      {!own && !outOfSight && play.view}
      {sheet && (
        <RankingsSheet
          list={list}
          rankings={rankings}
          chosen={chosen?.uid ?? null}
          showingMine={shown === "mine" && !peeking}
          onChoose={choose}
          onWithdraw={() => withdraw()}
          onClose={() => setSheet(false)}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} onBoard />
    </article>
  );
}

/** Whether two boards' rows hold the same cards in the same places; an empty board is no rows. */
function sameRows(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  const placed = (rows: readonly (readonly number[])[]) =>
    rows.some((row) => row.length > 0) ? rows : [];
  const [x, y] = [placed(a), placed(b)];
  return x.length === y.length && x.every((row, i) => row.join(",") === y[i]?.join(","));
}
