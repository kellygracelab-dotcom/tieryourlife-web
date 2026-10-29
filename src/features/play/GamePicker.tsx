import { useId } from "react";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { playable } from "./chosen";
import type { GameKind } from "./engine";
import { gameProgress, type Resume } from "./game";
import { estimateText, gameName, startedText } from "./labels";
import { PlaySheet } from "./PlaySheet";

/**
 * The three games in the picker's order, losers stay first. The design asks
 * for autorenew, crown and account_tree; the site's icon font carries none of
 * them, so the nearest it has stand in: refresh, the trophy, the podium.
 */
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
  onStartOver: () => void;
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
  onStartOver,
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
          <Button onClick={onCancel}>{strings.play.cancel}</Button>
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
      {saved !== null && (
        <SavedRow saved={saved} now={now} onResume={onResume} onStartOver={onStartOver} />
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
            <Icon name={game.icon} className="play-game__icon" />
            <span className="play-game__text">
              <span className="play-game__name">{gameName(game.kind)}</span>
              <span className="play-game__line">{game.line()}</span>
            </span>
            <span className="play-game__estimate">{estimateText(game.kind, count)}</span>
          </label>
        ))}
      </div>
      {theirs && <p className="play-footnote">{strings.play.intoMine}</p>}
    </PlaySheet>
  );
}

/** The saved game, above the choice: resumed as it is, or started over when the board moved under it. */
function SavedRow({
  saved,
  now,
  onResume,
  onStartOver,
}: {
  saved: Resume;
  now: number;
  onResume: () => void;
  onStartOver: () => void;
}) {
  const { game } = saved;
  const { overall } = gameProgress(game);
  const line = fill(strings.play.savedLine, {
    game: gameName(game.spec.kind),
    asked: overall.asked,
    total: overall.total,
  });
  const notes =
    saved.kind === "changed"
      ? [strings.play.changed]
      : [
          startedText(game.startedAt, now),
          ...(saved.joined > 0 ? [plural(strings.play.joining, saved.joined)] : []),
        ];
  return (
    <div className="play-saved">
      <Icon name="history" className="play-saved__icon" />
      <span className="play-saved__text">
        <span className="play-saved__line">{line}</span>
        {notes.map((note) => (
          <span key={note} className="play-saved__note">
            {note}
          </span>
        ))}
      </span>
      {saved.kind === "changed" ? (
        <Button variant="tonal" className="play-tonal play-saved__action" onClick={onStartOver}>
          {strings.play.startOver}
        </Button>
      ) : (
        <Button variant="tonal" className="play-tonal play-saved__action" onClick={onResume}>
          {strings.play.resume}
        </Button>
      )}
    </div>
  );
}
