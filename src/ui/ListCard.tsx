import { Link } from "react-router";
import type { ListSummary } from "../api/types";
import { isEditorialAuthor } from "../lib/editorial";
import { titleIn } from "../lib/translated";
import { currentLocale, plural, strings } from "../strings";
import { Icon } from "./Icon";
import { ListArt } from "./ListArt";
import { initialOf } from "../lib/initial";
import "./ListCard.css";

interface ListCardProps {
  list: ListSummary;
  /** Why the list is in a Following feed: "In Anime", or the topic followed. */
  reason?: string | null;
  /** The one signed in, when the list is theirs, named or not. */
  yours?: Yours | null;
  /** Left out on the author's own page, where every card would name the page it is on. */
  showAuthor?: boolean;
}

/** One's own face, the one this device knows, which a new face reaches first. */
export interface Yours {
  uid: string;
  name: string | null;
  photoUrl: string | null;
}

function Face({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  if (photoUrl !== null)
    return <img className="list-card__face" src={photoUrl} alt="" loading="lazy" />;
  if (name === null || name.trim() === "")
    return (
      <span className="list-card__face list-card__face--initial" aria-hidden="true">
        <Icon name="person" />
      </span>
    );
  return (
    <span className="list-card__face list-card__face--initial" aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

/**
 * The feed's card, as the app draws it: the art, the title in a block two
 * lines tall, and a footer row with the author's face and name at the start
 * and how many cards at the end. Every card keeps its rows at the same heights,
 * so a row of cards reads as one line (Claude Design, 03.11.2026).
 *
 * Whose it is shows at a glance (Danylo, 02.11.2026): one's own lists wear
 * one's own face and say so, anonymous or not; somebody else's anonymous list
 * names nobody and shows no empty face; a named one names its author.
 */
export function ListCard({ list, reason = null, yours = null, showAuthor = true }: ListCardProps) {
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
          decorative
        />
        <span className="list-card__text">
          {reason !== null && <span className="list-card__reason">{reason}</span>}
          <bdi className="list-card__title">{titleIn(list, currentLocale())}</bdi>
        </span>
      </Link>
      <span className="list-card__body">
        {!showAuthor ? null : yours !== null ? (
          list.anonymous === true ? (
            // Said with a closed eye, not in words: the row stays one short line.
            <span className="list-card__author list-card__author--own">
              <Face name={yours.name} photoUrl={yours.photoUrl} />
              <span className="list-card__name" aria-hidden="true">
                {strings.card.yours}
              </span>
              <Icon name="visibility_off" className="list-card__hidden" />
              <span className="visually-hidden">{strings.card.yoursAnonymous}</span>
            </span>
          ) : (
            <Link
              className="list-card__author list-card__author--own"
              to={`/u/${encodeURIComponent(yours.uid)}`}
              state={{ author: { name: list.authorName, photoUrl: list.authorPhotoUrl } }}
            >
              <Face name={yours.name} photoUrl={yours.photoUrl} />
              <span className="list-card__name">{strings.card.yours}</span>
            </Link>
          )
        ) : (
          // Somebody else's anonymous list, or an editorial one, stands without
          // an author, the way a template does: no name, no empty face.
          list.anonymous !== true &&
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
              <bdi className="list-card__name">{list.authorName}</bdi>
            </Link>
          )
        )}
        <span className="list-card__count">{meta.join(" · ")}</span>
      </span>
    </article>
  );
}
