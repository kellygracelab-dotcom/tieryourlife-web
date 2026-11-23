/**
 * The house's lists stand without an author, the way a template does: no
 * name, no face, no way to the author's page and no following. The backend
 * says so on each of them, `anonymous: true` with no author (Backend, 23.11);
 * the house's own account is told by its uid wherever only a uid is at hand.
 * A person's list is theirs, Danylo's own included: shown under his name. The
 * site's own server keeps the same set in functions/src/editorial.ts.
 */
export const EDITORIAL_UIDS: readonly string[] = ["tyl-editorial"];

export const isEditorialAuthor = (uid: string | null | undefined): boolean =>
  typeof uid === "string" && EDITORIAL_UIDS.includes(uid);

/** Whether the list is shown without its author. */
export const isEditorial = (list: { authorUid?: string | null; anonymous?: boolean }): boolean =>
  list.anonymous === true || isEditorialAuthor(list.authorUid);
