import type { ApiError } from "../../api/errors";
import { strings } from "../../strings";

/**
 * Why a feed is not there, in words that name the cause: no connection, a
 * browser App Check could not vouch for (audit A1: it read "Could not load"
 * or "Check your connection" while the connection was fine), or anything else.
 */
export function FeedTroubleText({ kind }: { kind: ApiError["kind"] }) {
  if (kind === "offline") return <p>{strings.feed.offline}</p>;
  if (kind === "appUnverified") {
    return (
      <>
        <p>{strings.feed.unverified}</p>
        <p className="feed__trouble-help">{strings.feed.unverifiedHelp}</p>
      </>
    );
  }
  return <p>{strings.feed.failed}</p>;
}
