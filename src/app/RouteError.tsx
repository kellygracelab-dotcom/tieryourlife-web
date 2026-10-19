import { useEffect } from "react";
import { Link, useRouteError } from "react-router";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import "../pages/Placeholders.css";

/**
 * What a page that threw while drawing leaves behind: words in the person's
 * language and two ways on, instead of the router's own English stack trace.
 */
export function RouteError({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const error = useRouteError();
  // Nothing reports errors anywhere else yet; the console is where they can be read.
  useEffect(() => console.error(error), [error]);
  return (
    <section className="opening" role="alert">
      <h1 className="opening__title">{strings.crash.title}</h1>
      <p className="opening__text">{strings.crash.body}</p>
      <p>
        <Button variant="filled" onClick={reload}>
          {strings.boot.reload}
        </Button>
      </p>
      <Link to="/">{strings.notFound.home}</Link>
    </section>
  );
}
