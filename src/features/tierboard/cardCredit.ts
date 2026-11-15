import { createContext } from "react";
import type { EditorCredit } from "../../api/pictureAttribution";
import type { CoverFocus } from "../../lib/coverFocus";

/**
 * A house board's way to credit a card's picture, by the card's number, or
 * with null to take the editor's credit off; null on every other board,
 * whose credits are only read.
 */
export const CardCredit = createContext<
  ((item: number, credit: EditorCredit | null) => void) | null
>(null);

/**
 * The owner's way to place a card's picture in its tile (Adjust picture), by
 * the card's number, or with null for the picture's default; null wherever
 * the cards are only looked at.
 */
export const CardFocusing = createContext<
  ((item: number, focus: CoverFocus | null) => void) | null
>(null);
