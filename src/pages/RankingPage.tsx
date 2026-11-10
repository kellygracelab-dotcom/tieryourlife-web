import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Ranking } from "../api/rank";
import type { PublishedList } from "../api/types";
import { PageTitle } from "../app/pageTitle";
import { useSession } from "../app/session";
import { arrange, poolOf } from "../features/tierboard/arrange";
import { BoardFrameContext, type BoardFrame } from "../features/tierboard/boardFrame";
import type { Dock } from "../features/tierboard/dock";
import { RankingBoard, type EditMode } from "../features/tierboard/RankingBoard";
import { ReadOnlyBoard } from "../features/tierboard/ReadOnlyBoard";
import { keptBy, readKept } from "../features/ranking/kept";
import { downloadShare, type Share } from "../features/ranking/share";
import { embeddedRanking, loadRanking, rearrangeRanking } from "../lib/api";
import { type KeyValueStore, localStorageStore, memoryStore } from "../lib/storage";
import { listIn } from "../lib/translated";
import { useResource } from "../lib/useResource";
import { currentLocale, fill, strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import {
  clearDraft,
  loadDraft,
  loadPoolOrder,
  saveDraft,
  scopeOf,
} from "../features/tierboard/draft";
import { ResetPoolItem } from "../features/tierboard/ResetPoolItem";
import { Menu } from "../ui/Menu";
import { useBackCloses } from "../ui/useBackCloses";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { ListPageLoading, ListPageTrouble } from "./ListPageStates";
import "./ListPage.css";

export type Rearrange = (
  code: string,
  rows: readonly (readonly number[])[],
  tierLabels?: undefined,
  poolOrder?: readonly number[],
) => Promise<unknown>;

interface RankingPageProps {
  load?: LoadRanking;
  store?: KeyValueStore;
  rearrange?: Rearrange;
  share?: Share;
  copy?: (text: string) => Promise<void>;
}

const clipboardCopy = (text: string): Promise<void> => navigator.clipboard.writeText(text);

/** How long "Link copied" stays on the button. */
const COPIED_MS = 2000;

/** How long "Saved" stays on the page. */
export const SAVED_NOTE_MS = 6000;

type View = "visitor" | "author";
type Viewer = "pending" | "owner" | "local" | "visitor";

/** The board only knows lists; a ranking's snapshot is one, frozen at Finish. */
const listOf = (ranking: Ranking): PublishedList => ({
  id: ranking.listId,
  title: ranking.snapshot.title,
  authorUid: "",
  anonymous: ranking.snapshot.editorial === true,
  authorName: ranking.snapshot.authorName,
  authorPhotoUrl: ranking.snapshot.authorPhotoUrl,
  category: ranking.snapshot.category,
  itemCount: ranking.snapshot.items.length,
  coverImageUrl: null,
  previewImages: [],
  tierColors: ranking.snapshot.tiers.map((tier) => tier.colorLight),
  updatedAt: ranking.createdAt,
  takeCount: 0,
  tiers: ranking.snapshot.tiers,
  items: ranking.snapshot.items,
  translations: ranking.snapshot.translations,
  names: ranking.snapshot.names,
});

/**
 * A ranking of a house list in the reader's language, as its list page read
 * a moment before; any other, and one kept before its words were, as kept.
 */
const inReadersLanguage = (ranking: Ranking): Ranking => {
  const list = listIn(listOf(ranking), currentLocale());
  return {
    ...ranking,
    snapshot: { ...ranking.snapshot, title: list.title, tiers: list.tiers, items: list.items },
  };
};

interface BodyProps {
  ranking: Ranking;
  viewer: Viewer;
  editing: boolean;
  onEdit: () => void;
  edit: EditMode;
  store: KeyValueStore;
  /** Where the dock and the menu's hint are kept, beyond this visit. */
  device: KeyValueStore;
  savedNote: boolean;
  share: Share;
  copy: (text: string) => Promise<void>;
  frame: BoardFrame;
  setHeadSlot: (slot: HTMLElement | null) => void;
}

/**
 * The ranking's address, one press from the clipboard: nobody should have to
 * select it. The words change for a moment and the chip keeps its width, so
 * the header does not jump.
 */
function AddressChip({
  code,
  copy,
  onRefused,
}: {
  code: string;
  copy: (text: string) => Promise<void>;
  onRefused: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const address = `${window.location.host}/r/${code}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = () => {
    const button = chip.current;
    if (button !== null) button.style.minWidth = `${button.offsetWidth}px`;
    copy(`https://${address}`).then(
      () => setCopied(true),
      () => {
        setCopied(false);
        onRefused();
      },
    );
  };
  return (
    <button
      ref={chip}
      type="button"
      className="address-chip"
      title={strings.list.copyLink}
      onClick={onCopy}
    >
      <Icon
        name={copied ? "check" : "link"}
        className={copied ? "address-chip__icon address-chip__icon--done" : "address-chip__icon"}
      />
      {/* An address reads left to right in any language. */}
      <span aria-live="polite" dir={copied ? undefined : "ltr"}>
        {copied ? strings.list.linkCopied : address}
      </span>
    </button>
  );
}

/**
 * The picture, beside the board on a wide screen and under it on a phone.
 * The link is the chip in the header.
 */
function Handout({ ranking, share }: { ranking: Ranking; share: Share }) {
  const [image, setImage] = useState<"idle" | "busy" | "failed">("idle");
  const address = `${window.location.host}/r/${ranking.code}`;

  const onDownload = () => {
    setImage("busy");
    share(listOf(ranking), ranking.rows, address).then(
      () => setImage("idle"),
      () => setImage("failed"),
    );
  };
  return (
    <div className="handout">
      <Button variant="tonal" icon="download" onClick={onDownload} disabled={image === "busy"}>
        {image === "busy" ? strings.rank.downloading : strings.rank.download}
      </Button>
      {image === "failed" && (
        <p className="handout__error" role="alert">
          {strings.rank.downloadFailed}
        </p>
      )}
    </div>
  );
}

function Body({
  ranking,
  viewer,
  editing,
  onEdit,
  edit,
  store,
  device,
  savedNote,
  share,
  copy,
  frame,
  setHeadSlot,
}: BodyProps) {
  const [view, setView] = useState<View>("visitor");
  // The clipboard said no: the link is spelled out, to be copied by hand.
  const [copyRefused, setCopyRefused] = useState(false);
  const [editRound, setEditRound] = useState(0);
  const [hasPlaced, setHasPlaced] = useState(ranking.rows.some((row) => row.length > 0));
  useBackCloses(false, () => undefined);
  const { snapshot } = ranking;
  const author = arrange(snapshot);
  const pending = viewer === "pending";
  const mine = viewer === "owner" || viewer === "local";
  const editorial = snapshot.editorial === true;
  const visitorLabel = pending
    ? snapshot.title
    : mine
      ? strings.rank.yours
      : strings.ranking.visitors;
  // The chips use the phone app's words when the ranking is this person's own;
  // somebody else's ranking has three parties, and "Mine" would name the wrong one.
  const visitorChip = mine ? strings.list.viewMine : strings.ranking.visitors;
  // The list page's "Theirs" would be ambiguous beside a visitor's ranking.
  const authorChip = strings.list.theirRanking;
  const byline = mine ? strings.ranking.byYou : strings.ranking.byVisitor;
  return (
    <>
      <header className="list-head">
        <PageTitle title={snapshot.title} />
        <div className="list-head__text">
          {/* The title leads to the list while it is up: for whoever made the ranking, the one way back to it. */}
          <h1 className="list-head__title">
            {ranking.listAvailable ? (
              <Link to={`/l/${encodeURIComponent(ranking.listId)}`}>
                <bdi>{snapshot.title}</bdi>
              </Link>
            ) : (
              <bdi>{snapshot.title}</bdi>
            )}
          </h1>
          <p className="list-head__meta">
            {!editorial && (
              <>
                {fillNodes(strings.list.by, { name: <bdi>{snapshot.authorName}</bdi> })}
                {" · "}
              </>
            )}
            {pending ? (
              <Skeleton className="ranking-byline-placeholder" width="8ch" height="0.8em" />
            ) : (
              byline
            )}
            {viewer === "owner" && (
              <>
                {" · "}
                {strings.ranking.editNote}
              </>
            )}
          </p>
        </div>
        {editing && (
          <Menu label={strings.list.more} button={<Icon name="more_vert" />}>
            <ResetPoolItem
              onReset={
                !hasPlaced
                  ? null
                  : () => {
                      const scope = scopeOf(listOf(ranking));
                      const rows = loadDraft(store, scope) ?? edit.rows;
                      const order = loadPoolOrder(store, scope) ?? ranking.poolOrder;
                      saveDraft(
                        store,
                        scope,
                        rows.map(() => []),
                        undefined,
                        [...poolOf(rows, scope.itemCount, order), ...rows.flat()],
                      );
                      setEditRound((round) => round + 1);
                    }
              }
            />
          </Menu>
        )}
        <AddressChip code={ranking.code} copy={copy} onRefused={() => setCopyRefused(true)} />
        <span className="list-head__bar" ref={setHeadSlot} />
      </header>
      {copyRefused && (
        <p className="list-page__status" role="alert">
          {fillNodes(strings.list.copyFailed, {
            link: <span dir="ltr">{`https://${window.location.host}/r/${ranking.code}`}</span>,
          })}
        </p>
      )}
      {savedNote && (
        <p className="list-page__saved" role="status">
          <Icon name="check_circle" />
          {strings.ranking.saved}
        </p>
      )}
      {editing ? (
        <BoardFrameContext.Provider value={frame}>
          <RankingBoard
            key={`edit-${ranking.code}-${editRound}`}
            onRows={(rows) => setHasPlaced(rows.some((row) => row.length > 0))}
            list={listOf(ranking)}
            store={store}
            device={device}
            edit={edit}
          />
        </BoardFrameContext.Provider>
      ) : (
        // The board's own grid: the panel stands beside the board from 840 px
        // and its pieces fall into the page's flow below that.
        <div className="ranking ranking--read">
          <div className="ranking__main">
            {/* A template was never arranged by anybody: nothing to say about that. */}
            {!author.known && !editorial && (
              <p className="list-page__status">
                {fill(strings.ranking.noAuthorVersion, { name: snapshot.authorName })}
              </p>
            )}
            {view === "visitor" ? (
              <ReadOnlyBoard
                label={visitorLabel}
                tiers={snapshot.tiers}
                items={snapshot.items}
                rows={ranking.rows}
                pool={poolOf(ranking.rows, snapshot.items.length, ranking.poolOrder)}
              />
            ) : (
              <ReadOnlyBoard
                label={authorChip}
                tiers={snapshot.tiers}
                items={snapshot.items}
                rows={author.rows}
                pool={author.pool}
              />
            )}
          </div>
          <div className="ranking__side">
            <Handout ranking={ranking} share={share} />
            <div className="list-page__views" role="group" aria-label={strings.list.views}>
              {pending ? (
                <Skeleton width="6rem" height="32px" />
              ) : (
                <Chip selected={view === "visitor"} onClick={() => setView("visitor")}>
                  {visitorChip}
                </Chip>
              )}
              {author.known && (
                <Chip selected={view === "author"} onClick={() => setView("author")}>
                  {authorChip}
                </Chip>
              )}
              {viewer === "owner" && (
                <Button variant="tonal" icon="edit" onClick={onEdit} className="list-page__edit">
                  {strings.ranking.edit}
                </Button>
              )}
            </div>
            {/* The invitation is for a visitor: whoever made the ranking has ranked it. */}
            {(!ranking.listAvailable || viewer === "visitor") && (
              <div className="list-page__foot">
                {ranking.listAvailable ? (
                  <>
                    <p className="list-page__invite">{strings.ranking.rankYourself}</p>
                    <Link
                      className="btn btn--filled list-page__rank"
                      to={`/l/${encodeURIComponent(ranking.listId)}`}
                    >
                      <span>{strings.ranking.rankThis}</span>
                    </Link>
                  </>
                ) : (
                  <p className="list-page__invite">{strings.ranking.listGone}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export type LoadRanking = (code: string, asAccount?: boolean) => Promise<Ranking>;

export function RankingPage(props: RankingPageProps) {
  const { code = "" } = useParams();
  return <OpenRanking key={code} code={code} {...props} />;
}

function OpenRanking({
  code,
  load = loadRanking,
  store = localStorageStore,
  rearrange = rearrangeRanking,
  share = downloadShare,
  copy = clipboardCopy,
}: RankingPageProps & { code: string }) {
  const [params, setParams] = useSearchParams();
  const { account } = useSession();
  const asAccount = account?.kind === "signedIn";
  const reader = asAccount ? account.uid : null;
  // Keep only public data for this visit. Account permissions always come from the current request.
  const [publicBoard] = useState(() => {
    const embedded = embeddedRanking(code);
    return new Map<string, Ranking>(embedded === null ? [] : [[code, embedded]]);
  });
  const loader = useCallback(() => load(code, asAccount), [load, code, asAccount]);
  const { state, retry } = useResource(
    reader === null ? code : JSON.stringify([code, reader]),
    loader,
    asAccount ? undefined : publicBoard,
  );
  // What the owner saved here, until the page is loaded afresh.
  const [rows, setRows] = useState<number[][] | null>(null);
  const [poolOrder, setPoolOrder] = useState<number[] | undefined>();
  // null until the person chooses; before that `?edit` in the address decides.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const scratch = useMemo(() => memoryStore(), []);
  // The shape the board takes on a wide screen while the owner edits, and the bar's place in the header.
  const [boardDock, setBoardDock] = useState<Dock | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const frame = useMemo<BoardFrame>(() => ({ headSlot, report: setBoardDock }), [headSlot]);

  const wantsEdit = params.has("edit");
  const ranking = state.status === "ready" ? state.value : publicBoard.get(code);
  const owned = asAccount && state.status === "ready" && state.value.yours === true;
  const editing = owned && (chosen ?? wantsEdit);
  const leaveEditing = useCallback(() => {
    if (ranking !== undefined) clearDraft(scratch, ranking.listId);
    setChosen(false);
    if (wantsEdit) setParams({}, { replace: true });
  }, [wantsEdit, setParams, ranking, scratch]);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const save = useCallback(
    async (next: readonly (readonly number[])[], order?: readonly number[]) => {
      if (order === undefined) await rearrange(code, next);
      else await rearrange(code, next, undefined, order);
      setPoolOrder(order === undefined ? undefined : [...order]);
      setRows(next.map((row) => [...row]));
      leaveEditing();
      setSavedAt(Date.now());
    },
    [rearrange, code, leaveEditing],
  );

  if (state.status === "error") {
    return <ListPageTrouble error={state.error} retry={retry} words={strings.ranking} />;
  }
  if (ranking === undefined) return <ListPageLoading note={strings.ranking.opening} rows={2} />;

  const shown = inReadersLanguage(
    rows === null ? ranking : { ...ranking, rows, poolOrder: poolOrder ?? ranking.poolOrder },
  );
  // Finished on this browser, by the person here: not by an account that signed out of it.
  const mine = keptBy(readKept(store, ranking.listId), reader)?.code === ranking.code;
  const viewer: Viewer =
    account === null || state.status !== "ready"
      ? "pending"
      : owned
        ? "owner"
        : mine
          ? "local"
          : "visitor";
  return (
    <article
      className={
        boardDock === null
          ? "list-page board-frame"
          : `list-page board-frame list-page--${boardDock}`
      }
    >
      <Body
        ranking={shown}
        viewer={viewer}
        editing={editing}
        onEdit={() => setChosen(true)}
        edit={{
          rows: shown.rows,
          poolOrder: shown.poolOrder,
          save,
          cancel: leaveEditing,
        }}
        store={scratch}
        device={store}
        savedNote={savedAt !== null}
        share={share}
        copy={copy}
        frame={frame}
        setHeadSlot={setHeadSlot}
      />
    </article>
  );
}
