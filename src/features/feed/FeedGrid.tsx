import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { ListCard } from "../../ui/ListCard";
import { Skeleton } from "../../ui/Skeleton";
import type { FeedState } from "./useFeed";
import "./feed.css";

interface FeedGridProps {
  state: FeedState;
  label: string;
  retry: () => void;
  more: () => void;
  /** Whether further pages are offered under the grid. */
  paged?: boolean;
}

const PLACEHOLDERS = [0, 1, 2, 3, 4, 5, 6, 7];

export function FeedGrid({ state, label, retry, more, paged = true }: FeedGridProps) {
  if (state.status === "loading") {
    return (
      <div className="feed feed--loading" aria-busy="true" aria-label={label}>
        {PLACEHOLDERS.map((n) => (
          <Skeleton key={n} height="200px" className="feed__placeholder" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="feed__trouble" role="alert">
        <p>{state.error.kind === "offline" ? strings.feed.offline : strings.feed.failed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }

  if (state.lists.length === 0) {
    return <p className="feed__empty">{strings.feed.empty}</p>;
  }

  return (
    <>
      <ul className="feed" aria-label={label}>
        {state.lists.map((list) => (
          <li key={list.id}>
            <ListCard list={list} />
          </li>
        ))}
      </ul>
      {paged && state.next !== null && (
        <div className="feed__more">
          {state.more === "failed" && <p role="alert">{strings.feed.moreFailed}</p>}
          <Button variant="tonal" onClick={more} disabled={state.more === "loading"}>
            {state.more === "loading" ? strings.feed.loadingMore : strings.feed.more}
          </Button>
        </div>
      )}
    </>
  );
}
