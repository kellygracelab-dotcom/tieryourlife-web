/**
 * The accounts whose lists stand without an author, the way a template does.
 * The page's own code keeps the same set in src/lib/editorial.ts; a test holds
 * the two together. What a chat unfurls and what a ranking keeps must name
 * nobody either, or the name hidden on the page is one link preview away.
 *
 * When the backend says so itself, `anonymous` on the list does the same.
 */
export const EDITORIAL_UIDS: readonly string[] = ["85RRieyLyUPCEqHjdYCdxVlWxHx2"];

export const isEditorialList = (
  list: { authorUid?: unknown; anonymous?: unknown } | null | undefined,
): boolean =>
  list != null &&
  (list.anonymous === true ||
    (typeof list.authorUid === "string" && EDITORIAL_UIDS.includes(list.authorUid)));
