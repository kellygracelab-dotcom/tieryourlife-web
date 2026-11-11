import { useEffect, useMemo, useState } from "react";
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

export function CopyRankingOffer({
  board,
  sourceId,
  repository,
  notify,
}: {
  board: Board;
  sourceId: string;
  repository: BoardsRepository;
  notify: (notice: SnackbarNotice) => void;
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
    placed * 10 > count * 3;
  useEffect(() => {
    if (!ready || localStorageStore.read(offerKey(owner, sourceId)) !== null) return;
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
  }, [ready, sourceId, owner]);
  const rows = useMemo(
    () => (source === null ? null : rowsOfSource(board, source)),
    [board, source],
  );
  if (!ready || rows === null || source === null || (owner !== null && isOwnList(source, owner)))
    return null;
  const share = async () => {
    try {
      const fresh = await loadListAsWritten(sourceId);
      const latest = repository.get(board.uid);
      const current = latest === null ? null : rowsOfSource(latest, fresh);
      if (latest === null || current === null || isOwnList(fresh, owner ?? "")) {
        notify({ text: strings.rank.failedChanged });
        return false;
      }
      await keepListRanking(fresh, current);
      const saved = repository.get(board.uid);
      if (saved !== null) repository.save(setRanking(saved, sourceId, Date.now()));
      notify({ text: strings.rankings.shown });
      return true;
    } catch (reason: unknown) {
      const error = errorOf(reason);
      notify({
        text:
          error.kind === "offline"
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
      placed={placed}
      total={count}
      keep={() => repository.kept(board.uid)}
      share={share}
    />
  );
}
