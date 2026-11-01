import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import type { PublishedList, PublishedTier } from "../../api/types";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { arrange } from "../tierboard/arrange";
import { loadPlacedDraft, scopeOf } from "../tierboard/draft";
import type { Rows } from "../tierboard/model";
import { boardFromList } from "./publish";
import { boards as site, type BoardsRepository } from "./repository";
import { nextUid } from "./useBoards";

export type Whose = "theirs" | "mine" | "none";

/** Another reader's placing on show in the left half instead of the author's. */
export interface ShownPlacing {
  name: string;
  tiers: readonly PublishedTier[];
  rows: Rows;
}

export interface SaveToMineDeps {
  repository?: BoardsRepository;
  /** A reader's ranking picked from the rankings sheet: what Theirs then keeps. */
  shown?: ShownPlacing | null;
  /** Where the ranking board keeps this device's rows for the list. */
  store?: KeyValueStore;
  now?: () => number;
}

/**
 * The arrangements on offer: what the left half shows (a reader picked, or
 * the author's when the snapshot carries one), and mine when I placed anything.
 */
export interface SaveChoices {
  theirs: { rows: Rows; tiers: readonly PublishedTier[]; name: string | null } | null;
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
 * to open the new board. A list with nothing placed, a template, has no
 * Theirs to weigh: one's own is saved as it stands, as on the phone. A
 * reader's ranking picked to look at is a Theirs of its own, kept with its
 * own tier words.
 */
export function useSaveToMine(
  list: PublishedList,
  notify: (notice: SnackbarNotice) => void,
  {
    repository = site,
    store = localStorageStore,
    now = Date.now,
    shown = null,
  }: SaveToMineDeps = {},
): SaveToMine {
  const [asking, setAsking] = useState<SaveChoices | null>(null);
  const navigate = useNavigate();

  const save = useCallback(
    (whose: Whose, choices: SaveChoices | null = asking) => {
      const theirs = whose === "theirs" ? (choices?.theirs ?? null) : null;
      const rows =
        theirs !== null ? theirs.rows : whose === "mine" ? (choices?.mine ?? null) : null;
      const from = theirs === null ? list : { ...list, tiers: [...theirs.tiers] };
      const board = boardFromList(from, rows, now(), nextUid);
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
    const author = arrange(list);
    const choices: SaveChoices = {
      theirs:
        shown !== null
          ? shown
          : author.known
            ? { rows: author.rows, tiers: list.tiers, name: null }
            : null,
      mine: loadPlacedDraft(store, scopeOf(list)),
    };
    if (choices.theirs === null) save(choices.mine === null ? "none" : "mine", choices);
    else setAsking(choices);
  }, [list, store, save, shown]);

  const cancel = useCallback(() => setAsking(null), []);

  return { start, asking, save, cancel };
}
