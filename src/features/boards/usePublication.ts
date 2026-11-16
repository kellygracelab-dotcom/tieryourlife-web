import { useState } from "react";
import type { AccountAction } from "../../api/client";
import type { AddedCard } from "../../api/community";
import { errorOf, type ApiError } from "../../api/errors";
import type { Published, PublishRequest } from "../../api/lists";
import { isOwnList, type PublishedList } from "../../api/types";
import type { Session } from "../../app/session";
import { captureAccountAction } from "../../lib/accountAction";
import { keepListRanking, loadListAsWritten, loadTopic, withdrawListRanking } from "../../lib/api";
import { boundToSource } from "./copiedPublication";
import { copyRankingOf } from "./copyRanking";
import {
  isOut,
  setHeld,
  setPublished,
  setRanking,
  setTopic,
  settleTopic,
  topicSent,
  type Board,
  type BoardTopic,
} from "./model";
import { publishRequestOf } from "./publish";
import { sentTopic, settledTopic, type FindTopic } from "./topic";

export type PublishBoard = (request: PublishRequest, action: AccountAction) => Promise<Published>;
export type RepublishBoard = (
  id: string,
  request: PublishRequest,
  action: AccountAction,
) => Promise<Published>;
export type UnpublishBoard = (id: string) => Promise<void>;

export interface PublishingDeps {
  publish: PublishBoard;
  republish: RepublishBoard;
  unpublish: UnpublishBoard;
  loadOriginal?: typeof loadListAsWritten;
  /** Takes one's ranking of a list down; the site's own unless told otherwise. */
  withdraw?: (listId: string) => Promise<unknown>;
  /** Puts one's ranking of a list among its Rankings (K3); the site's own unless told otherwise. */
  rank?: typeof keepListRanking;
}

/**
 * The board went public, was sent again, or came down; or the backend kept
 * it as one's ranking of the list it was saved from, or kept it out of the
 * feed until a moderator looks (`held`). The page says so.
 */
export type OnPublished = (
  what: "published" | "updated" | "unpublished" | "ranking" | "held",
  id: string | null,
  /** Pictures from other sites the backend left out of this publish (QA S11). */
  dropped?: number,
) => void;

export type PublishBusy = "idle" | "publishing" | "updating" | "unpublishing";

/** A refusal, by the press it answers: each is said beside its own button. */
export interface PublishFailure {
  error: ApiError;
  on: "publish" | "update" | "takeDown";
  /** Refused as one's ranking (K3): said in a ranking's words, naming a card of one's own. */
  ranking?: readonly AddedCard[];
}

/**
 * Where a publish stands, kept by the board's page: the header's button and
 * the settings sheet press the same one, so a refusal met on the board is
 * there to read when the sheet opens on it.
 */
export interface PublicationState {
  busy: PublishBusy;
  failure: PublishFailure | null;
  /** The backend said the copy goes out only as one's ranking of this list (409 RANK_INSTEAD). */
  rankInstead: string | null;
  setBusy: (busy: PublishBusy) => void;
  setFailure: (failure: PublishFailure | null) => void;
  setRankInstead: (listId: string | null) => void;
}

interface Kept {
  key: string;
  busy: PublishBusy;
  failure: PublishFailure | null;
  rankInstead: string | null;
}

/** A fresh state for each `key` (the board and the account): nothing of another's carries over. */
export function usePublicationState(key: string): PublicationState {
  const fresh = (): Kept => ({ key, busy: "idle", failure: null, rankInstead: null });
  const [kept, setKept] = useState<Kept>(fresh);
  const now = kept.key === key ? kept : fresh();
  const change = (part: Partial<Omit<Kept, "key">>) =>
    setKept((was) => ({ ...(was.key === key ? was : fresh()), ...part }));
  return {
    busy: now.busy,
    failure: now.failure,
    rankInstead: now.rankInstead,
    setBusy: (busy) => change({ busy }),
    setFailure: (failure) => change({ failure }),
    setRankInstead: (rankInstead) => change({ rankInstead }),
  };
}

export interface PublicationContext {
  /** The board as it is right now, for a change made after a wait on the network. */
  latest: () => Board;
  keep: (board: Board) => void;
  publishing: PublishingDeps | null;
  account: Session["account"];
  onPublished: OnPublished;
  now: () => number;
  findTopic?: FindTopic;
}

export interface PublicationActions {
  /**
   * Out it goes, at the press, with nothing more to confirm (Danylo, 16.11):
   * what it will be was said on the button. A copy of somebody else's list
   * goes into that list's Rankings; a copy of one's own list goes out as a
   * list (`ownSource`, found when its list is read). True once it is out.
   */
  send: (
    what: "published" | "updated",
    given?: AccountAction | null,
    ownSource?: PublishedList,
  ) => Promise<boolean>;
  /** The board as one's ranking of a list (K3, K4); true once it is in. */
  rankCopy: (listId: string, given?: AccountAction | null) => Promise<boolean>;
  /** Down from Community or the Rankings; true once it is down, or was already. */
  takeDown: () => Promise<boolean>;
}

/** Publish, Update, Show in Rankings and Take it down, the same from the board's header and its sheet. */
export function publicationActions(
  state: PublicationState,
  {
    latest,
    keep,
    publishing,
    account,
    onPublished,
    now,
    findTopic = loadTopic,
  }: PublicationContext,
): PublicationActions {
  const { setBusy, setFailure, setRankInstead } = state;
  const me = account?.kind === "signedIn" ? account : null;

  // A topic of one's own that waits is asked about, as the phone asks when its
  // picker opens; the answer lands only if the board still has that topic.
  const settle = (topic: BoardTopic | null, action: AccountAction) => {
    if (topic === null || topic.id === null || topic.waiting !== true) return;
    void settledTopic(topic, findTopic).then((decided) => {
      if (!action.isCurrent()) return;
      const current = latest();
      if (decided !== topic && current.topic?.id === topic.id) {
        keep(settleTopic(current, decided));
      }
    });
  };

  // The topic the list sits under, as the answer said it, for a board that
  // chose none: learnt, never sent back, and only one of the board's own
  // section. One chosen here, or taken off here, is not touched.
  const learn = (topicId: string | null, action: AccountAction) => {
    const mayLearn = (board: Board) =>
      board.topicOff !== true && (board.topic === null || board.topic.learned === true);
    if (topicId === null) {
      const current = latest();
      if (mayLearn(current) && current.topic !== null) keep(settleTopic(current, null));
      return;
    }
    findTopic(topicId).then(
      (topic) => {
        if (!action.isCurrent()) return;
        const current = latest();
        if (!mayLearn(current)) return;
        const fits = topic.status === "approved" && topic.section === current.category;
        keep(settleTopic(current, fits ? { id: topic.id, name: topic.name, learned: true } : null));
      },
      () => undefined,
    );
  };

  const send: PublicationActions["send"] = async (what, given, ownSource) => {
    const action = given ?? (me === null ? null : captureAccountAction(me.uid));
    if (me === null || !action?.isCurrent() || action.uid !== me.uid) return false;
    const current = latest();
    // Out as one's ranking of a list: sent again as that ranking, with the
    // cards of one's own, never as a publish, which would take them away.
    if (current.rankingOf !== null && current.publishedId === null) {
      return rankCopy(current.rankingOf, action);
    }
    if (ownSource === undefined && current.takenFrom !== null && current.publishedId === null) {
      return rankCopy(current.takenFrom, action);
    }
    const request = publishRequestOf(current);
    if (request === null || publishing === null) return false;
    setRankInstead(null);
    setBusy(what === "published" ? "publishing" : "updating");
    setFailure(null);
    try {
      // The board's uid goes with every send, as the phone's does: a first
      // publish lost to a reload gets its list back, and a replace keeps it.
      const outgoing =
        ownSource === undefined
          ? { ...request, boardUid: current.uid }
          : boundToSource({ ...request, boardUid: current.uid }, ownSource);
      let answer =
        what === "updated" && current.publishedId !== null
          ? await publishing.republish(current.publishedId, outgoing, action)
          : await publishing.publish(outgoing, action);
      if (!action.isCurrent()) return false;
      // Out already: an earlier publish made the list and its answer was lost
      // on the way. Nothing of this one was written, so the board goes again
      // over that list's link, or the edits since would never reach it.
      if (answer.existing === true && answer.ranking !== true) {
        answer = await publishing.republish(answer.id, outgoing, action);
        if (!action.isCurrent()) return false;
      }
      const after = latest();
      // The cards as they came from the list they were saved from: the
      // backend kept them as one's ranking of it, which has no id of its own.
      const ranking = answer.ranking === true;
      // Kept out of the feed until a moderator looks: its link works for nobody yet.
      const waits = !ranking && answer.underReview === true;
      const out = ranking
        ? setRanking(after, answer.id, now())
        : setHeld(setPublished(after, answer.id, me.displayName ?? after.authorName, now()), waits);
      // A name proposed with it is a topic now, waiting for a moderator,
      // unless another was chosen while the request was on its way.
      const sent =
        ranking || after.topic !== current.topic
          ? out
          : settleTopic(
              current.topicOff === true ? topicSent(out) : out,
              sentTopic(current.topic, answer.topicId),
            );
      // A change made while the request was on its way was not in it: the
      // published copy is behind it, and Update still has it to send.
      keep(
        after.editedAt === current.editedAt
          ? sent
          : { ...sent, publishedEditedAt: sent.editedAt - 1 },
      );
      onPublished(
        ranking ? "ranking" : waits ? "held" : what,
        answer.id,
        ranking ? 0 : (answer.droppedPictures ?? 0),
      );
      // The backend may have filed it under an approved topic of that name.
      if (sent.topic !== current.topic) settle(sent.topic, action);
      // Said nothing of a topic, the list kept its own, a moderator's move
      // into one too: the board learns it, as the published copy has it.
      const kept = answer.topicId;
      const unchosen = sent.topic === null || sent.topic.learned === true;
      if (!ranking && unchosen && sent.topicOff !== true && kept !== undefined) {
        learn(kept === "" ? null : kept, action);
      }
      return true;
    } catch (reason: unknown) {
      if (!action.isCurrent()) return false;
      const error = errorOf(reason);
      // Taken down elsewhere (its page, /me, the phone): the board is no longer
      // public, and its row says so; Publish sends it out anew.
      if (what === "updated" && error.kind === "notFound") {
        keep(setPublished(latest(), null, null, now()));
      }
      // A topic of one's own that a moderator turned down meanwhile is not
      // open any more: the board forgets it, and the next try goes without.
      if (error.kind === "invalid" && error.code === "TOPIC_UNAVAILABLE") {
        keep(setTopic(latest(), null, now()));
      }
      // Somebody else's list, changed: it goes out only as one's ranking of it.
      if (error.kind === "rankInstead") setRankInstead(error.listId);
      else setFailure({ error, on: what === "published" ? "publish" : "update" });
      return false;
    } finally {
      setBusy("idle");
    }
  };

  /**
   * The board as one's ranking of the list it was saved from (K3, K4): the
   * list's cards in their places, the board's others as cards of one's own.
   * Every send carries them all, since a ranking sent without them loses them.
   */
  const rankCopy: PublicationActions["rankCopy"] = async (listId, given) => {
    const action = given ?? (me === null ? null : captureAccountAction(me.uid));
    if (!action?.isCurrent() || publishing === null) return false;
    setRankInstead(null);
    setFailure(null);
    setBusy("publishing");
    let added: readonly AddedCard[] = [];
    try {
      const source = await (publishing.loadOriginal ?? loadListAsWritten)(listId);
      if (!action.isCurrent()) return false;
      const current = latest();
      // Made the ranking of a list it was not saved from, it has no places of the list's to keep.
      const ranking = copyRankingOf(
        current.takenFrom === listId
          ? current
          : { ...current, takenFrom: listId, origin: undefined },
        source,
      );
      // A copy of one's own list goes out as a list, as it always could.
      if (isOwnList(source, action.uid) && current.publishedId === null) {
        setBusy("idle");
        return await send("published", action, source);
      }
      if (ranking === null || isOwnList(source, action.uid)) {
        setFailure({ error: { kind: "invalid", detail: null, code: null }, on: "publish" });
        return false;
      }
      added = ranking.addedCards;
      await (publishing.rank ?? keepListRanking)(source, ranking.rows, action, {
        addedCards: ranking.addedCards,
        tierLabels: ranking.tierLabels,
      });
      if (!action.isCurrent()) return false;
      const after = latest();
      const out = setRanking(after, listId, now());
      // A change made while the ranking was on its way was not in it.
      keep(
        after.editedAt === current.editedAt ? out : { ...out, publishedEditedAt: out.editedAt - 1 },
      );
      onPublished("ranking", listId, 0);
      return true;
    } catch (reason: unknown) {
      if (!action.isCurrent()) return false;
      setFailure({ error: errorOf(reason), on: "publish", ranking: added });
      return false;
    } finally {
      setBusy("idle");
    }
  };

  // Down, the board is one's own again: the name publishing put on it goes, or
  // Your lists would take it for a copy of somebody else's. A ranking down
  // keeps the author's name: the cards are still theirs.
  const down = () => {
    const at = now();
    const was = latest();
    keep(was.rankingOf !== null ? setRanking(was, null, at) : setPublished(was, null, null, at));
    onPublished("unpublished", null);
  };
  const takeDown: PublicationActions["takeDown"] = async () => {
    const current = latest();
    if (!isOut(current) || publishing === null) return false;
    setBusy("unpublishing");
    setFailure(null);
    try {
      if (current.rankingOf !== null) {
        await (publishing.withdraw ?? withdrawListRanking)(current.rankingOf);
      } else if (current.publishedId !== null) {
        await publishing.unpublish(current.publishedId);
      }
      down();
      return true;
    } catch (reason: unknown) {
      // Already gone is what was asked for.
      const error = errorOf(reason);
      if (error.kind === "notFound") {
        down();
        return true;
      }
      setFailure({ error, on: "takeDown" });
      return false;
    } finally {
      setBusy("idle");
    }
  };

  return { send, rankCopy, takeDown };
}

/** The page others see of what went out: the list in Community, or the Rankings of the list it ranks. */
export function publishedPath(board: Board): string | null {
  if (!isOut(board) || board.heldForReview === true) return null;
  return `/l/${encodeURIComponent(board.publishedId ?? board.rankingOf ?? "")}`;
}
