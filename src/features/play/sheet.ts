import { createContext } from "react";

/**
 * Whether a sheet coming in is the sheet arriving, or a page of one already
 * open: the picker and its choice of cards are pages of one sheet, so going
 * between them must not slide it in again.
 */
export const SheetArrival = createContext(true);

/** The sheet's own way out, exit and all, for a Cancel among its buttons. */
export const SheetLeave = createContext<() => void>(() => undefined);

/** The design's exit, 200 ms; less motion, a 90 ms fade. */
export const LEAVE_MS = 200;
export const LEAVE_REDUCED_MS = 90;
