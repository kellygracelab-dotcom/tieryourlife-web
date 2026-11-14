import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { AccountAction } from "../../api/client";
import type { PublishedList, PublishedTier } from "../../api/types";
import { noteTake } from "../../lib/api";
import { strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import type { Rows } from "../tierboard/model";
import { copyOfList, holdsArrangement, rearrangeCopy } from "./listCopies";
import { noteRankingEdit } from "./sourceRanking";
import { boardFromList } from "./publish";
import { type BoardsRepository } from "./repository";
import { boards as site } from "./owners";
import { nextUid, useBoards } from "./useBoards";

/**
 * What Save keeps, as the Author | Mine switch shows it: the author's
 * arrangement, or one's own with the tier words and the pool's order it
 * wears. Rows of null place nothing.
 */
export interface Shown {
  whose: "author" | "mine";
  rows: Rows | null;
  tiers: readonly PublishedTier[];
  poolOrder?: readonly number[];
}

export interface SaveToMineDeps {
  repository?: BoardsRepository;
  now?: () => number;
  /** Counts the save as a take of the list, as the app does: the popular order is made of them. */
  take?: (listId: string, action?: AccountAction) => Promise<void>;
}

export interface SaveToMine {
  /** The list's board in one's lists already holds what is shown: the button reads Saved and opens it. */
  saved: boolean;
  /** Saves what is shown, or opens the board once it holds it. */
  start: () => void;
}

/**
 * The one Save of somebody else's list (Danylo, 14.11.2026): it keeps what
 * the switch shows, the author's arrangement or one's own, with no question
 * asked. One list is one board in one's lists: the first Save makes it,
 * with the list's cover, and a Save after that puts the arrangement shown on
 * the same board. Once the board holds it, the button says Saved and opens it.
 */
export function useSaveToMine(
  list: PublishedList,
  shown: Shown,
  notify: (notice: SnackbarNotice) => void,
  { repository = site, now = Date.now, take = noteTake }: SaveToMineDeps = {},
): SaveToMine {
  const navigate = useNavigate();
  const boards = useBoards(repository);
  const copy = copyOfList(boards, list.id);
  const saved = copy !== null && holdsArrangement(copy, list, shown.rows);

  const open = useCallback(
    (uid: string) => void navigate(`/b/${encodeURIComponent(uid)}`),
    [navigate],
  );
  const start = useCallback(() => {
    // Read again rather than from the render: a double click finds the board the first one made.
    const kept = copyOfList(repository.all(), list.id);
    if (kept !== null && holdsArrangement(kept, list, shown.rows)) {
      open(kept.uid);
      return;
    }
    const board =
      kept === null
        ? boardFromList(
            { ...list, tiers: [...shown.tiers] },
            shown.rows,
            now(),
            nextUid,
            shown.poolOrder,
          )
        : rearrangeCopy(kept, list, shown.rows, now());
    if (board === null) return;
    if (shown.whose === "mine" && shown.rows !== null) noteRankingEdit(board.uid);
    if (!repository.save(board)) {
      notify({ text: strings.nav.storageRefused });
      return;
    }
    // Counted once a person, and never worth failing a save over.
    if (kept === null) void take(list.id);
    notify({
      text: strings.list.savedToMine,
      // A board saved before had an arrangement of its own: Undo gives it back.
      action:
        kept === null
          ? { text: strings.list.open, onClick: () => open(board.uid) }
          : { text: strings.list.undo, onClick: () => void repository.save(kept) },
    });
  }, [repository, list, shown, now, take, notify, open]);

  return { saved, start };
}
