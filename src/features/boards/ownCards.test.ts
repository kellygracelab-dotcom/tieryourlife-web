import { describe, expect, it, vi } from "vitest";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { findMyRanking, ownCardsOfRanking, withOwnCards } from "./ownCards";

const ranking = (uid: string, more: Partial<ReaderRanking> = {}): ReaderRanking => ({
  uid,
  authorName: uid,
  authorPhotoUrl: null,
  arrangement: [],
  rows: [],
  tierLabels: [],
  updatedAtMs: 0,
  mine: false,
  ...more,
});

describe("one's own cards in a ranking", () => {
  it("puts them after Mine's list cards, in the tiers they stood in, and drops what names no card", () => {
    const own = {
      rows: [[3, 0], [2], [9]],
      addedCards: [{ title: "Own A" }, { title: "Own B" }],
    };
    // Three list cards: 3 and 4 are the own cards; 0 there is a list card Mine places itself.
    expect(withOwnCards([[1], [0, 2]], 3, own)).toEqual({
      rows: [[1, 3], [0, 2], []],
      addedCards: own.addedCards,
    });
  });

  it("reads them back from a ranking as the backend kept them", () => {
    expect(ownCardsOfRanking(ranking("me"))).toBeNull();
    expect(
      ownCardsOfRanking(
        ranking("me", {
          addedCards: [{ title: "X", imageUrl: null, tierIndex: null, credit: null }],
          allRows: [[2]],
        }),
      ),
    ).toEqual({ rows: [[2]], addedCards: [{ title: "X" }] });
  });

  it("pages the rankings until its own, never taking the author's for it", async () => {
    const load = vi.fn(async (after: string | null): Promise<RankingsPage> =>
      after === null
        ? { rankings: [ranking("me", { mine: true, isAuthor: true })], nextCursor: "2" }
        : { rankings: [ranking("other"), ranking("me", { mine: true })], nextCursor: null },
    );
    expect(await findMyRanking(load)).toMatchObject({ uid: "me", mine: true });
    expect(load.mock.calls).toEqual([[null], ["2"]]);
    expect(await findMyRanking(async () => ({ rankings: [], nextCursor: null }))).toBeNull();
  });
});
