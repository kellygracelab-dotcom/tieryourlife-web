/**
 * The accounts whose lists stand without an author, the way a template does:
 * no name, no face, no way to the author's page and no following. A uid is as
 * public as any author's, every list carries it. The site's own server keeps
 * the same set in functions/src/editorial.ts, and the app keeps it too, so a
 * list looks the same wherever it is opened.
 *
 * When the backend says so itself, `anonymous` on the list does the same.
 */
export const EDITORIAL_UIDS: readonly string[] = ["85RRieyLyUPCEqHjdYCdxVlWxHx2"];

export const isEditorialAuthor = (uid: string | null | undefined): boolean =>
  typeof uid === "string" && EDITORIAL_UIDS.includes(uid);

/** Whether the list is shown without its author. */
export const isEditorial = (list: { authorUid?: string | null; anonymous?: boolean }): boolean =>
  list.anonymous === true || isEditorialAuthor(list.authorUid);
