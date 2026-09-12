import { Link } from "react-router";
import type { ListSummary } from "../api/types";
import { fill, plural, strings } from "../strings";
import { ListArt } from "./ListArt";
import "./ListCard.css";

interface ListCardProps {
  list: ListSummary;
}

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

export function ListCard({ list }: ListCardProps) {
  const meta = [
    plural(strings.card.items, list.itemCount),
    plural(strings.card.rankings, list.takeCount),
  ];
  return (
    <Link className="list-card" to={`/l/${encodeURIComponent(list.id)}`}>
      <ListArt
        cover={list.coverImageUrl}
        previews={list.previewImages}
        tierColors={list.tierColors}
      />
      <span className="list-card__body">
        <span className="list-card__title">{list.title}</span>
        <span className="list-card__author">
          {list.authorPhotoUrl !== null ? (
            <img className="list-card__face" src={list.authorPhotoUrl} alt="" loading="lazy" />
          ) : (
            <span className="list-card__face list-card__face--initial" aria-hidden="true">
              {initialOf(list.authorName)}
            </span>
          )}
          <span>{fill(strings.card.by, { name: list.authorName })}</span>
        </span>
        <span className="list-card__meta">{meta.join(" · ")}</span>
      </span>
    </Link>
  );
}
