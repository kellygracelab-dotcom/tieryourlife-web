import { useCallback } from "react";
import { Link } from "react-router";
import type { MyRankings, RankingSummary } from "../api/rank";
import { useSession } from "../app/session";
import { useResource } from "../features/list/useResource";
import { loadMyRankings } from "../lib/api";
import { fill, formatCount, strings } from "../strings";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import "./MePage.css";

export type LoadMine = () => Promise<MyRankings>;

const dates = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

function RankingCard({ ranking }: { ranking: RankingSummary }) {
  const when = new Date(ranking.createdAt);
  return (
    <li className="me-card">
      <Link className="me-card__link" to={`/r/${encodeURIComponent(ranking.code)}`}>
        {ranking.imageUrl !== null ? (
          <img src={ranking.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="me-card__blank" aria-hidden="true" />
        )}
        <span className="me-card__body">
          <span className="me-card__title">{ranking.title}</span>
          <span className="me-card__meta">
            {fill(strings.card.by, { name: ranking.authorName })} ·{" "}
            {fill(strings.me.placedOf, { placed: ranking.placed, total: ranking.itemCount })}
          </span>
          <time className="me-card__date" dateTime={when.toISOString()}>
            {dates.format(when)}
          </time>
        </span>
      </Link>
    </li>
  );
}

function Rankings({ uid, load }: { uid: string; load: LoadMine }) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);

  if (state.status === "loading") {
    return (
      <div className="me__list me__list--loading" aria-busy="true" aria-label={strings.me.title}>
        <Skeleton height="100px" className="me__placeholder" />
        <Skeleton height="100px" className="me__placeholder" />
        <Skeleton height="100px" className="me__placeholder" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="me__trouble" role="alert">
        <p className="me__text">{strings.me.failed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.me.tryAgain}
        </Button>
      </div>
    );
  }
  const { rankings, more } = state.value;
  if (rankings.length === 0) return <p className="me__text">{strings.me.empty}</p>;
  return (
    <>
      <ul className="me__list" aria-label={strings.me.title}>
        {rankings.map((ranking) => (
          <RankingCard key={ranking.code} ranking={ranking} />
        ))}
      </ul>
      {more && (
        <p className="me__more">{fill(strings.me.more, { n: formatCount(rankings.length) })}</p>
      )}
    </>
  );
}

export function MePage({ load = loadMyRankings }: { load?: LoadMine }) {
  const { account, signIn } = useSession();
  return (
    <section className="me">
      <h1 className="me__title">{strings.me.title}</h1>
      {account === null && <Skeleton height="20px" width="40%" />}
      {account?.kind === "guest" && (
        <>
          <p className="me__text">{strings.me.signInFirst}</p>
          <div>
            <Button variant="filled" onClick={() => void signIn()}>
              {strings.nav.signIn}
            </Button>
          </div>
        </>
      )}
      {account?.kind === "signedIn" && <Rankings uid={account.uid} load={load} />}
    </section>
  );
}
