import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { usePageTitle } from "../app/pageTitle";
import { agoOf, type Ago } from "../features/boards/ago";
import {
  restoreBoard,
  trashEntriesOf,
  trashedCardCount,
  withoutTrash,
  type Board,
  type TrashEntry,
} from "../features/boards/model";
import { type BoardsRepository } from "../features/boards/repository";
import { boards as site } from "../features/boards/owners";
import { takenDown } from "../features/boards/takeDown";
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

/** What emptying takes, named in full: the deleted lists and the cards removed from live ones (QA W59). */
const emptyingText = (lists: number, cards: number): string => {
  const count = plural(strings.boards.cards, cards);
  if (lists === 0) return fill(strings.trash.emptyCards, { count });
  const entries = plural(strings.trash.entries, lists);
  return cards === 0
    ? fill(strings.trash.emptyBody, { count: entries })
    : fill(strings.trash.emptyBoth, { entries, count });
};

type Asking = { what: "nothing" } | { what: "entry"; entry: TrashEntry } | { what: "all" };

/**
 * Deleted lists, until somebody removes them: nothing expires. Cards never
 * come here; a removed card has its Undo on the board. Restore needs no
 * confirmation; the row leaving is the confirmation. Removing for good, and
 * emptying, are two of the few dialogs on the site.
 */
export function TrashPage({
  repository = site,
  now = Date.now,
  unpublish = unpublishList,
}: TrashPageProps) {
  usePageTitle(strings.trash.title);
  const boards = useBoards(repository);
  const entries = trashEntriesOf(boards);
  // Cards trashed elsewhere are not listed, but Settings sends a board that
  // holds too many here, so the trash can still be emptied of them.
  const trashedCards = trashedCardCount(boards);
  const [asking, setAsking] = useState<Asking>({ what: "nothing" });
  const close = useCallback(() => setAsking({ what: "nothing" }), []);
  // While a public copy is being taken down the rows wait: a board restored
  // meanwhile would come back with a copy that is no longer there.
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const forget = useCallback(() => setNotice(null), []);
  const stillPublic = () => setNotice({ text: strings.trash.stillPublic });
  const at = now();

  // A row restored or removed goes with the button pressed in it: the focus
  // moves to the row that takes its place, or the one before it, or, once
  // the trash is empty, back to the lists.
  const page = useRef<HTMLElement>(null);
  const focusRow = useRef<number | null>(null);
  useEffect(() => {
    const index = focusRow.current;
    if (index === null || busy) return;
    focusRow.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const rows = page.current?.querySelectorAll<HTMLElement>(".trash-row") ?? [];
    const row = rows[Math.min(index, rows.length - 1)];
    (
      row?.querySelector<HTMLElement>("button") ??
      page.current?.querySelector<HTMLElement>(".trash__back")
    )?.focus();
  });
  const rowOf = (entry: TrashEntry) => entries.findIndex((it) => it.board.uid === entry.board.uid);

  const restore = (entry: TrashEntry) => {
    focusRow.current = rowOf(entry);
    const board = repository.get(entry.board.uid);
    if (board === null) return;
    repository.save(restoreBoard(board));
  };

  const remove = async (entry: TrashEntry) => {
    focusRow.current = rowOf(entry);
    close();
    setBusy(true);
    const down = await takenDown(entry.board, unpublish);
    // The row goes before the rows wake, so the focus moves past it, not into it.
    if (down) repository.remove(entry.board.uid);
    else stillPublic();
    setBusy(false);
  };

  // Everything goes but a board whose public copy is still out there, which
  // stays for the next try, as on the phone.
  const empty = async () => {
    focusRow.current = 0;
    close();
    const trashed = boards.filter((board) => board.deletedAt !== null);
    setBusy(true);
    const down = await Promise.all(trashed.map((board) => takenDown(board, unpublish)));
    const kept = new Set(trashed.filter((_, index) => !down[index]).map((board) => board.uid));
    const current = repository.all();
    for (const board of current) {
      if (board.deletedAt !== null && !kept.has(board.uid)) repository.remove(board.uid);
    }
    // withoutTrash hands back a board it did not change as it was.
    const unchanged = new Set(current);
    repository.saveAll(withoutTrash(current).filter((board) => !unchanged.has(board)));
    if (kept.size > 0) stillPublic();
    setBusy(false);
  };

  return (
    <section className="trash" ref={page}>
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
        {(entries.length > 0 || trashedCards > 0) && (
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
        // Cards removed from live boards are not rows, but while they wait the
        // trash is not empty, and the page does not say it is (QA W59).
        <div className="trash__empty" role="status">
          <Icon name="delete" className="trash__empty-icon" />
          <p className="trash__empty-title">
            {trashedCards > 0 ? strings.trash.cardsTitle : strings.trash.nothingTitle}
          </p>
          <p className="trash__empty-body">
            {trashedCards > 0
              ? fill(strings.trash.cardsBody, { count: plural(strings.boards.cards, trashedCards) })
              : strings.trash.nothingBody}
          </p>
        </div>
      ) : (
        <ul className="trash__rows" aria-label={strings.trash.title}>
          {entries.map((entry) => {
            const title = boardTitle(entry.board);
            const meta = fill(strings.trash.listMeta, {
              count: plural(strings.boards.cards, entry.itemCount),
              when: agoText(agoOf(entry.deletedAt, at)),
            });
            return (
              <li key={entry.board.uid} className="trash-row">
                <span className="trash-row__picture trash-row__picture--blank" aria-hidden="true">
                  <Icon name="dashboard" />
                </span>
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
          body={fill(strings.trash.removeBodyList, {
            title: boardTitle(asking.entry.board),
            count: plural(strings.boards.cards, asking.entry.itemCount),
          })}
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
          body={emptyingText(entries.length, trashedCards)}
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
