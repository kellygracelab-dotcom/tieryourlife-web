import type { Share } from "./shareImage";

export type { Share } from "./shareImage";

/**
 * The picture people download, drawn by code only the person who presses the
 * button needs: it comes as a chunk of its own on that first press.
 */
export const downloadShare: Share = async (list, rows, address) =>
  (await import("./shareImage")).downloadShare(list, rows, address);
