import { useId } from "react";
import type { PublishedItem } from "../api/types";
import { strings } from "../strings";

/**
 * The photographers the cards' pictures ask to be named by, one line a card,
 * at the foot of a list or of a ranking of it; nothing where none asks.
 */
export function PictureCredits({ items }: { items: readonly PublishedItem[] }) {
  const id = useId();
  const credited = items.flatMap((item) =>
    typeof item.credit === "string" && item.credit.trim() !== ""
      ? [{ title: item.title, credit: item.credit.trim() }]
      : [],
  );
  if (credited.length === 0) return null;
  return (
    <section className="list-credits" aria-labelledby={id}>
      <h2 id={id} className="list-credits__title">
        {strings.list.pictureCredits}
      </h2>
      <ul className="list-credits__lines">
        {credited.map((one, index) => (
          <li key={index}>
            {one.title.trim() === "" ? one.credit : `${one.title} — ${one.credit}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
