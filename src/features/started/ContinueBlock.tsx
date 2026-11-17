import { useMemo, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { localStorageStore, type KeyValueStore } from "../../lib/storage";
import { sizedFor } from "../../lib/pictureSize";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import { boards as site } from "../boards/owners";
import type { BoardsRepository } from "../boards/repository";
import { useBoards } from "../boards/useBoards";
import { sectionName } from "../sections/model";
import { sectionsStore, type SectionsStore } from "../sections/useSections";
import { RESUME_GAME, startedLists, type Started } from "./started";
import "./started.css";

/** How far one begun list is: "Anime · 4 of 25 placed", the section left out when unknown. */
function progressText(one: Started, section: string | null): string {
  const counts = { n: one.placed, total: one.total };
  return section === null
    ? fill(strings.started.placed, counts)
    : fill(strings.started.placedIn, { ...counts, section });
}

/**
 * "Continue" at the top of Your lists (audit B1, artboard 14): somebody
 * else's lists begun on this device and not saved to one's own, a card each
 * with its first pictures, its section and how far it is placed, a bar of
 * that, Continue and, when a game is saved, Resume game. The work was safe,
 * and nothing on the site led back to it. Nothing begun, nothing shown.
 */
export function ContinueBlock({
  store = localStorageStore,
  repository = site,
  sections = sectionsStore,
}: {
  store?: KeyValueStore;
  repository?: BoardsRepository;
  sections?: SectionsStore;
}) {
  const boards = useBoards(repository);
  // The names as last known here; the nine stand in until the backend answered.
  const known = useSyncExternalStore(sections.subscribe, sections.get, sections.get).sections;
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
        {fill(strings.started.count, { n: started.length })}
      </h2>
      <ul className="started__list">
        {started.map((one) => {
          const path = `/l/${encodeURIComponent(one.listId)}`;
          const section = one.category === null ? null : sectionName(one.category, known);
          const share = one.total === 0 ? 0 : Math.round((one.placed / one.total) * 100);
          return (
            <li key={one.listId} className="started__card">
              <div className="started__top">
                {one.pictures.length === 0 ? (
                  <span className="started__thumb started__thumb--none" aria-hidden="true">
                    <Icon name="leaderboard" />
                  </span>
                ) : (
                  <span className="started__thumbs" aria-hidden="true">
                    {one.pictures.map((url) => (
                      <MediaImage
                        key={url}
                        className="started__thumb"
                        {...sizedFor(url, 96)}
                        alt=""
                      />
                    ))}
                  </span>
                )}
                <span className="started__text">
                  <bdi className="started__name">{one.title}</bdi>
                  <span className="started__meta">{progressText(one, section)}</span>
                </span>
              </div>
              <span className="started__bar" aria-hidden="true">
                <span className="started__fill" style={{ inlineSize: `${share}%` }} />
              </span>
              <span className="started__actions">
                <Link
                  className="btn btn--filled started__go"
                  to={path}
                  aria-label={fill(strings.started.continueOf, { title: one.title })}
                >
                  <span>{strings.started.continue}</span>
                </Link>
                {one.game && (
                  <Link className="btn btn--outlined started__go" to={path} state={RESUME_GAME}>
                    <span>{strings.started.resume}</span>
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
