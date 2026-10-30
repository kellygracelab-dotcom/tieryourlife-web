import { useCallback, useState } from "react";
import { Link } from "react-router";
import { errorOf } from "../api/errors";
import { usePageTitle } from "../app/pageTitle";
import { agoOf, type Ago } from "../features/boards/ago";
import {
  dropItem,
  restoreBoard,
  restoreItem,
  trashEntriesOf,
  withoutTrash,
  type Board,
  type TrashEntry,
} from "../features/boards/model";
import { boards as site, type BoardsRepository } from "../features/boards/repository";
import { useBoards } from "../features/boards/useBoards";
import type { UnpublishBoard } from "../features/boards/BoardSettings";
import { unpublish as unpublishList } from "../lib/api";
import { fill, plural, strings } from "../strings";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./TrashPage.css";

interface TrashPageProps {
  repository?: BoardsRepository;
  now?: () => number;
  unpublish?: UnpublishBoard;
}

/**
 * A trashed board's public copy taken down before the board goes for good:
 * once it is gone from here, nothing would be left to take the copy down
 * with, and the list would stay in the feed. Already gone is what was asked
 * for; any other refusal keeps the board.
 */
async function takenDown(board: Board, unpublish: UnpublishBoard): Promise<boolean> {
  if (board.publishedId === null) return true;
  try {
    await unpublish(board.publishedId);
    return true;
  } catch (reason: unknown) {
    return errorOf(reason).kind === "notFound";
  }
}

const agoText = (ago: Ago): string => {
  switch (ago.kind) {
    case "justNow":
      return strings.trash.justNow;
    case "minutes":
      return plural(strings.trash.minutesAgo, ago.n);
    case "hours":
      return plural(strings.trash.hoursAgo, ago.n);
    case "yesterday":
      return strings.trash.yesterday;
    case "days":
      return plural(strings.trash.daysAgo, ago.n);
  }
};

const boardTitle = (board: Board): string =>
  board.title.trim().length > 0 ? board.title : strings.boards.untitled;

const titleOf = (entry: TrashEntry): string =>
  entry.kind === "board" ? boardTitle(entry.board) : entry.item.title;

const keyOf = (entry: TrashEntry): string =>
  entry.kind === "board" ? `b:${entry.board.uid}` : `i:${entry.board.uid}:${entry.item.uid}`;

type Asking = { what: "nothing" } | { what: "entry"; entry: TrashEntry } | { what: "all" };

/**
 * Deleted boards and cards, until somebody removes them: nothing expires. A
 * row names the board a card came from, because a card out of its board is
 * otherwise unidentifiable. Restore needs no confirmation; the row leaving is
 * the confirmation. Removing for good, and emptying, are two of the few
 * dialogs on the site.
 */
export function TrashPage({
  repository = site,
  now = Date.now,
  unpublish = unpublishList,
}: TrashPageProps) {
  usePageTitle(strings.trash.title);
  const boards = useBoards(repository);
  const entries = trashEntriesOf(boards);
  const [asking, setAsking] = useState<Asking>({ what: "nothing" });
  const close = useCallback(() => setAsking({ what: "nothing" }), []);
  // While a public copy is being taken down the rows wait: a board restored
  // meanwhile would come back with a copy that is no longer there.
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const forget = useCallback(() => setNotice(null), []);
  const stillPublic = () => setNotice({ text: strings.trash.stillPublic });
  const at = now();

  const restore = (entry: TrashEntry) => {
    const board = repository.get(entry.board.uid);
    if (board === null) return;
    repository.save(
      entry.kind === "board"
        ? restoreBoard(board, now())
        : restoreItem(board, entry.item.uid, now()),
    );
  };

  const remove = async (entry: TrashEntry) => {
    close();
    if (entry.kind === "item") {
      const board = repository.get(entry.board.uid);
      if (board !== null) repository.save(dropItem(board, entry.item.uid));
      return;
    }
    setBusy(true);
    const down = await takenDown(entry.board, unpublish);
    setBusy(false);
    if (down) repository.remove(entry.board.uid);
    else stillPublic();
  };

  // Everything goes but a board whose public copy is still out there, which
  // stays for the next try, as on the phone.
  const empty = async () => {
    close();
    const trashed = boards.filter((board) => board.deletedAt !== null);
    setBusy(true);
    const down = await Promise.all(trashed.map((board) => takenDown(board, unpublish)));
    setBusy(false);
    const kept = new Set(trashed.filter((_, index) => !down[index]).map((board) => board.uid));
    const current = repository.all();
    for (const board of current) {
      if (board.deletedAt !== null && !kept.has(board.uid)) repository.remove(board.uid);
    }
    // withoutTrash hands back a board it did not change as it was.
    const unchanged = new Set(current);
    repository.saveAll(withoutTrash(current).filter((board) => !unchanged.has(board)));
    if (kept.size > 0) stillPublic();
  };

  return (
    <section className="trash">
      <Link className="trash__back" to="/b">
        <Icon name="arrow_back" />
        <span>{strings.trash.back}</span>
      </Link>
      <header className="trash__head">
        <div className="trash__text">
          <h1 className="trash__title">{strings.trash.title}</h1>
          <p className="trash__subtitle">{strings.trash.subtitle}</p>
        </div>
        {/* Not composed at all while there is nothing to empty: that absence is the empty state. */}
        {entries.length > 0 && (
          <Menu label={strings.trash.more} button={<Icon name="more_vert" />}>
            <li>
              <button
                type="button"
                className="menu__action"
                disabled={busy}
                onClick={() => setAsking({ what: "all" })}
              >
                {strings.trash.emptyMenu}
              </button>
            </li>
          </Menu>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="trash__empty" role="status">
          <Icon name="delete" className="trash__empty-icon" />
          <p className="trash__empty-title">{strings.trash.nothingTitle}</p>
          <p className="trash__empty-body">{strings.trash.nothingBody}</p>
        </div>
      ) : (
        <ul className="trash__rows" aria-label={strings.trash.title}>
          {entries.map((entry) => {
            const title = titleOf(entry);
            const when = agoText(agoOf(entry.deletedAt, at));
            const meta =
              entry.kind === "board"
                ? fill(strings.trash.listMeta, {
                    count: plural(strings.boards.cards, entry.itemCount),
                    when,
                  })
                : fill(strings.trash.itemMeta, { list: boardTitle(entry.board), when });
            const picture = entry.kind === "item" ? entry.item.imageUrl : null;
            return (
              <li key={keyOf(entry)} className="trash-row">
                {picture !== null ? (
                  <img className="trash-row__picture" src={picture} alt="" loading="lazy" />
                ) : (
                  <span className="trash-row__picture trash-row__picture--blank" aria-hidden="true">
                    <Icon name={entry.kind === "board" ? "dashboard" : "category"} />
                  </span>
                )}
                <span className="trash-row__text">
                  <span className="trash-row__title">{title}</span>
                  <span className="trash-row__meta">{meta}</span>
                </span>
                <span className="trash-row__actions">
                  <button
                    type="button"
                    className="btn btn--text"
                    aria-label={fill(strings.trash.restoreOf, { name: title })}
                    disabled={busy}
                    onClick={() => restore(entry)}
                  >
                    <Icon name="restore_from_trash" className="btn__icon" />
                    <span>{strings.trash.restore}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--text trash-row__remove"
                    aria-label={fill(strings.trash.removeOf, { name: title })}
                    disabled={busy}
                    onClick={() => setAsking({ what: "entry", entry })}
                  >
                    <Icon name="delete_forever" className="btn__icon" />
                    <span>{strings.trash.remove}</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {asking.what === "entry" && (
        <ConfirmDialog
          narrow
          title={strings.trash.removeTitle}
          body={
            asking.entry.kind === "board"
              ? fill(strings.trash.removeBodyList, {
                  title: titleOf(asking.entry),
                  count: plural(strings.boards.cards, asking.entry.itemCount),
                })
              : fill(strings.trash.removeBodyItem, { title: titleOf(asking.entry) })
          }
          confirmLabel={strings.trash.remove}
          cancelLabel={strings.trash.cancel}
          onConfirm={() => void remove(asking.entry)}
          onCancel={close}
        />
      )}
      {asking.what === "all" && (
        <ConfirmDialog
          narrow
          title={strings.trash.emptyTitle}
          body={fill(strings.trash.emptyBody, {
            count: plural(strings.trash.entries, entries.length),
          })}
          confirmLabel={strings.trash.emptyMenu}
          cancelLabel={strings.trash.cancel}
          onConfirm={() => void empty()}
          onCancel={close}
        />
      )}
      <Snackbar notice={notice} onDone={forget} />
    </section>
  );
}
