import { Link } from "react-router";
import type { ListSummary } from "../api/types";
import { isEditorialAuthor } from "../lib/editorial";
import { plural, strings } from "../strings";
import { Icon } from "./Icon";
import { ListArt } from "./ListArt";
import "./ListCard.css";

interface ListCardProps {
  list: ListSummary;
  /** Why the list is in a Following feed: "In Anime", or the topic followed. */
  reason?: string | null;
}

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

/**
 * The feed's card, as the app draws it: the art, the title on up to two
 * lines, the author's face and name, and how many cards and rankings.
 */
export function ListCard({ list, reason = null }: ListCardProps) {
  // How many people ranked it is not said: a small count makes the place look
  // empty, a big one is noise (Danylo, 01.11.2026). The cards are the list's own.
  const meta = [plural(strings.card.items, list.itemCount)];
  return (
    <article className="list-card">
      <Link className="list-card__main" to={`/l/${encodeURIComponent(list.id)}`}>
        <ListArt
          cover={list.coverImageUrl}
          previews={list.previewImages}
          tierColors={list.tierColors}
        />
        <span className="list-card__text">
          {reason !== null && <span className="list-card__reason">{reason}</span>}
          <span className="list-card__title">{list.title}</span>
        </span>
      </Link>
      <span className="list-card__body">
        {list.anonymous === true ? (
          <span className="list-card__author list-card__author--anonymous">
            <span className="list-card__face list-card__face--anonymous" aria-hidden="true">
              <Icon name="person" />
            </span>
            <span>{strings.card.anonymous}</span>
          </span>
        ) : (
          // An editorial list stands without an author, the way a template does.
          !isEditorialAuthor(list.authorUid) && (
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
              <span className="list-card__name">{list.authorName}</span>
            </Link>
          )
        )}
        <span className="list-card__meta">{meta.join(" · ")}</span>
      </span>
    </article>
  );
}
