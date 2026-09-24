import type { ApiError } from "../../api/errors";
import { fill, strings } from "../../strings";

/** What a refused publish says, in the page's own words. */
export function failureText(error: ApiError, mode: "new" | "edit"): string {
  switch (error.kind) {
    case "offline":
      return strings.new.failedOffline;
    case "banned":
      return strings.new.failedBanned;
    case "tooManyLists":
      return strings.new.failedTooMany;
    case "notSignedIn":
    case "unauthenticated":
      return strings.new.failedSignedOut;
    case "notFound":
      return mode === "edit" ? strings.new.failedGone : strings.new.failedOther;
    case "notYours":
      return strings.new.notYours;
    case "tooLarge":
      return fill(strings.new.failedTooLarge, { detail: error.detail ?? "" }).trim();
    case "invalid":
      return fill(strings.new.failedInvalid, { detail: error.detail ?? "" }).trim();
    default:
      return strings.new.failedOther;
  }
}
