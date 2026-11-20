import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { usage } from "./usage";
import {
  boardMade,
  cardAdded,
  FULL_LIST_CARDS,
  gameFinished,
  gameStarted,
  listFinished,
  listOpened,
  ownPicture,
  pictureFromLink,
  picturePicked,
  published,
  shared,
  signedIn,
  type SiteGame,
} from "./usageEvents";

let step: MockInstance<typeof usage.step>;
let count: MockInstance<typeof usage.count>;

beforeEach(() => {
  step = vi.spyOn(usage, "step");
  count = vi.spyOn(usage, "count");
});

afterEach(() => vi.restoreAllMocks());

describe("usage events", () => {
  it("counts a board made new as a tier list, and one taken to rank as ranked", () => {
    boardMade(false);
    expect(step).toHaveBeenCalledWith("first_board");
    expect(count).toHaveBeenCalledWith("board.tier");
    boardMade(true);
    expect(count).toHaveBeenLastCalledWith("board.ranked");
    expect(step).toHaveBeenCalledTimes(2);
  });

  it("says the newcomers' steps", () => {
    cardAdded();
    listOpened();
    signedIn();
    published();
    expect(step.mock.calls).toEqual([["first_card"], ["open_list"], ["signed_in"], ["published"]]);
    expect(count).not.toHaveBeenCalled();
  });

  it("finishes a list of five cards and more with none left unplaced", () => {
    listFinished(FULL_LIST_CARDS - 1, 0);
    listFinished(FULL_LIST_CARDS, 1);
    listFinished(0, 0);
    expect(step).not.toHaveBeenCalled();
    listFinished(FULL_LIST_CARDS, 0);
    listFinished(40, 0);
    expect(step.mock.calls).toEqual([["full_list"], ["full_list"]]);
  });

  it("counts an image and a link shared, each a share", () => {
    shared("image");
    shared("link");
    expect(step.mock.calls).toEqual([["shared"], ["shared"]]);
    expect(count.mock.calls).toEqual([["share.image"], ["share.link"]]);
  });

  it.each<[SiteGame, string]>([
    ["smart", "smart"],
    ["hill", "king"],
    ["bracket", "bracket"],
    ["swiss", "losers"],
  ])("names the site's %s game %s, started and done", (game, mode) => {
    gameStarted(game);
    expect(count).toHaveBeenLastCalledWith(`game.${mode}.start`);
    expect(step).not.toHaveBeenCalled();
    gameFinished(game);
    expect(count).toHaveBeenLastCalledWith(`game.${mode}.done`);
    expect(step).toHaveBeenCalledWith("first_game");
  });

  it("counts the pictures by where they came from", () => {
    ownPicture();
    pictureFromLink();
    expect(count.mock.calls).toEqual([["picture.own"], ["picture.link"]]);
  });

  it("counts a picture picked from search by its catalogue and its place", () => {
    picturePicked("tmdb", 0);
    picturePicked("steam", 2);
    picturePicked("wikidata", 12);
    expect(count.mock.calls).toEqual([
      ["picture.pick.tmdb"],
      ["picture.pos.1"],
      ["picture.pick.other"],
      ["picture.pos.2-3"],
      ["picture.pick.wikidata"],
      ["picture.pos.11+"],
    ]);
  });
});
