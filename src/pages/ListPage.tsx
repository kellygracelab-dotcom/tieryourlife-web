import { Link, useParams } from "react-router";
import type { ApiError } from "../api/errors";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { useList } from "../features/list/useList";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import "./ListPage.css";

function Loading() {
  return (
    <div className="list-page" aria-busy="true">
      <Skeleton height="28px" width="60%" />
      <Skeleton height="18px" width="40%" />
      <Skeleton height="106px" className="list-page__row" />
      <Skeleton height="106px" className="list-page__row" />
      <Skeleton height="106px" className="list-page__row" />
      <p className="list-page__status">{strings.list.opening}</p>
    </div>
  );
}

function Trouble({ error, retry }: { error: ApiError; retry: () => void }) {
  const gone = error.kind === "notFound" || error.kind === "unavailable";
  if (gone) {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.list.unavailableTitle}</h1>
        <p>{strings.list.unavailableBody}</p>
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
      <h1>{offline ? strings.list.offlineTitle : strings.list.failedTitle}</h1>
      <p>{offline ? strings.list.offlineBody : strings.list.failedBody}</p>
      <Button variant="filled" icon="refresh" onClick={retry}>
        {strings.list.tryAgain}
      </Button>
    </section>
  );
}

export function ListPage() {
  const { id = "" } = useParams();
  const { state, retry } = useList(id);

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Trouble error={state.error} retry={retry} />;

  const { list } = state;
  const address = `${window.location.host}/l/${id}`;
  return (
    <article className="list-page">
      <header className="list-head">
        <div className="list-head__text">
          <h1 className="list-head__title">{list.title}</h1>
          <p className="list-head__meta">
            {fill(strings.list.by, { name: list.authorName })}
            {" · "}
            {plural(strings.card.items, list.itemCount)}
            {" · "}
            {plural(strings.card.rankings, list.takeCount)}
          </p>
        </div>
        <span className="list-head__address">
          <Icon name="link" />
          {address}
        </span>
      </header>
      <p className="list-page__status">{strings.board.authorsVersion}</p>
      <ReadOnlyBoard list={list} />
      <p className="list-page__foot">
        <Link to="/">{strings.list.home}</Link>
      </p>
    </article>
  );
}
