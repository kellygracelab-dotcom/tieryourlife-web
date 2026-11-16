import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { isBehind, isOut, liveItems, type Board } from "./model";
import "./boards.css";

/** What the board's header offers to send out, if anything. */
export type PublishKind = "publish" | "update" | "share";

/**
 * The header's offer, the same as the sheet's own button: one's own list not
 * out goes out (Publish); a copy of somebody else's list goes into that
 * list's Rankings (Show in Rankings); out with changes not sent, Update.
 * Out and up to date, or empty, or the house's, nothing.
 */
export function publishKindOf(board: Board, house: boolean): PublishKind | null {
  if (house || liveItems(board).length === 0) return null;
  if (isOut(board)) return isBehind(board) ? "update" : null;
  return board.takenFrom !== null ? "share" : "publish";
}

const LOOKS: Record<PublishKind, { icon: IconName; word: string }> = {
  publish: { icon: "publish", word: strings.new.publish },
  update: { icon: "cloud_upload", word: strings.boards.update },
  share: { icon: "leaderboard", word: strings.rankings.progressShare },
};

interface PublishButtonProps {
  kind: PublishKind;
  /** Every card placed: the board's main step now, filled; Play stays outlined beside it. */
  main: boolean;
  /** On its way: the button says so and waits. */
  busy?: boolean;
  onClick: () => void;
}

/**
 * Beside Play on the board's header (Danylo and Android, 16.11.2026): it
 * publishes or updates from the board itself, no sheet in between. Tonal
 * while cards wait in the pool, filled once all are placed. Its word is always in
 * sight, on a phone too: an arrow alone read as upload or share.
 */
export function PublishButton({ kind, main, busy = false, onClick }: PublishButtonProps) {
  const { icon, word } = LOOKS[kind];
  return (
    <button
      type="button"
      className={`btn publish-button ${main ? "btn--filled publish-button--main" : "btn--tonal"}`}
      disabled={busy}
      onClick={onClick}
    >
      <Icon name={icon} className="btn__icon" />
      <span className="publish-button__word">
        {busy ? (kind === "update" ? strings.boards.updating : strings.boards.publishing) : word}
      </span>
    </button>
  );
}
