import { useEffect, useId, useMemo, useRef } from "react";
import { plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { PlayBoard } from "./board";
import { keptTier } from "./chosen";
import { answered, dashedIds, isThinResult, refineCount, resultOf, type Game } from "./game";
import { thinText } from "./labels";
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
}

/**
 * "Your result": the board the duels make, honest about the cards it is
 * unsure of, with Apply, Refine while it can still help, Play again and
 * Cancel. It takes the duel screen's place in the same layer.
 */
export function ResultView({
  game,
  board,
  theirs,
  onApply,
  onRefine,
  onPlayAgain,
  onCancel,
}: ResultViewProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const rows = useMemo(() => resultOf(game, board), [game, board]);
  const dashed = useMemo(() => dashedIds(game), [game]);
  const thin = useMemo(() => isThinResult(game), [game]);
  const refine = useMemo(() => refineCount(game), [game]);

  return (
    <section className="result-view" aria-labelledby={`${id}-title`}>
      <h2 ref={heading} id={`${id}-title`} className="result-view__title" tabIndex={-1}>
        {strings.play.yourResult}
      </h2>
      <p className="result-view__from">{plural(strings.play.fromDuels, answered(game))}</p>
      {thin && (
        <p className="result-view__thin">
          <Icon name="info" className="result-view__thin-icon" />
          <span>{thinText(dashed.size, refine)}</span>
        </p>
      )}
      {dashed.size > 0 && <p className="result-view__legend">{strings.play.dashedLegend}</p>}
      <ResultPreview
        board={board}
        rows={rows}
        dashed={dashed}
        only={keptTier(board, game.chosen)}
      />
      <div className="result-view__actions">
        <Button
          variant="filled"
          className="result-view__apply"
          onClick={() => onApply(rows.map((row) => [...row]))}
        >
          {theirs ? strings.play.putInMine : strings.play.apply}
        </Button>
        {refine > 0 && (
          <span className="result-view__refine">
            <button type="button" className="btn play-outlined" onClick={onRefine}>
              <span>{strings.play.refine}</span>
            </button>
            <span className="result-view__more">{plural(strings.play.refineMore, refine)}</span>
          </span>
        )}
        <Button onClick={onPlayAgain}>{strings.play.playAgain}</Button>
        <Button onClick={onCancel}>{strings.play.cancel}</Button>
      </div>
    </section>
  );
}
