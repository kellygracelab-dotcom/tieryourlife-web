import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { ApiError } from "../api/errors";
import type { Ranking } from "../api/rank";
import type { PublishedList } from "../api/types";
import { useSession } from "../app/session";
import { arrange, poolOf } from "../features/board/arrange";
import { localStorageStore, memoryStore, type DraftStore } from "../features/board/draft";
import { RankingBoard, type EditMode } from "../features/board/RankingBoard";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { readKept } from "../features/ranking/kept";
import { useRanking, type LoadRanking } from "../features/ranking/useRanking";
import { rearrangeRanking } from "../lib/api";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import "./ListPage.css";

export type Rearrange = (code: string, rows: readonly (readonly number[])[]) => Promise<unknown>;

interface RankingPageProps {
  load?: LoadRanking;
  store?: DraftStore;
  rearrange?: Rearrange;
}

/** How long "Saved" stays on the page. */
export const SAVED_NOTE_MS = 6000;

function Loading() {
  return (
    <div className="list-page" aria-busy="true">
      <Skeleton height="28px" width="60%" />
      <Skeleton height="18px" width="40%" />
      <Skeleton height="106px" className="list-page__row" />
      <Skeleton height="106px" className="list-page__row" />
      <p className="list-page__status">{strings.ranking.opening}</p>
    </div>
  );
}

function Trouble({ error, retry }: { error: ApiError; retry: () => void }) {
  if (error.kind === "notFound") {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.ranking.unavailableTitle}</h1>
        <p>{strings.ranking.unavailableBody}</p>
        <Button variant="filled" href="/">
          {strings.list.home}
        </Button>
      </section>
    );
  }
  if (error.kind === "appUnverified") {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.list.unverifiedTitle}</h1>
        <p>{strings.list.unverifiedBody}</p>
      </section>
    );
  }
  const offline = error.kind === "offline";
  return (
    <section className="list-page list-page--trouble">
      <h1>{offline ? strings.list.offlineTitle : strings.ranking.failedTitle}</h1>
      <p>{offline ? strings.list.offlineBody : strings.list.failedBody}</p>
      <Button variant="filled" icon="refresh" onClick={retry}>
        {strings.list.tryAgain}
      </Button>
    </section>
  );
}

type View = "visitor" | "author";

/** The board only knows lists; a ranking's snapshot is one, frozen at Finish. */
const listOf = (ranking: Ranking): PublishedList => ({
  id: ranking.listId,
  title: ranking.snapshot.title,
  authorUid: "",
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
});

interface BodyProps {
  ranking: Ranking;
  mine: boolean;
  editing: boolean;
  onEdit: () => void;
  edit: EditMode;
  store: DraftStore;
  savedNote: boolean;
}

function Body({ ranking, mine, editing, onEdit, edit, store, savedNote }: BodyProps) {
  const [view, setView] = useState<View>("visitor");
  const { snapshot } = ranking;
  const author = arrange(snapshot);
  const owned = ranking.yours === true;
  const visitorLabel = mine || owned ? strings.rank.yours : strings.ranking.visitors;
  const byline = mine || owned ? strings.ranking.byYou : strings.ranking.byVisitor;
  return (
    <>
      <header className="list-head">
        <div className="list-head__text">
          <h1 className="list-head__title">{snapshot.title}</h1>
          <p className="list-head__meta">
            {fill(strings.list.by, { name: snapshot.authorName })}
            {" · "}
            {byline}
            {owned && (
              <>
                {" · "}
                {strings.ranking.editNote}
              </>
            )}
          </p>
        </div>
        <span className="list-head__address">
          <Icon name="link" />
          {`${window.location.host}/r/${ranking.code}`}
        </span>
      </header>
      {savedNote && (
        <p className="list-page__saved" role="status">
          <Icon name="check_circle" />
          {strings.ranking.saved}
        </p>
      )}
      {editing ? (
        <RankingBoard
          key={`edit-${ranking.code}`}
          list={listOf(ranking)}
          store={store}
          edit={edit}
        />
      ) : (
        <>
          <div className="list-page__views" role="group" aria-label={strings.list.views}>
            <Chip selected={view === "visitor"} onClick={() => setView("visitor")}>
              {visitorLabel}
            </Chip>
            {author.known && (
              <Chip selected={view === "author"} onClick={() => setView("author")}>
                {strings.board.authorsVersion}
              </Chip>
            )}
            {owned && (
              <Button variant="tonal" icon="edit" onClick={onEdit} className="list-page__edit">
                {strings.ranking.edit}
              </Button>
            )}
          </div>
          {!author.known && (
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
              pool={poolOf(ranking.rows, snapshot.items.length)}
            />
          ) : (
            <ReadOnlyBoard
              label={strings.board.authorsVersion}
              tiers={snapshot.tiers}
              items={snapshot.items}
              rows={author.rows}
              pool={author.pool}
            />
          )}
          <p className="list-page__foot">
            {ranking.listAvailable ? (
              <Link to={`/l/${encodeURIComponent(ranking.listId)}`}>
                {strings.ranking.rankYourself}
              </Link>
            ) : (
              strings.ranking.listGone
            )}
          </p>
        </>
      )}
    </>
  );
}

export function RankingPage({
  load,
  store = localStorageStore,
  rearrange = rearrangeRanking,
}: RankingPageProps) {
  const { code = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { account } = useSession();
  const asAccount = account?.kind === "signedIn";
  const { state, retry } = useRanking(code, load, asAccount);
  // What the owner saved here, until the page is loaded afresh.
  const [rows, setRows] = useState<number[][] | null>(null);
  // null until the person chooses; before that `?edit` in the address decides.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const scratch = useMemo(() => memoryStore(), []);

  const wantsEdit = params.has("edit");
  const ranking = state.status === "ready" ? state.value : null;
  const owned = ranking?.yours === true;
  const editing = owned && (chosen ?? wantsEdit);
  const leaveEditing = useCallback(() => {
    setChosen(false);
    if (wantsEdit) setParams({}, { replace: true });
  }, [wantsEdit, setParams]);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const save = useCallback(
    async (next: readonly (readonly number[])[]) => {
      await rearrange(code, next);
      setRows(next.map((row) => [...row]));
      leaveEditing();
      setSavedAt(Date.now());
    },
    [rearrange, code, leaveEditing],
  );

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Trouble error={state.error} retry={retry} />;
  if (ranking === null) return <Loading />;

  const shown = rows === null ? ranking : { ...ranking, rows };
  const mine = readKept(store, ranking.listId)?.code === ranking.code;
  return (
    <article className="list-page">
      <Body
        ranking={shown}
        mine={mine}
        editing={editing}
        onEdit={() => setChosen(true)}
        edit={{ rows: shown.rows, save, cancel: leaveEditing }}
        store={scratch}
        savedNote={savedAt !== null}
      />
    </article>
  );
}
