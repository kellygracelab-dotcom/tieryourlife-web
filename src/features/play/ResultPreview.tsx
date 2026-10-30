import type { CSSProperties } from "react";
import { sizedFor } from "../../lib/pictureSize";
import { strings } from "../../strings";
import { CardName } from "../tierboard/CardName";
import { useBoardSize } from "../tierboard/useBoardSize";
import { cardOf, type PlayBoard } from "./board";
import "../tierboard/board.css";
import "./play.css";

interface ResultPreviewProps {
  board: PlayBoard;
  /** One row of card ids per tier of the board, best first. */
  rows: readonly (readonly string[])[];
  /** Cards drawn with a dashed outline: they played too few duels to be sure of. */
  dashed: ReadonlySet<string>;
  /** Cards kept in one tier: only that tier is shown, the others are not touched. */
  only: number | null;
}

/**
 * The result as the board itself will look once applied, read only: the
 * board's own rows, bands with their captions and tiles at its three sizes,
 * so what is previewed is what is applied. A tier nobody landed in is as
 * tall as one holding a card and says so; a card that played too few duels
 * is dashed. The rows come in from the top, one after another.
 */
export function ResultPreview({ board, rows, dashed, only }: ResultPreviewProps) {
  const size = useBoardSize();
  const shown = board.tiers.flatMap((tier, index) =>
    only !== null && index !== only ? [] : [{ tier, ids: rows[index] ?? [] }],
  );
  return (
    <div className="board result-preview">
      {shown.map(({ tier, ids }, order) => {
        const style = {
          "--band-light": tier.colorLight,
          "--band-dark": tier.colorDark,
          "--row": order,
        } as CSSProperties;
        return (
          <div key={tier.id} className="tier band result-tier" style={style}>
            <div className="tier__band">
              <span className="tier__label">{tier.label}</span>
              {tier.caption !== null && tier.caption.trim() !== "" && (
                <span className="tier__caption">{tier.caption}</span>
              )}
            </div>
            {ids.length === 0 ? (
              <p className="result-tier__empty">{strings.play.empty}</p>
            ) : (
              <ul className="tier__items" aria-label={tier.label}>
                {ids.map((id) => {
                  const card = cardOf(board, id);
                  return (
                    <li
                      key={id}
                      className={
                        dashed.has(id) ? "tile result-tile result-tile--dashed" : "tile result-tile"
                      }
                      title={card.name}
                    >
                      {card.imageUrl !== null ? (
                        <img {...sizedFor(card.imageUrl, 64)} alt={card.name} loading="lazy" />
                      ) : (
                        <CardName title={card.name} board={size} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
