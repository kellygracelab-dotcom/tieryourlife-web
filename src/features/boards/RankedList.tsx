import type { CSSProperties } from "react";
import { sizedFor } from "../../lib/pictureSize";
import { strings } from "../../strings";
import { itemsIn, rankedTiers, type Board } from "./model";
import "./boards.css";

/**
 * The board as one column, best to worst, no tiers: the rank, a small
 * poster, the title (the one place a title wraps rather than truncating) and
 * the tier's letter in its colour. The phone's "Ranked list" display mode.
 */
export function RankedList({ board }: { board: Board }) {
  const rows = rankedTiers(board).flatMap((tier) =>
    itemsIn(board, tier.uid).map((item) => ({ tier, item })),
  );
  if (rows.length === 0) {
    return <p className="ranked__empty">{strings.boards.rankedEmpty}</p>;
  }
  return (
    <ol className="ranked" aria-label={strings.boards.modeRanked}>
      {rows.map(({ tier, item }, index) => (
        <li key={item.uid} className="ranked__row">
          <span className="ranked__number">{index + 1}</span>
          {item.imageUrl !== null ? (
            <img
              className="ranked__poster"
              {...sizedFor(item.imageUrl, 32)}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="ranked__poster ranked__poster--blank" aria-hidden="true" />
          )}
          <span className="ranked__title">{item.title}</span>
          <span
            className="ranked__badge band"
            style={
              { "--band-light": tier.colorLight, "--band-dark": tier.colorDark } as CSSProperties
            }
          >
            {tier.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
