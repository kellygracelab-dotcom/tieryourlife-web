import { createContext } from "react";
import type { Dock } from "./dock";

/**
 * What a page lends the board: a place in its header for the count, Undo and
 * Finish while the pool is docked under the board, and an ear for which shape
 * the board took, so the page can lay its header out to match.
 */
export interface BoardFrame {
  headSlot: HTMLElement | null;
  /** The board says which shape it has on a wide screen; null when it has none (a phone, or gone). */
  report: (dock: Dock | null) => void;
  /** The count and Undo go in the header on a phone too: one's own list's one-row head (artboard 18). */
  phoneHead?: boolean;
}

export const BoardFrameContext = createContext<BoardFrame>({
  headSlot: null,
  report: () => undefined,
});
