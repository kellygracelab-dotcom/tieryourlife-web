import { usage } from "./usage";
import { pickedAt, pickedFrom, type GameMode } from "./usageLedger";

/**
 * What the pages count, in the contract's words (proxy CONTRACT.md, Usage
 * statistics), each said once where it really happened: a step is a
 * newcomer's, sent once ever, so saying it again costs nothing; a count is
 * one per call, so it goes where the thing went through, never in a render.
 */

/** The site's games by its engine's names (features/play/engine's GameKind). */
export type SiteGame = "smart" | "hill" | "bracket" | "swiss";

/** As the server and the phone name them: Hill is King of the hill, Swiss is Losers stay. */
export const GAME_MODES: Readonly<Record<SiteGame, GameMode>> = {
  smart: "smart",
  hill: "king",
  bracket: "bracket",
  swiss: "losers",
};

/** A list is finished with this many cards and more, none left unplaced. */
export const FULL_LIST_CARDS = 5;

/** A board of one's own: made new (a tier list), or taken from somebody's list to rank. */
export function boardMade(ranked: boolean): void {
  usage.step("first_board");
  usage.count(ranked ? "board.ranked" : "board.tier");
}

/** A card added to a board. */
export const cardAdded = (): void => usage.step("first_card");

/** After a card is placed or moved: `cards` on the board, `unplaced` of them still in the pool. */
export function listFinished(cards: number, unplaced: number): void {
  if (cards >= FULL_LIST_CARDS && unplaced === 0) usage.step("full_list");
}

/** An image or a link handed on: the share sheet, a saved picture, the clipboard. */
export function shared(kind: "image" | "link"): void {
  usage.step("shared");
  usage.count(kind === "image" ? "share.image" : "share.link");
}

export const gameStarted = (game: SiteGame): void => usage.count(`game.${GAME_MODES[game]}.start`);

/** Played to its result, the result on the board. */
export function gameFinished(game: SiteGame): void {
  usage.count(`game.${GAME_MODES[game]}.done`);
  usage.step("first_game");
}

/** Somebody else's list, or a house list, opened. */
export const listOpened = (): void => usage.step("open_list");

export const signedIn = (): void => usage.step("signed_in");

export const published = (): void => usage.step("published");

/** One's own photo put on a card. */
export const ownPicture = (): void => usage.count("picture.own");

/** A picture from an address pasted, dropped or typed. */
export const pictureFromLink = (): void => usage.count("picture.link");

/** A picture chosen from search: its catalogue, and its place in the results from 0. */
export function picturePicked(source: string, index: number): void {
  usage.count(pickedFrom(source));
  usage.count(pickedAt(index));
}
