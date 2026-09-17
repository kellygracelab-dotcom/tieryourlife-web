import { useCallback } from "react";
import { Link } from "react-router";
import type { MyRankings, RankingSummary } from "../api/rank";
import type { ListSummary } from "../api/types";
import { useSession } from "../app/session";
import { useResource } from "../features/list/useResource";
import { loadMyLists, loadMyRankings } from "../lib/api";
import { fill, formatCount, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { ListCard } from "../ui/ListCard";
import { Skeleton } from "../ui/Skeleton";
import "../features/feed/feed.css";
import "./MePage.css";

export type LoadMine = () => Promise<MyRankings>;
export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type MeTab = "rankings" | "lists";

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
      <Link className="me-card__edit" to={`/r/${encodeURIComponent(ranking.code)}?edit`}>
        {strings.me.edit}
      </Link>
    </li>
  );
}

function Placeholders({ label }: { label: string }) {
  return (
    <div className="me__list me__list--loading" aria-busy="true" aria-label={label}>
      <Skeleton height="100px" className="me__placeholder" />
      <Skeleton height="100px" className="me__placeholder" />
      <Skeleton height="100px" className="me__placeholder" />
    </div>
  );
}

function Failed({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="me__trouble" role="alert">
      <p className="me__text">{text}</p>
      <Button variant="filled" icon="refresh" onClick={retry}>
        {strings.me.tryAgain}
      </Button>
    </div>
  );
}

function Rankings({ uid, load }: { uid: string; load: LoadMine }) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);

  if (state.status === "loading") return <Placeholders label={strings.me.title} />;
  if (state.status === "error") return <Failed text={strings.me.failed} retry={retry} />;
  const { rankings, more } = state.value;
  if (rankings.length === 0) {
    return (
      <>
        <p className="me__text">{strings.me.empty}</p>
        <div>
          <Button variant="filled" href="/">
            {strings.me.browse}
          </Button>
        </div>
        <p className="me__note">{strings.me.fromPhone}</p>
      </>
    );
  }
  return (
    <>
      <p className="me__count">{plural(strings.me.kept, rankings.length)}</p>
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

function Lists({ uid, load }: { uid: string; load: LoadLists }) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);

  if (state.status === "loading") return <Placeholders label={strings.me.lists} />;
  if (state.status === "error") return <Failed text={strings.me.listsFailed} retry={retry} />;
  const { lists } = state.value;
  if (lists.length === 0) {
    return (
      <>
        <p className="me__text">{strings.me.listsEmpty}</p>
        <p className="me__note">{strings.me.listsHow}</p>
      </>
    );
  }
  return (
    <>
      <p className="me__count">{plural(strings.me.published, lists.length)}</p>
      <ul className="feed" aria-label={strings.me.lists}>
        {lists.map((list) => (
          <li key={list.id}>
            <ListCard list={list} />
          </li>
        ))}
      </ul>
    </>
  );
}

interface MePageProps {
  tab?: MeTab;
  load?: LoadMine;
  loadLists?: LoadLists;
}

export function MePage({
  tab = "rankings",
  load = loadMyRankings,
  loadLists = loadMyLists,
}: MePageProps) {
  const { account, signIn } = useSession();
  const title = tab === "rankings" ? strings.me.title : strings.me.lists;
  return (
    <section className="me">
      <h1 className="me__title">{title}</h1>
      <nav className="me__tabs" aria-label={strings.me.tabs}>
        <Link to="/me" aria-current={tab === "rankings" ? "page" : undefined}>
          {strings.me.title}
        </Link>
        <Link to="/me/lists" aria-current={tab === "lists" ? "page" : undefined}>
          {strings.me.lists}
        </Link>
      </nav>
      {account === null && <Skeleton height="20px" width="40%" />}
      {account?.kind === "guest" && (
        <>
          <p className="me__text">
            {tab === "rankings" ? strings.me.signInFirst : strings.me.signInForLists}
          </p>
          <div>
            <Button variant="filled" onClick={() => void signIn()}>
              {strings.nav.signIn}
            </Button>
          </div>
        </>
      )}
      {account?.kind === "signedIn" && tab === "rankings" && (
        <Rankings uid={account.uid} load={load} />
      )}
      {account?.kind === "signedIn" && tab === "lists" && (
        <Lists uid={account.uid} load={loadLists} />
      )}
    </section>
  );
}
