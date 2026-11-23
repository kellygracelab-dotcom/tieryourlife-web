import { useEffect, useState } from "react";
import type { ListSummary } from "../../api/types";
import { strings } from "../../strings";
import { ListCard } from "../../ui/ListCard";
import { isOutOfSight } from "../community/hidden";
import { useHidden } from "../community/useHidden";
import { useYours } from "./yours";
import "./feed.css";

export type LoadFresh = () => Promise<ListSummary[]>;

/** Fewer than this and the row is not there at all (the coordinator, 23.11). */
export const FRESH_AT_LEAST = 2;

/**
 * "New from the community" over Popular on Explore (Marketing's decision,
 * 23.11): people's newest lists, the server's pick, in one row that scrolls
 * across, each card naming its author. Nothing shows while it loads, when it
 * fails, or with fewer than two lists: no empty row, no placeholder words.
 */
export function FreshRow({ load }: { load: LoadFresh }) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const { hidden } = useHidden();
  const yours = useYours();
  useEffect(() => {
    let current = true;
    load().then(
      (found) => current && setLists(found),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [load]);
  const shown = (lists ?? []).filter((list) => !isOutOfSight(hidden, list));
  if (shown.length < FRESH_AT_LEAST) return null;
  return (
    <section className="home__fresh" aria-labelledby="fresh">
      <div className="home__heading">
        <h2 id="fresh">{strings.home.fresh}</h2>
        <p>{strings.home.freshNote}</p>
      </div>
      <ul className="fresh" aria-label={strings.home.fresh}>
        {shown.map((list) => (
          <li key={list.id}>
            <ListCard list={list} yours={yours(list)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
