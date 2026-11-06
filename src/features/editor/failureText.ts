import type { ApiError } from "../../api/errors";
import { currentLocale, fill, strings } from "../../strings";

/**
 * What a refused publish says, in the page's own words. The proxy's own
 * reason is English, so it is not passed on.
 */
export function failureText(error: ApiError, mode: "new" | "edit"): string {
  switch (error.kind) {
    case "offline":
      return strings.new.failedOffline;
    // A ban with an end says when it ends, as the app and the proposal form do.
    case "banned":
      return error.until === null
        ? strings.new.failedBanned
        : fill(strings.new.failedBannedUntil, {
            date: new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(
              error.until,
            ),
          });
    // Trying again sends the same photo: the way out is to remove it or keep the list private.
    case "pictureRefused":
      return strings.new.failedPictureRefused;
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
    // A section that no longer takes lists is changed under Category, so the text says where.
    // More tiers than the feed takes says what to change: the limit itself.
    case "invalid":
      if (error.code === "TOO_MANY_TIERS") return strings.new.tooManyTiers;
      return error.field === "category" ? strings.new.failedCategory : strings.new.failedInvalid;
    default:
      return strings.new.failedOther;
  }
}
