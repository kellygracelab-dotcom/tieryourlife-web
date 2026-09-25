import { Link } from "react-router";
import type { ListSummary } from "../api/types";
import { fill, plural, strings } from "../strings";
import { ListArt } from "./ListArt";
import "./ListCard.css";

interface ListCardProps {
  list: ListSummary;
}

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

/** The feed's card: the list under the picture and the title, the author under their name. */
export function ListCard({ list }: ListCardProps) {
  // A count of nobody says nothing: the app shows the rankings only once there are some.
  const meta = [
    plural(strings.card.items, list.itemCount),
    ...(list.takeCount > 0 ? [plural(strings.card.rankings, list.takeCount)] : []),
  ];
  return (
    <article className="list-card">
      <Link className="list-card__main" to={`/l/${encodeURIComponent(list.id)}`}>
        <ListArt
          cover={list.coverImageUrl}
          previews={list.previewImages}
          tierColors={list.tierColors}
          title={list.title}
        />
        <span className="list-card__title">{list.title}</span>
      </Link>
      <span className="list-card__body">
        <Link
          className="list-card__author"
          to={`/u/${encodeURIComponent(list.authorUid)}`}
          state={{ author: { name: list.authorName, photoUrl: list.authorPhotoUrl } }}
        >
          {list.authorPhotoUrl !== null ? (
            <img className="list-card__face" src={list.authorPhotoUrl} alt="" loading="lazy" />
          ) : (
            <span className="list-card__face list-card__face--initial" aria-hidden="true">
              {initialOf(list.authorName)}
            </span>
          )}
          <span>{fill(strings.card.by, { name: list.authorName })}</span>
        </Link>
        <span className="list-card__meta">{meta.join(" · ")}</span>
      </span>
    </article>
  );
}
