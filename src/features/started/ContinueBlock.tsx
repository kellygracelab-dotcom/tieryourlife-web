import { useCallback, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { fill, strings } from "../../strings";
import { localStorageStore, type KeyValueStore } from "../../lib/storage";
import { sizedFor } from "../../lib/pictureSize";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { MoreButton } from "../boards/BoardTile";
import { ListMenu } from "../boards/ListMenu";
import { useMenuTriggers } from "../boards/listMenuTriggers";
import type { ScreenPoint } from "../tierboard/CardMenu";
import { boards as site } from "../boards/owners";
import type { BoardsRepository } from "../boards/repository";
import { useBoards } from "../boards/useBoards";
import { sectionName } from "../sections/model";
import { sectionsStore, type SectionsStore } from "../sections/useSections";
import { discardStarted, RESUME_GAME, SAVE_MINE, startedLists, type Started } from "./started";
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
  onNotice,
}: {
  store?: KeyValueStore;
  repository?: BoardsRepository;
  sections?: SectionsStore;
  /** Discard my arrangement says so, with Undo, where the page says things. */
  onNotice?: (notice: SnackbarNotice) => void;
}) {
  const boards = useBoards(repository);
  const navigate = useNavigate();
  // Bumped when a begun list is discarded or put back: the store says nothing of its own.
  const [, setChanged] = useState(0);
  // The names as last known here; the nine stand in until the backend answered.
  const known = useSyncExternalStore(sections.subscribe, sections.get, sections.get).sections;
  // Read afresh on every drawing: a discard or its Undo changes the store and draws again by `changed`.
  const started = startedLists(
    store,
    new Set(
      boards.flatMap((board) =>
        board.takenFrom !== null && board.deletedAt === null ? [board.takenFrom] : [],
      ),
    ),
  );

  // A begun list's menu (artboard 39): as a list's in Your lists, shorter.
  const [menu, setMenu] = useState<{ listId: string; at: ScreenPoint } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const triggers = useMenuTriggers((target, at) => {
    const listId = target.closest<HTMLElement>("[data-started]")?.dataset.started;
    if (listId === undefined) return false;
    setMenu({ listId, at });
    return true;
  });
  if (started.length === 0) return null;
  const chosen = menu === null ? undefined : started.find((one) => one.listId === menu.listId);
  const pathOf = (one: Started) => `/l/${encodeURIComponent(one.listId)}`;
  const discard = (one: Started) => {
    const undo = discardStarted(store, one.listId);
    setChanged((was) => was + 1);
    onNotice?.({
      text: strings.listMenu.discarded,
      action: {
        text: strings.boards.undo,
        onClick: () => {
          undo();
          setChanged((was) => was + 1);
        },
      },
    });
  };
  return (
    <section className="started" aria-labelledby="started-title">
      <h2 id="started-title" className="started__title">
        {fill(strings.started.count, { n: started.length })}
      </h2>
      <ul
        className="started__list"
        onContextMenu={triggers.onContextMenu}
        onKeyDown={triggers.onKeyDown}
        onClick={triggers.onClick}
        onClickCapture={triggers.onClickCapture}
        onPointerDown={triggers.onPointerDown}
        onPointerMove={triggers.onPointerMove}
        onPointerUp={triggers.onPointerUp}
        onPointerCancel={triggers.onPointerCancel}
      >
        {started.map((one) => {
          const path = `/l/${encodeURIComponent(one.listId)}`;
          const section = one.category === null ? null : sectionName(one.category, known);
          const share = one.total === 0 ? 0 : Math.round((one.placed / one.total) * 100);
          return (
            <li key={one.listId} className="started__card" data-started={one.listId}>
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
                <MoreButton name={one.title} className="started__more" />
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
      {menu !== null && chosen !== undefined && (
        <ListMenu
          label={fill(strings.listMenu.label, { name: chosen.title })}
          title={chosen.title}
          meta={fill(strings.started.placed, { n: chosen.placed, total: chosen.total })}
          entries={[
            {
              key: "open",
              icon: "chevron_right",
              text: strings.listMenu.open,
              onSelect: () => void navigate(pathOf(chosen)),
            },
            ...(chosen.game
              ? [
                  {
                    key: "resume",
                    icon: "play_arrow" as const,
                    text: strings.started.resume,
                    onSelect: () => void navigate(pathOf(chosen), { state: RESUME_GAME }),
                  },
                ]
              : []),
            {
              key: "save",
              icon: "save",
              text: strings.list.saveMyList,
              onSelect: () => void navigate(pathOf(chosen), { state: SAVE_MINE }),
            },
            {
              key: "discard",
              icon: "delete",
              text: strings.listMenu.discard,
              danger: true,
              line: true,
              onSelect: () => discard(chosen),
            },
          ]}
          at={menu.at}
          onClose={closeMenu}
        />
      )}
    </section>
  );
}
