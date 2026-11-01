import type { ApiError } from "../../api/errors";
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

/**
 * What a refused publish or replace says. The backend refuses these as it
 * refuses any publish; a 403 means the one asking is not staff, or, for a
 * replace, that the list is not the house's.
 */
export function failureText(error: ApiError, kind: HouseSend): string {
  switch (error.kind) {
    case "invalid":
      return fill(strings.new.failedInvalid, { detail: error.detail ?? "" }).trim();
    case "tooLarge":
      return fill(strings.new.failedTooLarge, { detail: error.detail ?? "" }).trim();
    case "pictureRefused":
      return strings.admin.housePictureRefused;
    case "notYours":
      return kind === "publish" ? strings.admin.houseStaffOnly : strings.admin.houseNotHouse;
    case "notFound":
      if (kind === "replace") return strings.new.listGone;
      break;
  }
  return kind === "publish" ? strings.admin.houseFailed : strings.admin.houseReplaceFailed;
}
