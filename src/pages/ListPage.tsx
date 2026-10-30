import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useParams } from "react-router";
import type { ReaderRanking } from "../api/community";
import { isOwnList, type BasedOn, type PublishedList } from "../api/types";
import { PageTitle } from "../app/pageTitle";
import { useSession } from "../app/session";
import type { BoardsRepository } from "../features/boards/repository";
import { AuthorLine } from "../features/community/AuthorLine";
import { isAuthorHidden, isOutOfSight } from "../features/community/hidden";
import { placedBy } from "../features/community/rankings";
import { RankingsChip, RankingsSheet } from "../features/community/RankingsSheet";
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
  loadPlacedDraft,
  saveDraft,
  scopeOf,
} from "../features/tierboard/draft";
import { flyIn } from "../features/tierboard/flight";
import type { Rows } from "../features/tierboard/model";
import { RankingBoard } from "../features/tierboard/RankingBoard";
import { ReadOnlyBoard } from "../features/tierboard/ReadOnlyBoard";
import { loadList, report as sendReport, unpublish as unpublishList } from "../lib/api";
import { isEditorial, isEditorialAuthor } from "../lib/editorial";
import { type KeyValueStore, localStorageStore } from "../lib/storage";
import { useResource } from "../lib/useResource";
import { fill, strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { PlayButton } from "../features/play/PlayButton";
import { usePlay } from "../features/play/usePlay";
import type { PlayCard, PlayTier } from "../features/play/board";
import { AuthorTools, VisitorTools, type Report, type Unpublish } from "./ListPageMenus";
import { ListPageLoading, ListPageTrouble } from "./ListPageStates";
import "./ListPage.css";

/** Whose arrangement is on screen, in the app's words: the author's (or a reader's), or this person's own. */
type View = "theirs" | "mine";

/** The spec's 200 ms for the cards to move when the switch changes boards. */
const SWITCH_MS = 200;

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
  const { state, retry } = useResource(id, loadList);

  if (state.status === "loading") {
    return <ListPageLoading note={strings.list.opening} rows={3} />;
  }
  if (state.status === "error") {
    return <ListPageTrouble error={state.error} retry={retry} words={strings.list} />;
  }
  // A list of its own: what was chosen on another one does not carry over.
  return <OpenList key={state.value.id} list={state.value} {...props} />;
}

function OpenList({
  list,
  report = sendReport,
  unpublish = unpublishList,
  repository,
}: ListPageProps & { list: PublishedList }) {
  const { account } = useSession();
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
  const [chosen, setChosen] = useState<ReaderRanking | null>(null);
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
    setChosen(ranking);
    setView("theirs");
    setSheet(false);
  };
  // One's own placing on the board as it is withdrawn gives way to the author's.
  const withdraw = () => {
    if (chosen?.mine === true) {
      remember();
      setChosen(null);
    }
    rankings.withdraw();
  };

  // Play over somebody else's list: the cards by their place in it, starting
  // from this device's own ranking or else the author's, and the result goes
  // into Mine. The board below is drawn afresh from the draft it writes.
  const [mineRound, setMineRound] = useState(0);
  const [mineRows, setMineRows] = useState(() => loadDraft(localStorageStore, scopeOf(list)));
  // Rows into Mine, which is drawn afresh from the draft: Play's result, or
  // Theirs with a first move made on it.
  const putInMine = (rows: Rows) => {
    const placed = rows.map((row) => [...row]);
    saveDraft(localStorageStore, scopeOf(list), placed);
    setMineRows(placed);
    setMineRound((round) => round + 1);
    show("mine");
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
    return list.tiers.map((tier, index) => ({
      id: String(index),
      label: tier.label,
      caption: tier.caption,
      colorLight: tier.colorLight,
      colorDark: tier.colorDark,
      cardIds: (rows[index] ?? []).map(String),
    }));
  }, [list, author, mineRows]);
  const play = usePlay(`list:${list.id}`, playCards, playTiers, localStorageStore, {
    title: list.title,
    theirs: true,
    notify: setNotice,
    onApply: (rows) => putInMine(rows.map((row) => row.map(Number))),
  });

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
    const scope = scopeOf(list);
    const before = localStorageStore.read(draftKey(list.id));
    const replaced = loadPlacedDraft(localStorageStore, scope) !== null;
    putInMine(rows);
    const said = replaced
      ? theirsName === null
        ? strings.list.replacedYoursUnnamed
        : fill(strings.list.replacedYours, { name: theirsName })
      : theirsName === null
        ? strings.list.startedFromUnnamed
        : fill(strings.list.startedFrom, { name: theirsName });
    setNotice({
      text: said,
      action: {
        text: strings.list.undo,
        onClick: () => {
          if (before === null) clearDraft(localStorageStore, list.id);
          else localStorageStore.write(draftKey(list.id), before);
          setMineRows(loadDraft(localStorageStore, scope));
          setMineRound((round) => round + 1);
          show("theirs");
        },
      },
    });
  };
  // Somebody else's tier words over the same cards: the board draws Theirs under them.
  const theirsList = useMemo(() => ({ ...list, tiers: theirs.tiers }), [list, theirs]);
  // The visitor's switch whenever there is a Theirs; the author's only for a reader's placing.
  const switchShown = !outOfSight && (own ? chosen !== null : theirsKnown);
  const chipShown = list.takeCount > 0 && !outOfSight;

  return (
    <article
      ref={page}
      className={boardDock === null ? "list-page" : `list-page list-page--${boardDock}`}
    >
      <header className="list-head">
        <PageTitle title={list.title} />
        <div className="list-head__text">
          <h1 className="list-head__title">{list.title}</h1>
          {/* A list that stands without an author has no line naming one. */}
          {(!editorial || chipShown) && (
            <div className="list-head__lines">
              {!editorial && (
                <AuthorLine
                  uid={list.authorUid}
                  name={list.authorName}
                  photoUrl={list.authorPhotoUrl}
                  own={own}
                  notify={setNotice}
                />
              )}
              {chipShown && <RankingsChip count={list.takeCount} onClick={() => setSheet(true)} />}
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
            <AuthorTools list={list} unpublish={unpublish} notify={setNotice} />
          ) : (
            <>
              <PlayButton {...play.button} />
              <VisitorTools
                list={list}
                report={report}
                notify={setNotice}
                repository={repository}
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
            <RankingBoard key={`${list.id}:${mineRound}`} list={list} />
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
              onStart: startFromTheirs,
            }}
          />
        ))}
      {!own && play.view}
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
