import { describe, expect, it } from "vitest";
import { ADDED_CARDS_MAX } from "../../api/community";
import type { PublishedList } from "../../api/types";
import { addedCardOf, copyRankingOf, rankingFailureText } from "./copyRanking";
import {
  addToPool,
  itemsIn,
  liveItems,
  moveItem,
  newBoard,
  rankedTiers,
  type Board,
} from "./model";
import { boardFromList } from "./publish";
import { boardView } from "./view";

const ids = () => {
  let n = 0;
  return () => String(++n);
};

/** A published list of these cards, by somebody else. */
function sourceOf(titles: readonly string[]): PublishedList {
  const uid = ids();
  const board = addToPool(
    newBoard("source", "Films", 100, uid),
    titles.map((title) => ({ title, imageUrl: `https://img.test/${title}.jpg` })),
    100,
    uid,
  );
  return { ...boardView(board, "Films").list, id: "SRC", authorUid: "author" };
}

/** The card of this title moved to the end of this ranked tier. */
function placed(board: Board, title: string, tier: number): Board {
  const card = liveItems(board).find((item) => item.title === title)!;
  const to = rankedTiers(board)[tier]!;
  return moveItem(board, card.uid, to.uid, itemsIn(board, to.uid).length, 300);
}

describe("copyRankingOf", () => {
  it("names the list's cards by their place and one's own as N + k, ranked first", () => {
    const source = sourceOf(["Alien", "Brazil", "Cars"]);
    const uid = ids();
    let board = boardFromList(source, null, 200, () => "c" + uid());
    board = addToPool(
      board,
      [
        { title: "Dune", imageUrl: "https://img.test/dune.jpg" },
        { title: "Mine", imageUrl: "https://own.test/x.jpg", pictureId: "pic1", credit: "Me" },
      ],
      250,
      () => "o" + uid(),
    );
    board = placed(board, "Cars", 0);
    board = placed(board, "Mine", 0);
    board = placed(board, "Alien", 1);
    const ranking = copyRankingOf(board, source)!;
    // Mine is ranked, so it comes first among one's own: 3; Dune, in the pool, is 4.
    expect(ranking.rows.slice(0, 2)).toEqual([[2, 3], [0]]);
    expect(ranking.rows.slice(2).flat()).toEqual([]);
    expect(ranking.addedCards).toEqual([
      { title: "Mine", pictureId: "pic1", credit: "Me" },
      { title: "Dune", imageUrl: "https://img.test/dune.jpg" },
    ]);
    expect(ranking.tierLabels).toEqual(source.tiers.map((tier) => tier.label));
  });

  it("sends no cards of one's own for a copy that is still the list's cards", () => {
    const source = sourceOf(["Alien", "Brazil"]);
    const board = placed(boardFromList(source, null, 200, ids()), "Brazil", 0);
    expect(copyRankingOf(board, source)).toEqual({
      rows: source.tiers.map((_, i) => (i === 0 ? [1] : [])),
      tierLabels: source.tiers.map((tier) => tier.label),
      addedCards: [],
    });
  });

  it("takes at most fifty cards of one's own, the pool's left out before the ranked", () => {
    const source = sourceOf(["Alien"]);
    const uid = ids();
    let board = boardFromList(source, null, 200, () => "c" + uid());
    board = addToPool(
      board,
      Array.from({ length: ADDED_CARDS_MAX + 5 }, (_, i) => ({
        title: `Own ${i}`,
        imageUrl: null,
      })),
      250,
      () => "o" + uid(),
    );
    board = placed(board, `Own ${ADDED_CARDS_MAX + 4}`, 0);
    const ranking = copyRankingOf(board, source)!;
    expect(ranking.addedCards).toHaveLength(ADDED_CARDS_MAX);
    // The ranked one went first, as 1 (N + 0).
    expect(ranking.addedCards[0]?.title).toBe(`Own ${ADDED_CARDS_MAX + 4}`);
    expect(ranking.rows[0]).toEqual([1]);
    expect(ranking.addedCards.map((card) => card.title)).not.toContain(`Own ${ADDED_CARDS_MAX}`);
  });

  it("is no ranking of another list, nor of one with other tiers", () => {
    const source = sourceOf(["Alien"]);
    const board = boardFromList(source, null, 200, ids());
    expect(copyRankingOf(board, { ...source, id: "OTHER" })).toBeNull();
    expect(copyRankingOf(board, { ...source, tiers: source.tiers.slice(1) })).toBeNull();
  });

  it("matches a card of the same name and picture once, the second as one's own", () => {
    const source = sourceOf(["Alien"]);
    const uid = ids();
    let board = boardFromList(source, null, 200, () => "c" + uid());
    board = addToPool(
      board,
      [{ title: "Alien", imageUrl: "https://img.test/Alien.jpg" }],
      250,
      () => "o" + uid(),
    );
    const ranking = copyRankingOf(board, source)!;
    expect(ranking.addedCards).toEqual([
      { title: "Alien", imageUrl: "https://img.test/Alien.jpg" },
    ]);
  });
});

describe("addedCardOf", () => {
  it("sends one's own picture by id, another site's by address, and nothing for none", () => {
    const card = {
      uid: "1",
      tierUid: "t",
      position: 0,
      title: "X",
      imageUrl: null,
      pictureId: null,
      credit: null,
      source: "MANUAL" as const,
      deletedAt: null,
    };
    expect(addedCardOf(card)).toEqual({ title: "X" });
    expect(addedCardOf({ ...card, imageUrl: "https://a.test/x.jpg" })).toEqual({
      title: "X",
      imageUrl: "https://a.test/x.jpg",
    });
    expect(addedCardOf({ ...card, imageUrl: "https://private", pictureId: "p" })).toEqual({
      title: "X",
      pictureId: "p",
    });
  });
});

describe("rankingFailureText", () => {
  const added = [{ title: "Heat" }, { title: "Tenet" }];
  it("names the card of one's own a refused picture is on", () => {
    expect(
      rankingFailureText({ kind: "pictureRefused", because: "adult", addedIndex: 1 }, added),
    ).toBe(
      "The picture on “Tenet” cannot go in the public feed. Change it, or keep this list private.",
    );
    expect(rankingFailureText({ kind: "pictureRefused", because: null }, added)).toMatch(
      /^One of your photos cannot go in the public feed/,
    );
  });

  it("says publishing's words for a day's pictures and a refusal, a ranking's for the rest", () => {
    expect(
      rankingFailureText({ kind: "tooManyRequests", code: "WEB_PICTURES_DAILY_LIMIT" }),
    ).toMatch(/^This list has more pictures from other sites than this account can publish today/);
    expect(
      rankingFailureText({ kind: "invalid", detail: null, code: null, field: "addedCards" }),
    ).toBe("The list was refused.");
    expect(rankingFailureText({ kind: "sourceChanged" })).toMatch(/changed/i);
    expect(rankingFailureText({ kind: "banned", until: null })).toMatch(/moderator/i);
    expect(rankingFailureText({ kind: "unknown", status: 500 })).toBe(
      "Could not save the ranking. Nothing was lost. Try again.",
    );
  });
});
