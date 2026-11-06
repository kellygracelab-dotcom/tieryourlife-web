import type { ApiError } from "../../api/errors";
import { currentLocale, fill, strings } from "../../strings";

/**
 * What a banned account is told when it ranks, as a publish ban is: when it
 * ends, or that it does not. Trying again would only be refused again.
 */
export function rankBanText(until: number | null): string {
  return until === null
    ? strings.rank.failedBanned
    : fill(strings.rank.failedBannedUntil, {
        date: new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(until),
      });
}

/** What a refused save of a ranking says, before any way out is offered. */
export function rankFailureText(error: ApiError): string {
  switch (error.kind) {
    case "offline":
      return strings.rank.failedOffline;
    case "notFound":
      return strings.rank.failedGone;
    case "conflict":
      return strings.rank.failedChanged;
    case "banned":
      return rankBanText(error.until);
    default:
      return strings.rank.failedOther;
  }
}
