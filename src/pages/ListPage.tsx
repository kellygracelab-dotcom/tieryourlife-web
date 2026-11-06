import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import type { ReaderRanking } from "../api/community";
import { errorOf } from "../api/errors";
import { tierWordsToSend } from "../api/rank";
import { isOwnList, type BasedOn, type PublishedList } from "../api/types";
import { PageTitle } from "../app/pageTitle";
import { useSession } from "../app/session";
import { boards as site } from "../features/boards/owners";
import { boardOfList, seenAsCommunity } from "../features/boards/ownList";
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
import { RankingsSheet } from "../features/community/RankingsSheet";
import { useHidden } from "../features/community/useHidden";
import { useRankings } from "../features/community/useRankings";
import { readKept } from "../features/ranking/kept";
import { arrange, poolOf } from "../features/tierboard/arrange";
import { BoardFrameContext } from "../features/tierboard/boardFrame";
import type { Dock } from "../features/tierboard/dock";
import {
  clearDraft,
  draftKey,
  loadDraft,
  loadDraftLabels,
  loadPlacedDraft,
  saveDraft,
  scopeOf,
  withLabels,
  type TierLabels,
} from "../features/tierboard/draft";
import { flyIn } from "../features/tierboard/flight";
import type { Rows } from "../features/tierboard/model";
import { RankingBoard } from "../features/tierboard/RankingBoard";
import { ReadOnlyBoard, UnrankedPool } from "../features/tierboard/ReadOnlyBoard";
import {
  keepListRanking,
  loadList,
  loadListAsWritten,
  preloadHidesAuthor,
  report as sendReport,
  unpublish as unpublishList,
} from "../lib/api";
import { isEditorial, isEditorialAuthor } from "../lib/editorial";
import { spendPreload } from "../lib/preload";
import { type KeyValueStore, localStorageStore } from "../lib/storage";
import { useResource } from "../lib/useResource";
import { fill, strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { useBackCloses } from "../ui/useBackCloses";
import { PlayButton } from "../features/play/PlayButton";
import { localGames } from "../features/play/savedGames";
import { usePlay } from "../features/play/usePlay";
import type { PlayCard, PlayTier } from "../features/play/board";
import { AuthorTools, VisitorTools, type Report, type Unpublish } from "./ListPageMenus";
import { PictureCredits } from "./ListPageCredits";
import { ListPageLoading, ListPageTrouble } from "./ListPageStates";
import "./ListPage.css";

/** Whose arrangement is on screen, in the app's words: the author's (or a reader's), or this person's own. */
type View = "theirs" | "mine";

/** The spec's 200 ms for the cards to move when the switch changes boards. */
const SWITCH_MS = 200;

/** A reader without a name is "Someone" on the switch too, in this language. */
const named = (ranking: ReaderRanking): ReaderRanking => ({
  ...ranking,
  authorName: readerName(ranking.authorName) ?? strings.profile.someone,
});

/** This device began ranking the list, or finished: then it opens on Mine. */
const begunHere = (store: KeyValueStore, list: PublishedList): boolean =>
  loadPlacedDraft(store, scopeOf(list)) !== null || readKept(store, list.id) !== null;

/**
 * Switching boards moves the same cards rather than swapping one picture for
 * another: each tile flies from where it sat on the board that was shown to
 * where it sits on the new one. `remember` is called just before the switch;
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
      if (rect !== undefined) flyIn(tile, rect, undefined, SWITCH_MS);
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

interface WhoseSwitchProps {
  view: View;
  /** The reader whose placing the left half shows; null for the author's. */
  chosen: ReaderRanking | null;
  /** The author's own page has no Mine: the left half alone, for a reader's placing. */
  mine: boolean;
  onView: (view: View) => void;
  onBack: () => void;
}

/**
 * Theirs | Mine, the app's switch: one pill, the chosen half filled and
 * ticked. The left half is whoever's placing is on screen: the author's, or
 * a reader's by name with a cross back to the author's.
 */
function WhoseSwitch({ view, chosen, mine, onView, onBack }: WhoseSwitchProps) {
  const half = (which: View, label: string, back?: boolean) => (
    <span className={view === which ? "whose__half whose__half--on" : "whose__half"}>
      <button
        type="button"
        className="whose__segment"
        aria-pressed={view === which}
        onClick={() => onView(which)}
      >
        {view === which && <Icon name="check" className="whose__check" />}
        <span className="whose__label">{label}</span>
      </button>
      {back === true && (
        <button
          type="button"
          className="whose__back"
          aria-label={strings.list.backToAuthor}
          title={strings.list.backToAuthor}
          onClick={onBack}
        >
          <Icon name="close" />
        </button>
      )}
    </span>
  );
  return (
    <div
      className={["whose", !mine && "whose--one", view === "mine" && "whose--mine"]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={strings.list.views}
    >
      {half("theirs", chosen?.authorName ?? strings.list.viewTheirs, chosen !== null)}
      {mine && half("mine", strings.list.viewMine)}
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
  const { state, retry } = useResource(asAccount ? `${id}#account` : id, load);
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
  return <OpenList key={state.value.id} list={state.value} onListChanged={reread} {...props} />;
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
  const outOfSight = !own && isOutOfSight(hidden, list);
  const author = useMemo(() => arrange(list), [list]);
  // What somebody came for, as in the app: the author's ranking, unless this
  // device has begun its own. An author who placed nothing has no half to show.
  const [view, setView] = useState<View>(() =>
    author.known && !begunHere(localStorageStore, list) ? "theirs" : "mine",
  );
  // A reader's placing chosen in the rankings sheet, shown in the left half.
  // It is kept in the history entry too, so Back, Forward and a reload bring
  // it back as the app's saved state does.
  const location = useLocation();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<ReaderRanking | null>(() => {
    const kept = readerKeptIn(location.state, list);
    return kept === null ? null : named(kept);
  });
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
  const [sheet, setSheet] = useState(false);
  const rankings = useRankings(list.id);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  // The shape the board took on a wide screen, so the header lays itself out
  // to match, and a place in the header for the bar while the pool is under.
  const [boardDock, setBoardDock] = useState<Dock | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const frame = useMemo(() => ({ headSlot, report: setBoardDock }), [headSlot]);

  const theirsKnown = author.known || chosen !== null;
  const shown: View = own || (theirsKnown && view === "theirs") ? "theirs" : "mine";
  const page = useRef<HTMLElement>(null);
  const remember = useCardsMove(page);

  const show = (next: View) => {
    remember();
    setView(next);
  };
  const choose = (ranking: ReaderRanking | null) => {
    remember();
    keepChosen(ranking);
    setView("theirs");
    setSheet(false);
  };
  // One's own placing on the board as it is withdrawn gives way to the author's.
  const withdraw = () => {
    if (chosen?.mine === true) {
      remember();
      keepChosen(null);
    }
    rankings.withdraw();
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
  // What Mine held before rows were put in it: the board's own Undo goes back there.
  const [mineBefore, setMineBefore] = useState<Rows | null>(null);
  // Rows into Mine, which is drawn afresh from the draft: Play's result, or
  // Theirs with a first move made on it, whose tier words come too. Play's
  // result leaves the words Mine wears.
  const putInMine = (rows: Rows, labels?: TierLabels | null) => {
    const placed = rows.map((row) => [...row]);
    setMineBefore(loadPlacedDraft(localStorageStore, scopeOf(list)));
    saveDraft(localStorageStore, scopeOf(list), placed, labels);
    setMineRows(placed);
    setMineLabels(loadDraftLabels(localStorageStore, scopeOf(list)));
    setMineRound((round) => round + 1);
    show("mine");
  };
  // Undo for both: Mine's draft as it was, byte for byte, and the view it was on.
  const restoreMine = (before: string | null, back: View) => {
    if (before === null) clearDraft(localStorageStore, list.id);
    else localStorageStore.write(draftKey(list.id), before);
    setMineRows(loadDraft(localStorageStore, scopeOf(list)));
    setMineLabels(loadDraftLabels(localStorageStore, scopeOf(list)));
    setMineBefore(null);
    setMineRound((round) => round + 1);
    show(back);
  };
  const playCards = useMemo<PlayCard[]>(
    () =>
      list.items.map((item, index) => ({
        id: String(index),
        name: item.title,
        imageUrl: item.imageUrl,
      })),
    [list],
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
    games,
    notify: setNotice,
    // As on the app: "Board arranged · Undo", and Undo gives back a Mine made by hand.
    onApply: (rows) => {
      const before = localStorageStore.read(draftKey(list.id));
      const was = shown;
      putInMine(rows.map((row) => row.map(Number)));
      return () => restoreMine(before, was);
    },
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
    () => (chosen === null ? { tiers: list.tiers, ...author } : placedBy(list, chosen)),
    [list, author, chosen],
  );
  const theirsLabel = chosen?.authorName ?? (own ? strings.owner.title : strings.list.theirRanking);
  // Whose ranking Mine starts from, by name, as the app says it: the reader
  // chosen, or the author unless the list stands without one.
  const theirsName =
    chosen?.authorName ?? (editorial || list.authorName.trim() === "" ? null : list.authorName);

  // A first move on Theirs starts Mine from it, as on the phone, and says so.
  // What Mine held before is kept for Undo, which puts it back byte for byte
  // and shows Theirs again.
  const startFromTheirs = (rows: Rows) => {
    const before = localStorageStore.read(draftKey(list.id));
    const replaced = loadPlacedDraft(localStorageStore, scopeOf(list)) !== null;
    // What was on screen, the reader's tier words included (the app's mine.copy(tiers = theirs.tiers)),
    // each as short as a saved ranking keeps it, so Mine shows the words Finish will save.
    putInMine(
      rows,
      chosen === null ? null : tierWordsToSend(readerLabels(list.tiers.length, chosen)),
    );
    const said = replaced
      ? theirsName === null
        ? strings.list.replacedYoursUnnamed
        : fill(strings.list.replacedYours, { name: theirsName })
      : theirsName === null
        ? strings.list.startedFromUnnamed
        : fill(strings.list.startedFrom, { name: theirsName });
    // As long as the app's long snackbar: a finished Mine may have just been replaced.
    setNotice({
      text: said,
      action: { text: strings.list.undo, onClick: () => restoreMine(before, "theirs") },
      long: true,
    });
  };
  // Somebody else's tier words over the same cards: the board draws Theirs under them.
  const theirsList = useMemo(() => ({ ...list, tiers: theirs.tiers }), [list, theirs]);
  // A reader's ranking on show is what Save offers as Theirs, as on the phone.
  const shownPlacing = useMemo(
    () =>
      chosen === null ? null : { name: chosen.authorName, tiers: theirs.tiers, rows: theirs.rows },
    [chosen, theirs],
  );
  // The visitor's switch whenever there is a Theirs; the author's only for a reader's placing.
  const switchShown = !outOfSight && (own ? chosen !== null : theirsKnown);
  // Who else ranked it is a line of the menu, the one place the number is said.
  // Always there, as in the app: the author's own ranking heads the sheet.
  // Readers this page added to the count: one's own, shown to others here for the first time.
  const [added, setAdded] = useState(0);
  const rankingsEntry = outOfSight
    ? null
    : { count: (list.rankingCount ?? 0) + added, open: () => setSheet(true) };

  // Mine among the list's rankings, as the app's Show my ranking to others:
  // only somebody else's list, only once Mine is arranged, and only signed in.
  // Its rows name the cards by their place in the list, so the list is read
  // again first; one its author changed since sends nothing.
  const [showing, setShowing] = useState(false);
  const arranged = mineRows !== null && mineRows.some((row) => row.length > 0);
  const showToOthers = async () => {
    if (account?.kind !== "signedIn") {
      void signIn();
      return;
    }
    const rows = loadPlacedDraft(localStorageStore, scopeOf(list));
    if (showing || rows === null) return;
    setShowing(true);
    try {
      const fresh = await loadListAsWritten(list.id);
      if (fresh.updatedAt !== list.updatedAt) {
        setNotice({
          text: strings.rank.failedChanged,
          ...(onListChanged === undefined
            ? {}
            : { action: { text: strings.rank.loadAgain, onClick: onListChanged } }),
        });
        return;
      }
      const labels = loadDraftLabels(localStorageStore, scopeOf(list));
      const ranking = await keepListRanking(withLabels(list, labels), rows);
      rankings.put(ranking);
      if (ranking.created === true) setAdded((n) => n + 1);
      setNotice({ text: strings.rankings.shown });
    } catch (reason: unknown) {
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
                  error.kind === "notFound"
                    ? strings.rank.failedGone
                    : error.kind === "offline"
                      ? strings.rank.failedOffline
                      : strings.rank.failedOther,
              },
      );
    } finally {
      setShowing(false);
    }
  };
  const showMine =
    own || outOfSight || !arranged
      ? null
      : {
          signedIn: account?.kind === "signedIn",
          busy: showing,
          show: () => void showToOthers(),
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
      <header className="list-head">
        <PageTitle title={list.title} />
        <div className="list-head__text">
          <h1 className="list-head__title">
            <bdi>{list.title}</bdi>
          </h1>
          {/* One's own anonymous list says it is one's own, and that nobody else sees so. */}
          {own && list.anonymous === true && (
            <div className="list-head__lines">
              <p className="byline byline--anonymous">
                <Icon name="visibility_off" />
                {strings.card.yoursAnonymous}
              </p>
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
              />
            </div>
          )}
          {list.basedOn != null && <BasedOnLine basedOn={list.basedOn} />}
        </div>
        {switchShown && (
          <WhoseSwitch
            view={shown}
            chosen={chosen}
            mine={!own}
            onView={show}
            onBack={() => choose(null)}
          />
        )}
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
                repository={repository}
                rankings={rankingsEntry}
                shown={shownPlacing}
                showMine={showMine}
              />
            </>
          )}
        </span>
        <span className="list-head__bar" ref={setHeadSlot} />
      </header>
      {outOfSight && <HiddenView list={list} />}
      {!outOfSight &&
        (shown === "mine" ? (
          <BoardFrameContext.Provider value={frame}>
            {/* Play starts from Mine as it stands, hand moves made since included. */}
            <RankingBoard
              key={`${list.id}:${mineRound}`}
              list={mineList}
              tierLabels={mineLabels ?? undefined}
              onListChanged={onListChanged}
              undoTo={mineBefore}
              onRows={(rows) =>
                // Nothing placed in Mine: Play starts from the author's, as before.
                setMineRows(rows.some((row) => row.length > 0) ? rows.map((row) => [...row]) : null)
              }
            />
          </BoardFrameContext.Provider>
        ) : own ? (
          // The author sees the list as it was published; it is changed on its board, behind Edit.
          <ReadOnlyBoard
            label={theirsLabel}
            tiers={theirs.tiers}
            items={list.items}
            rows={theirs.rows}
            pool={chosen === null ? author.pool : []}
          />
        ) : (
          // A visitor may start from what is on show: a card moved here moves in Mine.
          // Outside the frame, so the header keeps the layout it has for Theirs.
          // What it left unranked is said under it, as the app's Theirs has it.
          <>
            <RankingBoard
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
                start: strings.list.seedStart,
                onStart: startFromTheirs,
              }}
            />
            <UnrankedPool items={list.items} pool={poolOf(theirs.rows, list.items.length)} />
          </>
        ))}
      {!own && !outOfSight && play.view}
      {!outOfSight && <PictureCredits items={list.items} />}
      {sheet && (
        <RankingsSheet
          list={list}
          rankings={rankings}
          chosen={chosen?.uid ?? null}
          onChoose={choose}
          onWithdraw={withdraw}
          onClose={() => setSheet(false)}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </article>
  );
}
