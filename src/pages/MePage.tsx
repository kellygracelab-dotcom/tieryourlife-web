import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { ApiError } from "../api/errors";
import type { MyRankings, RankingSummary } from "../api/rank";
import type { ListSummary } from "../api/types";
import { AccountTabs } from "../app/AccountTabs";
import { useSession } from "../app/session";
import { errorOf, useResource } from "../features/list/useResource";
import { loadMyLists, loadMyRankings, unpublish as unpublishList } from "../lib/api";
import { fill, formatCount, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { ListCard } from "../ui/ListCard";
import { Skeleton } from "../ui/Skeleton";
import "../features/feed/feed.css";
import "./MePage.css";

export type LoadMine = () => Promise<MyRankings>;
export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Unpublish = (id: string) => Promise<void>;
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

type Unpublishing =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "busy" }
  | { status: "failed"; error: ApiError };

/**
 * The feed's card with the one thing the site can do to a list from here.
 * The question sits in the card rather than in a modal: it is one list, and
 * the answer is a click away either way.
 */
function PublishedCard({
  list,
  unpublish,
  onGone,
}: {
  list: ListSummary;
  unpublish: Unpublish;
  onGone: (id: string) => void;
}) {
  const [state, setState] = useState<Unpublishing>({ status: "idle" });

  const confirm = () => {
    setState({ status: "busy" });
    unpublish(list.id).then(
      () => onGone(list.id),
      (reason: unknown) => {
        const error = errorOf(reason);
        // Already gone is what was asked for.
        if (error.kind === "notFound") onGone(list.id);
        else setState({ status: "failed", error });
      },
    );
  };

  return (
    <li className="me-list">
      <ListCard list={list} />
      {state.status === "asking" ? (
        <div className="me-list__ask" role="group" aria-label={strings.me.remove}>
          <p className="me-list__question">{fill(strings.me.removeAsk, { title: list.title })}</p>
          <div className="me-list__answers">
            <Button variant="filled" onClick={confirm}>
              {strings.me.remove}
            </Button>
            <Button onClick={() => setState({ status: "idle" })}>{strings.me.keepIt}</Button>
          </div>
        </div>
      ) : (
        <div className="me-list__actions">
          {state.status === "failed" && (
            <p className="me-list__error" role="alert">
              {state.error.kind === "offline" ? strings.me.removeOffline : strings.me.removeFailed}
            </p>
          )}
          <Link className="btn btn--text" to={`/new?list=${encodeURIComponent(list.id)}`}>
            <Icon name="edit" className="btn__icon" />
            <span>{strings.me.edit}</span>
          </Link>
          <Button
            icon="delete"
            onClick={() => setState({ status: "asking" })}
            disabled={state.status === "busy"}
          >
            {state.status === "busy" ? strings.me.removing : strings.me.remove}
          </Button>
        </div>
      )}
    </li>
  );
}

function Lists({ uid, load, unpublish }: { uid: string; load: LoadLists; unpublish: Unpublish }) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);
  const [gone, setGone] = useState<readonly string[]>([]);

  if (state.status === "loading") return <Placeholders label={strings.me.lists} />;
  if (state.status === "error") return <Failed text={strings.me.listsFailed} retry={retry} />;
  const lists = state.value.lists.filter((list) => !gone.includes(list.id));
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
          <PublishedCard
            key={list.id}
            list={list}
            unpublish={unpublish}
            onGone={(id) => setGone((ids) => [...ids, id])}
          />
        ))}
      </ul>
    </>
  );
}

interface MePageProps {
  tab?: MeTab;
  load?: LoadMine;
  loadLists?: LoadLists;
  unpublish?: Unpublish;
}

export function MePage({
  tab = "rankings",
  load = loadMyRankings,
  loadLists = loadMyLists,
  unpublish = unpublishList,
}: MePageProps) {
  const { account, signIn } = useSession();
  const title = tab === "rankings" ? strings.me.title : strings.me.lists;
  return (
    <section className="me">
      <h1 className="me__title">{title}</h1>
      <AccountTabs current={tab} />
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
        <Lists uid={account.uid} load={loadLists} unpublish={unpublish} />
      )}
    </section>
  );
}
