import { useEffect, useMemo, useState } from "react";
import type { AccountAction } from "../../api/client";
import { isOwnList, type PublishedList } from "../../api/types";
import { errorOf } from "../../api/errors";
import { useSession } from "../../app/session";
import { keepListRanking, loadListAsWritten } from "../../lib/api";
import { strings } from "../../strings";
import { RankingOffer, offerKey } from "./RankingOffer";
import { localStorageStore } from "../../lib/storage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { liveItems, rankedCount, setRanking, type Board } from "./model";
import { hasRankingEdit, rowsOfSource } from "./sourceRanking";
import type { BoardsRepository } from "./repository";

/**
 * The offer on a board saved from somebody else's list: once a game put its
 * result on the board, or once every card has its place, Show in Rankings
 * puts the board's arrangement among the list's.
 */
export function CopyRankingOffer({
  board,
  sourceId,
  repository,
  notify,
  afterGame = false,
}: {
  board: Board;
  sourceId: string;
  repository: BoardsRepository;
  notify: (notice: SnackbarNotice) => void;
  /** A game has just put its result on the board. */
  afterGame?: boolean;
}) {
  const { account } = useSession();
  const owner = account?.kind === "signedIn" ? account.uid : null;
  const [source, setSource] = useState<PublishedList | null>(null);
  const count = liveItems(board).length;
  const placed = rankedCount(board);
  const ready =
    account !== null &&
    board.rankingOf === null &&
    hasRankingEdit(board.uid) &&
    placed > 0 &&
    (afterGame || placed === count);
  useEffect(() => {
    if (
      !ready ||
      board.rankingChoice !== undefined ||
      localStorageStore.read(offerKey(owner, sourceId)) !== null
    )
      return;
    let current = true;
    const read = () => {
      void loadListAsWritten(sourceId).then(
        (list) => {
          if (current) setSource(list);
        },
        () => {},
      );
    };
    read();
    window.addEventListener("online", read);
    return () => {
      current = false;
      window.removeEventListener("online", read);
    };
  }, [ready, sourceId, owner, board.rankingChoice]);
  const rows = useMemo(
    () => (source === null ? null : rowsOfSource(board, source)),
    [board, source],
  );
  if (!ready || rows === null || source === null || (owner !== null && isOwnList(source, owner)))
    return null;
  const share = async (action: AccountAction) => {
    try {
      const fresh = await loadListAsWritten(sourceId);
      if (!action.isCurrent()) return false;
      if (
        repository.get(board.uid) !== board ||
        fresh.updatedAt !== source.updatedAt ||
        isOwnList(fresh, action.uid)
      ) {
        notify({ text: strings.rank.failedChanged });
        return false;
      }
      await keepListRanking(source, rows, action);
      if (!action.isCurrent() || repository.get(board.uid) !== board) return false;
      repository.save(setRanking(board, sourceId, Date.now()));
      notify({ text: strings.rankings.shown });
      return true;
    } catch (reason: unknown) {
      if (!action.isCurrent()) return false;
      const error = errorOf(reason);
      notify({
        text:
          error.kind === "sourceChanged"
            ? strings.rank.failedChanged
            : error.kind === "offline"
              ? strings.rank.failedOffline
              : error.kind === "banned"
                ? strings.rankings.showBanned
                : strings.rank.failedOther,
      });
      return false;
    }
  };
  return (
    <RankingOffer
      listId={sourceId}
      due
      known={
        board.rankingChoice !== undefined ||
        repository
          .all()
          .some((other) => other.takenFrom === sourceId && other.rankingChoice !== undefined)
      }
      // Kept with the board, so the phone does not ask again: shown, or asked and let be.
      onSettled={(shown) => {
        const choice = shown ? "ranking" : "offered";
        const current = repository.get(board.uid);
        if (
          current &&
          current.rankingChoice !== choice &&
          (choice !== "offered" || !current.rankingChoice)
        )
          repository.save({ ...current, rankingChoice: choice });
      }}
      share={share}
    />
  );
}
