import { useEffect, useSyncExternalStore } from "react";
import { Link, useRouteError } from "react-router";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import "../pages/NotFoundPage.css";

const onConnection = (changed: () => void) => {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
};

/**
 * What a page that threw while drawing leaves behind: words in the person's
 * language and two ways on, instead of the router's own English stack trace.
 */
export function RouteError({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const error = useRouteError();
  // Nothing reports errors anywhere else yet; the console is where they can be read.
  useEffect(() => console.error(error), [error]);
  // Offline, the page that would not come is a page not yet opened in this
  // visit; a reload then would trade the site for the browser's own error
  // page, so Reload waits for the connection.
  const online = useSyncExternalStore(onConnection, () => navigator.onLine);
  return (
    <section className="opening" role="alert">
      <h1 className="opening__title">
        {online ? strings.crash.title : strings.crash.offlineTitle}
      </h1>
      <p className="opening__text">{online ? strings.crash.body : strings.crash.offlineBody}</p>
      <p>
        <Button variant="filled" onClick={reload} disabled={!online}>
          {strings.boot.reload}
        </Button>
      </p>
      <Link to="/">{strings.notFound.home}</Link>
    </section>
  );
}
