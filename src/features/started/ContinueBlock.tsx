import { useMemo } from "react";
import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { localStorageStore, type KeyValueStore } from "../../lib/storage";
import { sizedFor } from "../../lib/pictureSize";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import { boards as site } from "../boards/owners";
import type { BoardsRepository } from "../boards/repository";
import { useBoards } from "../boards/useBoards";
import { RESUME_GAME, startedLists } from "./started";
import "./started.css";

/**
 * "Continue": somebody else's lists begun on this device, with how far each
 * is placed, Continue, and Resume game when a game is saved (audit B1). The
 * work was safe, and nothing on the site led back to it. Nothing begun, nothing shown.
 */
export function ContinueBlock({
  store = localStorageStore,
  repository = site,
}: {
  store?: KeyValueStore;
  repository?: BoardsRepository;
}) {
  const boards = useBoards(repository);
  const started = useMemo(() => {
    const saved = new Set(
      boards.flatMap((board) =>
        board.takenFrom !== null && board.deletedAt === null ? [board.takenFrom] : [],
      ),
    );
    return startedLists(store, saved);
  }, [boards, store]);
  if (started.length === 0) return null;
  return (
    <section className="started" aria-labelledby="started-title">
      <h2 id="started-title" className="started__title">
        {strings.started.title}
      </h2>
      <ul className="started__list">
        {started.map((one) => {
          const path = `/l/${encodeURIComponent(one.listId)}`;
          return (
            <li key={one.listId} className="started__row">
              {one.picture === null ? (
                <span className="started__thumb started__thumb--none" aria-hidden="true">
                  <Icon name="leaderboard" />
                </span>
              ) : (
                <MediaImage className="started__thumb" {...sizedFor(one.picture, 96)} alt="" />
              )}
              <span className="started__text">
                <bdi className="started__name">{one.title}</bdi>
                <span className="started__meta">
                  {fill(strings.started.placed, { n: one.placed, total: one.total })}
                </span>
              </span>
              <span className="started__actions">
                {one.game && (
                  <Link className="btn btn--text" to={path} state={RESUME_GAME}>
                    <Icon name="play_arrow" className="btn__icon" />
                    <span>{strings.started.resume}</span>
                  </Link>
                )}
                <Link
                  className="btn btn--tonal"
                  to={path}
                  aria-label={fill(strings.started.continueOf, { title: one.title })}
                >
                  <span>{strings.started.continue}</span>
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
