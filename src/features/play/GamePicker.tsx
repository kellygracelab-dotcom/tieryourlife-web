import { useId, useState } from "react";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { playable } from "./chosen";
import type { GameKind } from "./engine";
import { gameProgress, type Resume } from "./game";
import { estimateText, gameName, startedText } from "./labels";
import { PlaySheet, SheetCancel } from "./PlaySheet";

/** The games in the picker's order, smart first, with the app's icons. */
const GAMES: readonly { kind: GameKind; icon: IconName; line: () => string }[] = [
  { kind: "smart", icon: "auto_awesome", line: () => strings.play.smartLine },
  { kind: "swiss", icon: "autorenew", line: () => strings.play.swissLine },
  { kind: "hill", icon: "crown", line: () => strings.play.hillLine },
  { kind: "bracket", icon: "account_tree", line: () => strings.play.bracketLine },
];

interface GamePickerProps {
  /** A part of the board the game is over, for "12 cards from S"; null for the whole board. */
  from: string | null;
  /** How many cards the game would be over: the chosen ones, or the whole board. */
  count: number;
  /** How many of them already stand in a tier, which a game would move. */
  placed?: number;
  kind: GameKind;
  onKind: (kind: GameKind) => void;
  /** The game saved for this board, met with the board as it is now; null when none is. */
  saved: Resume | null;
  /** Somebody else's list: the result goes into Mine. */
  theirs: boolean;
  now: number;
  onChooseCards: () => void;
  onResume: () => void;
  /** False when a tier of the saved game's area is gone: then it can only be discarded. */
  canStartAgain: boolean;
  onStartAgain: () => void;
  onDiscard: () => void;
  onStart: () => void;
  onCancel: () => void;
}

/**
 * "Play" as the phone's artboard 8 has it (audit B4): one line on what the
 * game is, the game Start begins in one line with its length, Start itself
 * large, and the other games behind "Other ways to play". Smart is the one
 * chosen until somebody picks another; then their choice opens with them.
 */
export function GamePicker({
  from,
  count,
  placed = 0,
  kind,
  onKind,
  saved,
  theirs,
  now,
  onChooseCards,
  onResume,
  canStartAgain,
  onStartAgain,
  onDiscard,
  onStart,
  onCancel,
}: GamePickerProps) {
  const id = useId();
  const fits = playable(count);
  const [others, setOthers] = useState(kind !== "smart");
  const warned = fits && placed > 0;
  const cards =
    from === null
      ? plural(strings.boards.cards, count)
      : fill(plural(strings.play.cardsFrom, count), { title: from });
  const summary = !fits
    ? strings.play.needsCards
    : kind === "smart"
      ? fill(strings.play.summary, { cards, estimate: estimateText(kind, count) })
      : fill(strings.play.summaryOf, {
          game: gameName(kind),
          cards,
          estimate: estimateText(kind, count),
        });
  return (
    <PlaySheet
      title={strings.play.play}
      subtitle={strings.play.lead}
      onClose={onCancel}
      actions={<SheetCancel />}
    >
      <div className="play-choice">
        {saved !== null && (
          <>
            <SavedRow
              saved={saved}
              now={now}
              onResume={onResume}
              onStartAgain={canStartAgain ? onStartAgain : null}
              onDiscard={onDiscard}
            />
            <p className="play-choice__label">{strings.play.newGame}</p>
          </>
        )}
        <div className="play-summary">
          <p className="play-summary__line" id={`${id}-summary`}>
            {summary}
          </p>
          {fits && <p className="play-summary__note">{strings.play.kept}</p>}
        </div>
        {warned && (
          // Cards placed by hand are moved by the game, said before Start (artboards 15, 24).
          <p className="play-placed" id={`${id}-placed`}>
            {plural(strings.play.placedWarning, placed)}
          </p>
        )}
        <Button
          variant="filled"
          className="play-start"
          onClick={onStart}
          disabled={!fits}
          aria-describedby={warned ? `${id}-summary ${id}-placed` : `${id}-summary`}
        >
          {strings.play.start}
        </Button>
        <div className="play-more">
          <button type="button" className="play-link" onClick={onChooseCards}>
            {strings.play.chooseCards}
          </button>
          <button
            type="button"
            className="play-link"
            aria-expanded={others}
            aria-controls={`${id}-games`}
            onClick={() => setOthers((open) => !open)}
          >
            {strings.play.otherWays}
            <Icon name="expand_more" className="play-more__chevron" />
          </button>
        </div>
        {others && (
          <div
            id={`${id}-games`}
            className="play-games"
            role="radiogroup"
            aria-label={strings.play.game}
          >
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
                  {fits && (
                    <span className="play-game__estimate">{estimateText(game.kind, count)}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      {theirs && <p className="play-footnote">{strings.play.intoMine}</p>}
    </PlaySheet>
  );
}

/**
 * Resume the saved participants, or offer a fresh start if a participant was
 * removed; when a tier of its area is gone, only to let it go.
 */
function SavedRow({
  saved,
  now,
  onResume,
  onStartAgain,
  onDiscard,
}: {
  saved: Resume;
  now: number;
  onResume: () => void;
  onStartAgain: (() => void) | null;
  onDiscard: () => void;
}) {
  const { game } = saved;
  const { overall } = gameProgress(game);
  const line = fill(strings.play.savedLine, {
    game: gameName(game.spec.kind),
    asked: overall.asked,
    total: overall.total,
  });
  const note = saved.kind === "changed" ? strings.play.changed : startedText(game.startedAt, now);
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
          onClick={onStartAgain ?? onDiscard}
        >
          <span>{onStartAgain === null ? strings.play.discard : strings.play.startAgain}</span>
        </button>
      ) : (
        <Button variant="tonal" className="play-tonal play-saved__action" onClick={onResume}>
          {strings.play.resume}
        </Button>
      )}
    </div>
  );
}
