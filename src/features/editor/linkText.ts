import type { LinkFailure, LinkRefused } from "../../lib/linkPictures";
import { searchAgainAt } from "../../lib/searchLimit";
import { fill, strings } from "../../strings";
import type { MissReason } from "./paste";

/**
 * "That's all the pictures from links for today. More at 14:00." The time is
 * the backend's retryAt, or else when its day starts again; without either,
 * tomorrow.
 */
export const linkLimitText = (retryAt: number | null, now?: number): string =>
  retryAt === null
    ? strings.link.limitTomorrow
    : fill(strings.link.limit, { time: searchAgainAt(retryAt, now) });

/** "The picture's site is busy. Try again at 14:05." */
export const busyText = (retryAt: number | null, now?: number): string =>
  retryAt === null
    ? strings.link.busySoon
    : fill(strings.link.busy, { time: searchAgainAt(retryAt, now) });

/** "Waiting for the source until 14:05…": a paste that waits for a busy site. */
export const waitingText = (until: number, now?: number): string =>
  fill(strings.link.waiting, { time: searchAgainAt(until, now) });

/** Why a picture from a link did not come, as the draft card says it. */
export function linkFailureText(reason: LinkFailure, retryAt: number | null = null): string {
  switch (reason) {
    case "notAPicture":
      return strings.link.notAPicture;
    case "unreachable":
      return strings.link.unreachable;
    case "tooBig":
      return strings.link.tooBig;
    case "refused":
      return strings.link.refused;
    case "limit":
      return linkLimitText(retryAt);
    case "busy":
      return busyText(retryAt);
    case "badLink":
      return strings.link.badPage;
    case "signIn":
      return strings.link.signInToAdd;
    case "failed":
      return strings.link.failed;
  }
}

/**
 * A refusal as the draft or the board says it. The day's limit ends at
 * retryAt, or else when the quota's day starts again; a busy site only says
 * retryAt, never the day's end.
 */
export const refusedText = (refused: LinkRefused): string =>
  linkFailureText(
    refused.reason,
    refused.reason === "busy"
      ? refused.retryAt
      : (refused.retryAt ?? refused.quota?.resetsAt ?? null),
  );

/** Why a pasted card came without a picture, short, after its name. */
export const missText = (reason: MissReason): string => strings.link.missing[reason];
