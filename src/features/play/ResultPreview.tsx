import type { CSSProperties } from "react";
import { sizedFor } from "../../lib/pictureSize";
import { strings } from "../../strings";
import { cardOf, type PlayBoard } from "./board";
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

/** The width tiles are drawn at here: pictures are asked for at this size. */
const TILE_WIDTH = 40;

/**
 * The result as a board at compact size, read only: a band of 64, tiles of
 * 40 × 58, a tier nobody landed in as a short row that says so. The ranking
 * board's own read-only rendering has no dashed card and no empty row, and is
 * drawn at full size, hence a board of its own.
 */
export function ResultPreview({ board, rows, dashed, only }: ResultPreviewProps) {
  return (
    <div className="result-preview">
      {board.tiers.map((tier, index) => {
        if (only !== null && index !== only) return null;
        const ids = rows[index] ?? [];
        const colours = {
          "--band-light": tier.colorLight,
          "--band-dark": tier.colorDark,
        } as CSSProperties;
        return (
          <div
            key={tier.id}
            className={
              ids.length === 0 ? "result-tier result-tier--empty band" : "result-tier band"
            }
            style={colours}
          >
            <div className="result-tier__band">
              <span className="result-tier__label">{tier.label}</span>
            </div>
            {ids.length === 0 ? (
              <p className="result-tier__empty">{strings.play.empty}</p>
            ) : (
              <ul className="result-tier__cards" aria-label={tier.label}>
                {ids.map((id) => {
                  const card = cardOf(board, id);
                  return (
                    <li
                      key={id}
                      className={dashed.has(id) ? "result-tile result-tile--dashed" : "result-tile"}
                      title={card.name}
                    >
                      {card.imageUrl !== null ? (
                        <img
                          {...sizedFor(card.imageUrl, TILE_WIDTH)}
                          alt={card.name}
                          loading="lazy"
                        />
                      ) : (
                        <span className="result-tile__name">{card.name}</span>
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
