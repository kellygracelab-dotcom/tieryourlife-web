import type { ApiError } from "../api/errors";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import "./ListPage.css";

/** The shape of a board page while it opens: a title, a byline, a few empty rows. */
export function BoardPageLoading({ note, rows }: { note: string; rows: number }) {
  return (
    <div className="list-page" aria-busy="true">
      <Skeleton height="28px" width="60%" />
      <Skeleton height="18px" width="40%" />
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} height="106px" className="list-page__row" />
      ))}
      <p className="list-page__status">{note}</p>
    </div>
  );
}

/** What a list's page or a ranking's says when it could not open; only the words for "gone" differ. */
export interface TroubleWords {
  unavailableTitle: string;
  unavailableBody: string;
  failedTitle: string;
}

/**
 * Gone, an install the backend does not trust, offline, or anything else.
 * Only the last two offer Try again: asking again does not bring back what
 * is gone or make an install trusted.
 */
export function BoardPageTrouble({
  error,
  retry,
  words,
}: {
  error: ApiError;
  retry: () => void;
  words: TroubleWords;
}) {
  if (error.kind === "notFound") {
    return (
      <section className="list-page list-page--trouble">
        <h1>{words.unavailableTitle}</h1>
        <p>{words.unavailableBody}</p>
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
      <h1>{offline ? strings.list.offlineTitle : words.failedTitle}</h1>
      <p>{offline ? strings.list.offlineBody : strings.list.failedBody}</p>
      <Button variant="filled" icon="refresh" onClick={retry}>
        {strings.list.tryAgain}
      </Button>
    </section>
  );
}
