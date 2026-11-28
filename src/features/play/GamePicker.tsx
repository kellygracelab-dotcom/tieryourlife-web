import { useId } from "react";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { playable } from "./chosen";
import type { GameKind } from "./engine";
import { estimate, gameProgress, type Resume } from "./game";
import { gameName, startedText } from "./labels";
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
  /** Those were placed by the list's author, on a visitor's game (QA 19.11). */
  placedByAuthor?: boolean;
  /** A house list: the site's own, with no author to name (walk 25.11). */
  house?: boolean;
  kind: GameKind;
  onKind: (kind: GameKind) => void;
  /** The game saved for this board, met with the board as it is now; null when none is. */
  saved: Resume | null;
  /** Somebody else's list: the result goes into one's own version. */
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
 * "Play" with its four games side by side (Designer's variant B, chosen by
 * Danylo 28.11): each game a tile with its icon, its time largest, its name,
 * one line and its duels; the chosen one filled. The cards a game is over are
 * a chip by the title, which opens Choose cards, and Start says what it
 * starts. A saved game comes first, as the window's main action; Start is
 * then outlined and starts a new one. Smart is chosen until somebody picks
 * another; then their choice opens with them.
 */
export function GamePicker({
  from,
  count,
  placed = 0,
  placedByAuthor = false,
  house = false,
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
  const warned = fits && placed > 0;
  const cards =
    from === null
      ? plural(strings.play.allCards, count)
      : fill(plural(strings.play.cardsFrom, count), { title: from });
  // A saved game that can go on is the main action; Start then begins a new one.
  const resumable = saved !== null && saved.kind !== "changed";
  const minutes = (game: GameKind) => plural(strings.play.minutes, estimate(game, count).minutes);
  const start = fits
    ? fill(resumable ? strings.play.startNew : strings.play.startGame, {
        game: gameName(kind),
        time: minutes(kind),
      })
    : strings.play.start;
  const described = [!fits && `${id}-needs`, warned && `${id}-placed`].filter(Boolean).join(" ");
  return (
    <PlaySheet
      title={strings.play.play}
      subtitle={strings.play.lead}
      wide
      onClose={onCancel}
      aside={
        <button
          type="button"
          className="play-cards"
          aria-label={`${cards}, ${strings.play.chooseCards}`}
          onClick={onChooseCards}
        >
          <span>{cards}</span>
          <Icon name="expand_more" className="play-cards__chevron" />
        </button>
      }
      actions={
        <>
          <SheetCancel />
          <Button
            variant={resumable ? "outlined" : "filled"}
            className={resumable ? "play-start play-start--new" : "play-start"}
            onClick={onStart}
            disabled={!fits}
            aria-describedby={described === "" ? undefined : described}
          >
            {start}
          </Button>
        </>
      }
      after={fits ? <p className="play-kept">{strings.play.kept}</p> : undefined}
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
        <div className="play-tiles" role="radiogroup" aria-label={strings.play.game}>
          {GAMES.map((game) => {
            const { duels, rough } = estimate(game.kind, count);
            return (
              <label key={game.kind} className="play-tile">
                <input
                  type="radio"
                  name={`${id}-game`}
                  className="play-tile__input"
                  checked={kind === game.kind}
                  onChange={() => onKind(game.kind)}
                />
                <span className="play-tile__top">
                  <Icon name={game.icon} className="play-tile__icon" />
                  {fits && <span className="play-tile__time">{minutes(game.kind)}</span>}
                </span>
                <span className="play-tile__text">
                  <span className="play-tile__name">
                    {gameName(game.kind)}
                    {game.kind === "smart" && (
                      <span className="play-tile__badge">{strings.play.bestTiers}</span>
                    )}
                  </span>
                  <span className="play-tile__line">{game.line()}</span>
                  {fits && (
                    <span className="play-tile__duels">
                      {plural(rough ? strings.play.duelsAbout : strings.play.duels, duels)}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {!fits && (
          <p className="play-placed" id={`${id}-needs`}>
            {strings.play.needsCards}
          </p>
        )}
        {warned && (
          // Cards placed by hand are moved by the game, said before Start (artboards 15, 24).
          <p className="play-placed" id={`${id}-placed`}>
            {plural(
              !placedByAuthor
                ? strings.play.placedWarning
                : house
                  ? strings.play.placedWarningHouse
                  : strings.play.placedWarningAuthor,
              placed,
            )}
          </p>
        )}
      </div>
      {theirs && (
        <p className="play-footnote">
          {house ? strings.play.intoYoursHouse : strings.play.intoYours}
        </p>
      )}
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
  const changed = saved.kind === "changed";
  const title = changed
    ? strings.play.changed
    : fill(strings.play.yourGame, { started: startedText(game.startedAt, now) });
  const share = overall.total > 0 ? Math.min(1, overall.asked / overall.total) : 0;
  return (
    <div className={changed ? "play-saved play-saved--changed" : "play-saved"}>
      <span className="play-saved__text">
        <span className="play-saved__note">{title}</span>
        <span className="play-saved__line">{line}</span>
      </span>
      {!changed && (
        <span className="play-saved__bar" aria-hidden="true">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      )}
      {changed ? (
        <button
          type="button"
          className="btn play-outlined play-saved__action"
          onClick={onStartAgain ?? onDiscard}
        >
          <span>{onStartAgain === null ? strings.play.discard : strings.play.startAgain}</span>
        </button>
      ) : (
        <Button variant="filled" className="play-saved__action" onClick={onResume}>
          {strings.play.resume}
        </Button>
      )}
    </div>
  );
}
