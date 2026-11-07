import type { ApiError } from "../../api/errors";
import { currentLocale, fill, strings } from "../../strings";

/**
 * What a refused publish says, in the page's own words. The proxy's own
 * reason is English, so it is not passed on.
 */
/** What the proxy says when a list has more pictures from other sites than it fetches for one (QA S11). */
export const WEB_PICTURES_TOO_MANY = "Too many pictures from other sites";

/**
 * [titleOf] names the card a refused picture from another site is on, when
 * the caller has the cards: the person is told which one to change.
 */
export function failureText(
  error: ApiError,
  mode: "new" | "edit",
  titleOf: (imageUrl: string) => string | null = () => null,
): string {
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
    case "pictureRefused": {
      const title = error.imageUrl === undefined ? null : titleOf(error.imageUrl);
      return title === null
        ? strings.new.failedPictureRefused
        : fill(strings.new.failedPictureRefusedCard, { title });
    }
    case "publicationChanged":
      return strings.new.publicationChanged;
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
      return error.detail === WEB_PICTURES_TOO_MANY
        ? strings.new.failedWebPicturesTooMany
        : strings.new.failedTooLarge;
    // The account's pictures from other sites for today are used up; nothing was published.
    case "tooManyRequests":
      return error.code === "WEB_PICTURES_DAILY_LIMIT"
        ? strings.new.failedWebPicturesToday
        : strings.new.failedOther;
    // A section that no longer takes lists is changed under Category, so the text says where.
    // More tiers than the feed takes says what to change: the limit itself.
    case "invalid":
      if (error.code === "TOO_MANY_TIERS") return strings.new.tooManyTiers;
      return error.field === "category" ? strings.new.failedCategory : strings.new.failedInvalid;
    default:
      return strings.new.failedOther;
  }
}
