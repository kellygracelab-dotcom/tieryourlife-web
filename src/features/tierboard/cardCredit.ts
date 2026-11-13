import { createContext } from "react";
import type { EditorCredit } from "../../api/pictureAttribution";

/**
 * A house board's way to credit a card's picture, by the card's number, or
 * with null to take the editor's credit off; null on every other board,
 * whose credits are only read.
 */
export const CardCredit = createContext<
  ((item: number, credit: EditorCredit | null) => void) | null
>(null);
