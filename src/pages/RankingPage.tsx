import { useState } from "react";
import { Link, useParams } from "react-router";
import type { ApiError } from "../api/errors";
import type { Ranking } from "../api/rank";
import { arrange, poolOf } from "../features/board/arrange";
import { localStorageStore, type DraftStore } from "../features/board/draft";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { readKept } from "../features/ranking/kept";
import { useRanking, type LoadRanking } from "../features/ranking/useRanking";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import "./ListPage.css";

interface RankingPageProps {
  load?: LoadRanking;
  store?: DraftStore;
}

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
  if (error.kind === "notFound" || error.kind === "unavailable") {
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

function Body({ ranking, mine }: { ranking: Ranking; mine: boolean }) {
  const [view, setView] = useState<View>("visitor");
  const { snapshot } = ranking;
  const author = arrange(snapshot);
  const visitorLabel = mine ? strings.rank.yours : strings.ranking.visitors;
  return (
    <>
      <header className="list-head">
        <div className="list-head__text">
          <h1 className="list-head__title">{snapshot.title}</h1>
          <p className="list-head__meta">
            {fill(strings.list.by, { name: snapshot.authorName })}
            {" · "}
            {mine ? strings.ranking.byYou : strings.ranking.byVisitor}
          </p>
        </div>
        <span className="list-head__address">
          <Icon name="link" />
          {`${window.location.host}/r/${ranking.code}`}
        </span>
      </header>
      <div className="list-page__views" role="group" aria-label={strings.list.views}>
        <Chip selected={view === "visitor"} onClick={() => setView("visitor")}>
          {visitorLabel}
        </Chip>
        {author.known && (
          <Chip selected={view === "author"} onClick={() => setView("author")}>
            {strings.board.authorsVersion}
          </Chip>
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
  );
}

export function RankingPage({ load, store = localStorageStore }: RankingPageProps) {
  const { code = "" } = useParams();
  const { state, retry } = useRanking(code, load);

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Trouble error={state.error} retry={retry} />;

  const ranking = state.value;
  const mine = readKept(store, ranking.listId)?.code === ranking.code;
  return (
    <article className="list-page">
      <Body ranking={ranking} mine={mine} />
    </article>
  );
}
