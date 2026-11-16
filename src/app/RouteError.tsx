import { useEffect, useSyncExternalStore } from "react";
import { Link, useRouteError } from "react-router";
import { isChunkFailure, newerRelease } from "../lib/freshChunk";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import "./RouteError.css";

const onConnection = (changed: () => void) => {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
};

/** Five tier rows, S to D, settling in: the site has moved on, nothing broke. */
function NewVersionMark() {
  return (
    <div className="reload-notice__bars" aria-hidden="true">
      <span className="reload-notice__bar" />
      <span className="reload-notice__bar" />
      <span className="reload-notice__bar" />
      <span className="reload-notice__bar" />
      <span className="reload-notice__bar" />
    </div>
  );
}

/** An S row with one card fallen out of it. */
function FallenCard() {
  return (
    <div className="reload-notice__fallen" aria-hidden="true">
      <div className="reload-notice__row">
        <span className="reload-notice__tier">S</span>
        <span className="reload-notice__cards">
          <span className="reload-notice__card" />
          <span className="reload-notice__card" />
        </span>
      </div>
      <span className="reload-notice__loose">!</span>
    </div>
  );
}

/**
 * Reload, or offline the word that the page waits for the connection: a
 * reload then would trade the site for the browser's own error page.
 */
function ReloadOrWait({ online, reload }: { online: boolean; reload: () => void }) {
  if (!online) {
    return (
      <span className="reload-notice__waiting" role="status">
        <span className="reload-notice__dot" aria-hidden="true" />
        {strings.crash.waiting}
      </span>
    );
  }
  return (
    <Button variant="filled" icon="refresh" className="reload-notice__reload" onClick={reload}>
      {strings.boot.reload}
    </Button>
  );
}

/**
 * What a page that threw while drawing leaves behind: words in the person's
 * language and the ways on, instead of the router's own English stack trace.
 *
 * Most often nothing broke: the site was updated while the tab was open, the
 * page's piece is gone with the old release, and freshChunk could not reload
 * the tab quietly (it did once for this release already, or nothing can be
 * kept to remember it by). That is said calmly as a new version, not as an
 * error (Danylo, 16.11.2026).
 */
export function RouteError({
  reload = () => window.location.reload(),
  newer = newerRelease,
}: {
  reload?: () => void;
  /** Whether the site's front page has named a newer release than this tab's. */
  newer?: () => boolean;
}) {
  const error = useRouteError();
  const outdated = isChunkFailure(error) && newer();
  // Nothing reports errors anywhere else yet; the console is where they can be read.
  useEffect(() => console.error(error), [error]);
  const online = useSyncExternalStore(onConnection, () => navigator.onLine);

  if (outdated) {
    return (
      <section className="reload-notice" role="status">
        <NewVersionMark />
        <h1 className="reload-notice__title">{strings.crash.newTitle}</h1>
        <p className="reload-notice__text">{strings.crash.newBody}</p>
        <div className="reload-notice__actions">
          <ReloadOrWait online={online} reload={reload} />
        </div>
      </section>
    );
  }
  return (
    <section className="reload-notice" role="alert">
      <FallenCard />
      <h1 className="reload-notice__title">
        {online ? strings.crash.title : strings.crash.offlineTitle}
      </h1>
      <p className="reload-notice__text">
        {online ? strings.crash.body : strings.crash.offlineBody}
      </p>
      <div className="reload-notice__actions">
        <Link to="/" className="reload-notice__home">
          {strings.notFound.home}
        </Link>
        <ReloadOrWait online={online} reload={reload} />
      </div>
    </section>
  );
}
