import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { isBehind, isOut, liveItems, type Board } from "./model";
import "./boards.css";
import "./publishing.css";

/** What the board's header offers to send out, or shows of what is out. */
export type PublishKind = "publish" | "update" | "share" | "published";

/**
 * The header's offer: one's own list not out goes out (Publish); a copy of
 * somebody else's list goes into that list's Rankings (Show in Rankings);
 * out with changes not sent, Update; out and up to date, Published, which
 * opens the window with its link and Take it down. Nothing on an empty board
 * or the house's.
 */
export function publishKindOf(board: Board, house: boolean): PublishKind | null {
  if (house || liveItems(board).length === 0) return null;
  if (isOut(board)) return isBehind(board) ? "update" : "published";
  return board.takenFrom !== null ? "share" : "publish";
}

const LOOKS: Record<PublishKind, { icon: IconName; word: string }> = {
  publish: { icon: "publish", word: strings.new.publish },
  update: { icon: "refresh", word: strings.boards.update },
  share: { icon: "leaderboard", word: strings.rankings.progressShare },
  published: { icon: "check_circle", word: strings.boards.publishedStatus },
};

interface PublishButtonProps {
  kind: PublishKind;
  /** Every card placed: the board's main step now, filled; Play stays outlined beside it. */
  main: boolean;
  /** On its way: a ring in place of the icon, the button as wide as before. */
  busy?: boolean;
  onClick: () => void;
}

/**
 * Beside Play on the board's header (Danylo's canvas, 16.11.2026). Publish
 * opens the Publish window, tonal while cards wait in the pool and filled
 * once all are placed; Show in Rankings opens it for a copy of somebody
 * else's list; Update sends the changes at once, its dot saying there are
 * some; Published is quiet and opens the window with the link and Take it
 * down. While a publish is on its way the ring turns in the button, and a
 * press opens the window again. Its word is always in sight, on a phone too.
 */
export function PublishButton({ kind, main, busy = false, onClick }: PublishButtonProps) {
  const { icon, word } = LOOKS[kind];
  const look =
    kind === "published"
      ? "btn--text publish-button--quiet"
      : main && kind === "publish"
        ? "btn--filled publish-button--main"
        : kind === "update"
          ? "btn--filled publish-button--update"
          : "btn--tonal";
  return (
    <button
      type="button"
      className={`btn publish-button ${look}`}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? (
        <span className="publish-ring" aria-hidden="true" />
      ) : (
        <Icon name={icon} className="btn__icon" />
      )}
      <span className="publish-button__word">
        {busy ? (kind === "update" ? strings.boards.updating : strings.boards.publishing) : word}
      </span>
      {kind === "update" && !busy && <span className="publish-button__dot" aria-hidden="true" />}
    </button>
  );
}
