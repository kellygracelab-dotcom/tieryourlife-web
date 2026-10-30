import { useEffect, useId, useMemo, useRef } from "react";
import { plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { PlayBoard } from "./board";
import { keptTier } from "./chosen";
import { answered, dashedIds, isThinResult, refineCount, resultOf, type Game } from "./game";
import { thinText } from "./labels";
import { PHONE, SIDEWAYS, useMedia } from "./media";
import { ResultPreview } from "./ResultPreview";
import "./play.css";

interface ResultViewProps {
  game: Game;
  board: PlayBoard;
  /** Somebody else's list: Apply puts the result into Mine. */
  theirs: boolean;
  /** The result, one row of card ids per tier of the board; the played cards only. */
  onApply: (tiers: string[][]) => void;
  onRefine: () => void;
  onPlayAgain: () => void;
  onCancel: () => void;
  /** The header's close: the finished game is kept, as a quit duel is. */
  onQuit: () => void;
}

/**
 * The bar's height on the root while it is up, for the snackbar, which is the
 * page's, to stand above it (play.css). A ref callback: it follows the bar
 * in and out, and lets go of the height when the bar goes.
 */
function followHeight(bar: HTMLDivElement | null) {
  if (bar === null || typeof ResizeObserver !== "function") return;
  const root = document.documentElement;
  const observer = new ResizeObserver(() =>
    root.style.setProperty("--play-bar-h", `${bar.offsetHeight}px`),
  );
  observer.observe(bar);
  return () => {
    observer.disconnect();
    root.style.removeProperty("--play-bar-h");
  };
}

/**
 * "Your result": the board the duels make, honest about the cards it is
 * unsure of, under a header of its own as on the app, with the buttons in a
 * bar pinned at the foot: Apply, Refine while it can still help, Play again
 * and Cancel. When every duel was skipped there is nothing to apply, and it
 * says so instead. Held sideways it is two columns: the words and buttons,
 * and the tiers beside them.
 */
export function ResultView({
  game,
  board,
  theirs,
  onApply,
  onRefine,
  onPlayAgain,
  onCancel,
  onQuit,
}: ResultViewProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const phone = useMedia(PHONE);
  const sideways = useMedia(SIDEWAYS);

  const rows = useMemo(() => resultOf(game, board), [game, board]);
  const dashed = useMemo(() => dashedIds(game), [game]);
  const thin = useMemo(() => isThinResult(game), [game]);
  const refine = useMemo(() => refineCount(game), [game]);
  const duels = answered(game);
  const nothing = duels === 0;

  const apply = (
    <Button
      variant="filled"
      className="result-view__apply"
      onClick={() => onApply(rows.map((row) => [...row]))}
    >
      {theirs ? strings.play.putInMine : strings.play.apply}
    </Button>
  );
  const refineButton = (label: string) =>
    refine > 0 && (
      <button type="button" className="btn play-outlined result-view__refine" onClick={onRefine}>
        <span>{label}</span>
      </button>
    );
  const playAgain = <Button onClick={onPlayAgain}>{strings.play.playAgain}</Button>;
  const cancel = <Button onClick={onCancel}>{strings.play.cancel}</Button>;

  const actions = sideways ? (
    // The app's sideways column: Apply across, the rest in one row under it.
    <>
      {apply}
      <span className="result-view__row">
        {refineButton(strings.play.refine)}
        <span className="result-view__gap" />
        {playAgain}
        {cancel}
      </span>
    </>
  ) : phone ? (
    <>
      {apply}
      {refineButton(plural(strings.play.refineUpTo, refine))}
      <span className="result-view__pair">
        {playAgain}
        {cancel}
      </span>
    </>
  ) : (
    <>
      {cancel}
      <span className="result-view__gap" />
      {playAgain}
      {refine > 0 && (
        <span className="result-view__more">{plural(strings.play.refineMore, refine)}</span>
      )}
      {refineButton(strings.play.refine)}
      {apply}
    </>
  );

  return (
    <section
      className={sideways ? "result-view result-view--side" : "result-view"}
      aria-labelledby={`${id}-title`}
    >
      <header className="result-view__head">
        <button
          type="button"
          className="duel__icon"
          aria-label={strings.play.quit}
          onClick={onQuit}
        >
          <Icon name="close" />
        </button>
        <span className="result-view__heading">
          <h2 ref={heading} id={`${id}-title`} className="result-view__title" tabIndex={-1}>
            {strings.play.yourResult}
          </h2>
          <span className="result-view__from">{plural(strings.play.fromDuels, duels)}</span>
        </span>
      </header>
      <div className="result-view__body">
        {nothing ? (
          <div className="result-view__nothing">
            <Icon name="skip_next" className="result-view__nothing-icon" />
            <p className="result-view__nothing-text">{strings.play.nothingToApply}</p>
            <span className="result-view__nothing-actions">
              <Button variant="filled" onClick={onPlayAgain}>
                {strings.play.playAgain}
              </Button>
              {cancel}
            </span>
          </div>
        ) : (
          <>
            <div className="result-view__notes">
              {thin && (
                <p className="result-view__thin">
                  <Icon name="info" className="result-view__thin-icon" />
                  <span>{thinText(dashed.size, refine)}</span>
                </p>
              )}
              {dashed.size > 0 && (
                <p className="result-view__legend">
                  <span className="result-view__swatch" aria-hidden="true" />
                  {strings.play.dashedLegend}
                </p>
              )}
            </div>
            <div className="result-view__tiers">
              <ResultPreview
                board={board}
                rows={rows}
                dashed={dashed}
                only={keptTier(board, game.chosen)}
              />
            </div>
          </>
        )}
      </div>
      {!nothing && (
        <div ref={followHeight} className="result-view__bar">
          {actions}
        </div>
      )}
    </section>
  );
}
