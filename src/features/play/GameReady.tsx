import { useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { fill, plural, strings } from "../../strings";
import { MediaImage } from "../../ui/MediaImage";
import { useModal } from "../../ui/useModal";
import { cardOf, type PlayBoard } from "./board";
import "./play.css";
import { shownLight } from "../../lib/tierColour";
import { cardLabel } from "../../lib/cardText";

/** How many tiers the window draws; the rest are counted under them. */
const TIERS_SHOWN = 3;
/** How many of a tier's pictures fit beside its letter. */
const CARDS_SHOWN = 5;

/** What a finished game put on the board, as the window says it. */
export interface Ready {
  /** Cards the game was over. */
  cards: number;
  /** Duels answered, skips not counted. */
  duels: number;
  /** Every tier's card ids after the result, the board's tiers in order. */
  rows: readonly (readonly string[])[];
}

/** Showing one's ranking among the list's: only on somebody else's list. */
export interface ReadyRankings {
  signedIn: boolean;
  show: () => void;
}

interface GameReadyProps {
  ready: Ready;
  board: PlayBoard;
  /** The result as a picture: shared or saved, as the board's menu does it. */
  onShare?: () => void;
  rankings?: ReadyRankings | null;
  onClose: () => void;
  onAgain: () => void;
}

/**
 * The game's end (artboard 35): the result in a few lines over the board —
 * how many cards from how many duels, the first tiers with their cards — and
 * what to do with it: look at the list, share it as a picture, show it among
 * the list's rankings, or play again. Escape, a press outside and See my list
 * close it; the result is on the board already, and the board's Undo takes
 * it back.
 */
export function GameReady({ ready, board, onShare, rankings, onClose, onAgain }: GameReadyProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose, ".game-ready__see");

  const filled = board.tiers
    .map((tier, index) => ({ tier, ids: ready.rows[index] ?? [] }))
    .filter((row) => row.ids.length > 0);
  const shown = filled.slice(0, TIERS_SHOWN);
  const more = filled.length - shown.length;
  const then = (action: () => void) => () => {
    onClose();
    action();
  };

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog dialog--narrow game-ready"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="dialog__title">
          {strings.play.readyTitle}
        </h2>
        <p className="game-ready__summary">
          {fill(strings.play.readySummary, {
            cards: plural(strings.card.items, ready.cards),
            duels: plural(strings.play.duels, ready.duels),
          })}
        </p>
        <ul className="game-ready__tiers">
          {shown.map(({ tier, ids }) => (
            <li key={tier.id} className="game-ready__tier">
              <span
                className="game-ready__band band"
                style={
                  {
                    "--band-light": shownLight(tier.colorLight),
                    "--band-dark": tier.colorDark,
                  } as CSSProperties
                }
                title={tier.caption ?? undefined}
              >
                {tier.label}
              </span>
              <span className="game-ready__cards">
                {ids.slice(0, CARDS_SHOWN).map((id) => {
                  const card = cardOf(board, id);
                  return card.imageUrl === null ? (
                    <span key={id} className="game-ready__card game-ready__card--name" dir="auto">
                      {card.name}
                    </span>
                  ) : (
                    <MediaImage
                      key={id}
                      className="game-ready__card"
                      src={card.imageUrl}
                      alt={cardLabel(card.name)}
                    />
                  );
                })}
                {ids.length > CARDS_SHOWN && (
                  <span className="game-ready__more">+{ids.length - CARDS_SHOWN}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {more > 0 && <p className="game-ready__rest">{plural(strings.card.moreTiers, more)}</p>}
        <div className="game-ready__actions">
          <button type="button" className="btn btn--filled game-ready__see" onClick={onClose}>
            <span>{strings.play.seeMyList}</span>
          </button>
          {onShare !== undefined && (
            <button type="button" className="btn btn--outlined" onClick={then(onShare)}>
              <span>{strings.boards.shareImage}</span>
            </button>
          )}
        </div>
        <div className="game-ready__links">
          {rankings != null && (
            <button type="button" className="btn btn--text" onClick={then(rankings.show)}>
              <span>
                {rankings.signedIn ? strings.rankings.progressShare : strings.play.signInToShow}
              </span>
            </button>
          )}
          <button type="button" className="btn btn--text game-ready__again" onClick={onAgain}>
            <span>{strings.play.playAgain}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
