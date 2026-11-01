import type { SearchMiss } from "../../api/admin";
import { loadSearchMisses } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { agoText } from "../moderation/queue";
import { PaneLoading } from "./PaneLoading";

/**
 * What people typed into search and found nothing for, in sections, topics or
 * lists: the most asked first, as the backend counts them. A topic or a house
 * list nobody has made yet is often one of these.
 */
export function SearchesPane({
  load = loadSearchMisses,
  now = Date.now,
}: {
  load?: () => Promise<SearchMiss[]>;
  now?: () => number;
}) {
  const { state, retry } = useResource("search-misses", load);
  return (
    <section className="admin-pane" aria-labelledby="admin-searches">
      <header className="admin-pane__head">
        <h2 id="admin-searches" className="admin-pane__title">
          {strings.admin.searches}
        </h2>
        <p className="admin-pane__count">{strings.admin.searchesBody}</p>
      </header>
      {state.status === "loading" ? (
        <PaneLoading />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{strings.admin.failed}</p>
          <Button variant="tonal" icon="refresh" onClick={retry}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : state.value.length === 0 ? (
        <p className="admin-pane__note">{strings.admin.searchesNone}</p>
      ) : (
        <ul className="admin-topics">
          {state.value.map((miss) => (
            <li key={miss.q} className="admin-topics__row">
              <span className="admin-topics__text">
                <span className="admin-topics__name">{miss.q}</span>
                <span className="admin-topics__meta">
                  {[
                    plural(strings.admin.searchedTimes, miss.count),
                    agoText(miss.lastAt, now()),
                  ].join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
