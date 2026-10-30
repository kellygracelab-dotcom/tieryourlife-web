import { useId } from "react";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { playable } from "./chosen";
import type { GameKind } from "./engine";
import { gameProgress, type Resume } from "./game";
import { estimateText, gameName, startedText } from "./labels";
import { PlaySheet, SheetCancel } from "./PlaySheet";

/** The three games in the picker's order, losers stay first, with the app's icons. */
const GAMES: readonly { kind: GameKind; icon: IconName; line: () => string }[] = [
  { kind: "swiss", icon: "autorenew", line: () => strings.play.swissLine },
  { kind: "hill", icon: "crown", line: () => strings.play.hillLine },
  { kind: "bracket", icon: "account_tree", line: () => strings.play.bracketLine },
];

interface GamePickerProps {
  /** The board's name, for "34 cards from Sci-fi films". */
  title: string;
  /** How many cards the game would be over: the chosen ones, or the whole board. */
  count: number;
  kind: GameKind;
  onKind: (kind: GameKind) => void;
  /** The game saved for this board, met with the board as it is now; null when none is. */
  saved: Resume | null;
  /** Somebody else's list: the result goes into Mine. */
  theirs: boolean;
  now: number;
  onChooseCards: () => void;
  onResume: () => void;
  onStartAgain: () => void;
  onStart: () => void;
  onCancel: () => void;
}

/** "Play": which game, over which cards, or the saved one. */
export function GamePicker({
  title,
  count,
  kind,
  onKind,
  saved,
  theirs,
  now,
  onChooseCards,
  onResume,
  onStartAgain,
  onStart,
  onCancel,
}: GamePickerProps) {
  const id = useId();
  const subtitle = (
    <>
      <span>{fill(plural(strings.play.cardsFrom, count), { title })}</span>{" "}
      <button type="button" className="play-link" onClick={onChooseCards}>
        {strings.play.chooseCards}
      </button>
    </>
  );
  return (
    <PlaySheet
      title={strings.play.play}
      subtitle={subtitle}
      onClose={onCancel}
      actions={
        <>
          <SheetCancel />
          <Button
            variant="tonal"
            className="play-tonal"
            onClick={onStart}
            disabled={!playable(count)}
          >
            {strings.play.start}
          </Button>
        </>
      }
    >
      <div className="play-choice">
        {saved !== null && (
          <>
            <SavedRow saved={saved} now={now} onResume={onResume} onStartAgain={onStartAgain} />
            <p className="play-choice__label">{strings.play.newGame}</p>
          </>
        )}
        <div className="play-games" role="radiogroup" aria-label={strings.play.game}>
          {GAMES.map((game) => (
            <label key={game.kind} className="play-game">
              <input
                type="radio"
                name={`${id}-game`}
                className="play-game__input"
                checked={kind === game.kind}
                onChange={() => onKind(game.kind)}
              />
              <span className="play-radio" aria-hidden="true" />
              <span className="play-game__icon" aria-hidden="true">
                <Icon name={game.icon} />
              </span>
              <span className="play-game__text">
                <span className="play-game__name">{gameName(game.kind)}</span>
                <span className="play-game__line">{game.line()}</span>
                <span className="play-game__estimate">{estimateText(game.kind, count)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {theirs && <p className="play-footnote">{strings.play.intoMine}</p>}
    </PlaySheet>
  );
}

/**
 * The saved game, above the choice. Losers stay takes new cards in from its
 * next round and goes on; a hill or a bracket drew its order from the cards
 * it began with, so once they changed it starts again.
 */
function SavedRow({
  saved,
  now,
  onResume,
  onStartAgain,
}: {
  saved: Resume;
  now: number;
  onResume: () => void;
  onStartAgain: () => void;
}) {
  const { game } = saved;
  const { overall } = gameProgress(game);
  const line = fill(strings.play.savedLine, {
    game: gameName(game.spec.kind),
    asked: overall.asked,
    total: overall.total,
  });
  const note =
    saved.kind === "changed"
      ? strings.play.changed
      : saved.joined > 0
        ? plural(strings.play.joining, saved.joined)
        : startedText(game.startedAt, now);
  return (
    <div className="play-saved">
      <Icon name="history" className="play-saved__icon" />
      <span className="play-saved__text">
        <span className="play-saved__line">{line}</span>
        <span className="play-saved__note">{note}</span>
      </span>
      {saved.kind === "changed" ? (
        <button
          type="button"
          className="btn play-outlined play-saved__action"
          onClick={onStartAgain}
        >
          <span>{strings.play.startAgain}</span>
        </button>
      ) : (
        <Button variant="tonal" className="play-tonal play-saved__action" onClick={onResume}>
          {strings.play.resume}
        </Button>
      )}
    </div>
  );
}
