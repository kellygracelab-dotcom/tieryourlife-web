import { useEffect, useRef } from "react";
import type { ListSummary } from "../../api/types";
import { titleIn } from "../../lib/translated";
import { currentLocale, fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { ListCard } from "../../ui/ListCard";
import { Menu } from "../../ui/Menu";
import { Skeleton } from "../../ui/Skeleton";
import { isOutOfSight } from "../community/hidden";
import { useHidden } from "../community/useHidden";
import type { FeedState } from "./useFeed";
import { useYours } from "./yours";
import "../community/report.css";
import "./feed.css";

interface FeedGridProps {
  state: FeedState;
  label: string;
  retry: () => void;
  more: () => void;
  /** Say how many hidden lists were left out, as search results do. */
  hiddenNote?: boolean;
  /** Why a list is there, for a Following feed. */
  reasonOf?: (list: ListSummary) => string | null;
  /** Whether each card names its author; not on the author's own page. */
  showAuthor?: boolean;
  /**
   * Given, each card offers Hide and Report, as the app's long press on an
   * author's page does; this reports the list.
   */
  onReport?: (list: ListSummary) => void;
}

type Slot = { kind: "card"; list: ListSummary } | { kind: "hidden"; list: ListSummary };

const PLACEHOLDERS = [0, 1, 2, 3, 4, 5];

/** A card still on its way: the same boxes, flat, breathing with the rest. */
function CardPlaceholder() {
  return (
    <div className="list-card list-card--placeholder">
      <Skeleton height="var(--card-cover)" className="list-card__cover-placeholder" />
      <span className="list-card__text list-card__text--placeholder">
        <Skeleton width="85%" height="13px" />
        <Skeleton width="55%" height="13px" />
      </span>
      <span className="list-card__body">
        <span className="list-card__author">
          <Skeleton width="20px" height="20px" className="list-card__face" />
          <Skeleton width="56px" height="10px" />
        </span>
        <Skeleton width="44px" height="10px" className="list-card__count" />
      </span>
    </div>
  );
}

export function FeedGrid({
  state,
  label,
  retry,
  more,
  hiddenNote = false,
  reasonOf,
  showAuthor = true,
  onReport,
}: FeedGridProps) {
  const { hidden, hiddenThisVisit, hideList, showList } = useHidden();
  const yours = useYours();
  // A card hidden from its own menu becomes the tile with Undo, which takes
  // the focus the menu's button had: the button is gone with the card.
  const grid = useRef<HTMLUListElement>(null);
  const justHid = useRef<string | null>(null);
  useEffect(() => {
    const id = justHid.current;
    if (id === null || !hiddenThisVisit.includes(id)) return;
    justHid.current = null;
    grid.current
      ?.querySelector<HTMLElement>(`[data-list="${CSS.escape(id)}"] .feed__hidden button`)
      ?.focus();
  }, [hiddenThisVisit]);
  if (state.status === "loading") {
    return (
      <div className="feed feed--loading" aria-busy="true" aria-label={label}>
        {PLACEHOLDERS.map((n) => (
          <CardPlaceholder key={n} />
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
    return (
      <div className="feed__empty">
        <p className="feed__empty-title">{strings.feed.empty}</p>
        <p className="feed__empty-body">{strings.feed.emptyBody}</p>
      </div>
    );
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

  return (
    <>
      {state.stale === true && (
        <div className="feed__stale" role="status">
          <Icon name="cloud_off" />
          <p>{strings.feed.stale}</p>
          <Button variant="text" onClick={retry}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      )}
      {/* Everything on this page is hidden; the pages after it may not be. */}
      {slots.length === 0 && <p className="feed__empty">{strings.feed.allHidden}</p>}
      {hiddenNote && omitted > 0 && slots.length > 0 && (
        <p className="feed__omitted">{plural(strings.feed.omitted, omitted)}</p>
      )}
      {slots.length > 0 && (
        <ul className="feed" aria-label={label} ref={grid}>
          {slots.map(({ kind, list }) => (
            <li key={list.id} data-list={list.id}>
              {kind === "card" ? (
                <ListCard
                  list={list}
                  reason={reasonOf?.(list) ?? null}
                  yours={yours(list)}
                  showAuthor={showAuthor}
                  menu={
                    onReport !== undefined && (
                      <Menu
                        label={fill(strings.feed.cardMore, {
                          title: titleIn(list, currentLocale()),
                        })}
                        button={<Icon name="more_vert" />}
                        buttonClassName="menu__button list-card__menu"
                      >
                        <li>
                          <button
                            type="button"
                            className="menu__action"
                            onClick={() => {
                              justHid.current = list.id;
                              hideList({ id: list.id, title: list.title });
                            }}
                          >
                            {strings.list.hide}
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            className="menu__action menu__action--danger"
                            aria-haspopup="dialog"
                            onClick={() => onReport(list)}
                          >
                            {strings.list.report}
                          </button>
                        </li>
                      </Menu>
                    )
                  }
                />
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
      )}
      {state.next !== null && (
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
