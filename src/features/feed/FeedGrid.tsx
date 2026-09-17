import type { ListSummary } from "../../api/types";
import { plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { ListCard } from "../../ui/ListCard";
import { Skeleton } from "../../ui/Skeleton";
import { isOutOfSight } from "../community/hidden";
import { useHidden } from "../community/useHidden";
import type { FeedState } from "./useFeed";
import "../community/report.css";
import "./feed.css";

interface FeedGridProps {
  state: FeedState;
  label: string;
  retry: () => void;
  more: () => void;
  /** Whether further pages are offered under the grid. */
  paged?: boolean;
  /** Say how many hidden lists were left out, as search results do. */
  hiddenNote?: boolean;
}

type Slot = { kind: "card"; list: ListSummary } | { kind: "hidden"; list: ListSummary };

const PLACEHOLDERS = [0, 1, 2, 3, 4, 5, 6, 7];

export function FeedGrid({
  state,
  label,
  retry,
  more,
  paged = true,
  hiddenNote = false,
}: FeedGridProps) {
  const { hidden, hiddenThisVisit, showList } = useHidden();
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

  // A card hidden during this visit keeps its place with a way back, so the
  // grid does not jump and the undo stays reachable; one hidden earlier is
  // simply not here.
  const slots: Slot[] = [];
  for (const list of state.lists) {
    if (hiddenThisVisit.includes(list.id)) slots.push({ kind: "hidden", list });
    else if (!isOutOfSight(hidden, list)) slots.push({ kind: "card", list });
  }
  const omitted = state.lists.length - slots.length;
  if (slots.every((slot) => slot.kind === "hidden") && slots.length === 0) {
    return <p className="feed__empty">{strings.feed.allHidden}</p>;
  }

  return (
    <>
      {hiddenNote && omitted > 0 && (
        <p className="feed__omitted">{plural(strings.feed.omitted, omitted)}</p>
      )}
      <ul className="feed" aria-label={label}>
        {slots.map(({ kind, list }) => (
          <li key={list.id}>
            {kind === "card" ? (
              <ListCard list={list} />
            ) : (
              <div className="feed__hidden" role="status">
                <Icon name="visibility_off" />
                <span>{strings.feed.hiddenTile}</span>
                <button type="button" className="btn btn--text" onClick={() => showList(list.id)}>
                  <span>{strings.feed.undo}</span>
                </button>
              </div>
            )}
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
