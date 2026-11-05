import type { ApiError } from "../../api/errors";
import { strings } from "../../strings";

/**
 * What a refused publish says, in the page's own words. The proxy's own
 * reason is English, so it is not passed on.
 */
export function failureText(error: ApiError, mode: "new" | "edit"): string {
  switch (error.kind) {
    case "offline":
      return strings.new.failedOffline;
    case "banned":
      return strings.new.failedBanned;
    case "tooManyLists":
      return strings.new.failedTooMany;
    case "tooManyTopics":
      return strings.boards.topicTooMany;
    case "notSignedIn":
    case "unauthenticated":
      return strings.new.failedSignedOut;
    case "notFound":
      return mode === "edit" ? strings.new.failedGone : strings.new.failedOther;
    case "notYours":
      return strings.new.notYours;
    case "tooLarge":
      return strings.new.failedTooLarge;
    case "invalid":
      return strings.new.failedInvalid;
    default:
      return strings.new.failedOther;
  }
}
