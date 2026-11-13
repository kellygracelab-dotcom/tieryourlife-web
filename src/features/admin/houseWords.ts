import type { ApiError } from "../../api/errors";
import type { PublishRequest } from "../../api/lists";
import { fill, strings } from "../../strings";
import type { PublishProblem } from "../boards/publish";

/** Whether a house list is going out for the first time, or over one already out. */
export type HouseSend = "publish" | "replace";

/** Why a board cannot go out, in the words its own settings use. */
export function problemText(problem: PublishProblem): string {
  switch (problem) {
    case "category":
      return strings.new.needCategory;
    case "noItems":
      return strings.boards.needsItems;
    case "tooManyTiers":
      return strings.new.tooManyTiers;
    case "tooManyItems":
      return strings.new.tooManyCards;
  }
}

/** Staff are told the proxy's own reason too, as it gave it. */
const withDetail = (text: string, detail: string | null): string =>
  detail === null || detail === "" ? text : `${text} ${detail}`;

/**
 * What a refused publish or replace says. The backend refuses these as it
 * refuses any publish; a 403 means the one asking is not staff, or, for a
 * replace, that the list is not the house's.
 */
export function failureText(error: ApiError, kind: HouseSend): string {
  switch (error.kind) {
    case "invalid":
      return withDetail(
        error.code === "TOO_MANY_TIERS" ? strings.new.tooManyTiers : strings.new.failedInvalid,
        error.detail,
      );
    case "publicationChanged":
      return strings.new.publicationChanged;
    case "tooLarge":
      return withDetail(strings.new.failedTooLarge, error.detail);
    case "pictureRefused":
      return strings.admin.housePictureRefused;
    case "tooManyRequests":
      if (error.code === "WEB_PICTURES_DAILY_LIMIT") return strings.new.failedWebPicturesToday;
      break;
    case "notYours":
      return kind === "publish" ? strings.admin.houseStaffOnly : strings.admin.houseNotHouse;
    case "notFound":
      if (kind === "replace") return strings.new.listGone;
      break;
  }
  return kind === "publish" ? strings.admin.houseFailed : strings.admin.houseReplaceFailed;
}

/** Why the backend would not keep an editor's credit (BAD_ATTRIBUTION), in words. */
const WHY: Readonly<Record<string, keyof typeof strings.credit.why>> = {
  NO_LICENSE: "noLicense",
  UNKNOWN_LICENSE: "unknownLicense",
  NO_LINK: "noLink",
  BAD_LINK: "badLink",
  BAD_LICENSE_URL: "badLicenseUrl",
  TOO_LONG: "tooLong",
};

/**
 * A refused editor's credit, said of the card it is on (by its place in what
 * was sent) or of the cover; null for any other refusal, and for one that
 * names neither.
 */
export function creditRefusalText(error: ApiError, request: PublishRequest): string | null {
  if (error.kind !== "invalid" || error.code !== "BAD_ATTRIBUTION") return null;
  const why = strings.credit.why[WHY[error.why ?? ""] ?? "other"];
  if (error.cover === true) return fill(strings.credit.refusedCover, { why });
  const card = error.itemIndex === undefined ? undefined : request.items[error.itemIndex];
  return card === undefined ? null : fill(strings.credit.refused, { name: card.title, why });
}
