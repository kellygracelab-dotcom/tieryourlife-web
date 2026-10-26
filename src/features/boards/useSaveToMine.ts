import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import type { PublishedList } from "../../api/types";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { arrange } from "../board/arrange";
import { loadDraft, scopeOf } from "../board/draft";
import type { Rows } from "../board/model";
import { boardFromList } from "./publish";
import { boards as site, type BoardsRepository } from "./repository";
import { nextUid } from "./useBoards";

export type Whose = "theirs" | "mine" | "none";

export interface SaveToMineDeps {
  repository?: BoardsRepository;
  /** Where the ranking board keeps this device's rows for the list. */
  store?: KeyValueStore;
  now?: () => number;
}

/** The arrangements on offer: the author's when the snapshot carries one, mine when I placed anything. */
export interface SaveChoices {
  theirs: Rows | null;
  mine: Rows | null;
}

export interface SaveToMine {
  /** Saves at once when there is nothing to choose between; asks otherwise. */
  start: () => void;
  asking: SaveChoices | null;
  save: (whose: Whose) => void;
  cancel: () => void;
}

/**
 * The phone's "Save to my lists": somebody else's list becomes a board of
 * one's own, with the author's arrangement, the one on screen, or none. The
 * question is asked only when there is a choice to make; the receipt offers
 * to open the new board.
 */
export function useSaveToMine(
  list: PublishedList,
  notify: (notice: SnackbarNotice) => void,
  { repository = site, store = localStorageStore, now = Date.now }: SaveToMineDeps = {},
): SaveToMine {
  const [asking, setAsking] = useState<SaveChoices | null>(null);
  const navigate = useNavigate();

  const save = useCallback(
    (whose: Whose, choices: SaveChoices | null = asking) => {
      const rows =
        whose === "theirs"
          ? (choices?.theirs ?? null)
          : whose === "mine"
            ? (choices?.mine ?? null)
            : null;
      const board = boardFromList(list, rows, now(), nextUid);
      repository.save(board);
      setAsking(null);
      notify({
        text: strings.list.savedToMine,
        action: {
          text: strings.list.open,
          onClick: () => void navigate(`/b/${encodeURIComponent(board.uid)}`),
        },
      });
    },
    [asking, list, now, repository, notify, navigate],
  );

  const start = useCallback(() => {
    const theirs = arrange(list);
    const mine = loadDraft(store, scopeOf(list));
    const choices: SaveChoices = {
      theirs: theirs.known ? theirs.rows : null,
      mine: mine !== null && mine.some((row) => row.length > 0) ? mine : null,
    };
    if (choices.theirs === null && choices.mine === null) save("none", choices);
    else setAsking(choices);
  }, [list, store, save]);

  const cancel = useCallback(() => setAsking(null), []);

  return { start, asking, save, cancel };
}
