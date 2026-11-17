import type { FoundPicture } from "../../api/pictures";

/**
 * Whom a result's picture names, short, under it: "Rosino, CC BY-SA" (artboard
 * 23). The whole line stays on hover and in About the picture; a bare address
 * is never shown as a name.
 */
export function shortCredit(found: Pick<FoundPicture, "credit" | "attribution">): string | null {
  const author = found.attribution?.author?.trim();
  if (author !== undefined && author !== "") {
    const license = found.attribution?.license?.replace(/\s+v?\d+(\.\d+)*$/, "").trim();
    return [author, license].filter(Boolean).join(", ");
  }
  const credit = found.credit?.trim();
  if (credit === undefined || credit === "" || /^(https?:)?\/\//i.test(credit)) return null;
  return credit;
}
