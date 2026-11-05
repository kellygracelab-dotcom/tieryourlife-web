import { memo, useId, type CSSProperties } from "react";
import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ListArt } from "../../ui/ListArt";
import { fromOf, metaOf, spokenTitleOf, titleOf } from "./boardText";
import {
  isOut,
  poolCount,
  previewsOf,
  rankedCount,
  rankedTiers,
  tierShares,
  type Board,
} from "./model";

interface BoardRowProps {
  board: Board;
  selecting: boolean;
  selected: boolean;
  onSelect: (uid: string) => void;
  onStar: (board: Board) => void;
}

/**
 * The ribbon under the name: one segment per tier, as long as its share of
 * the cards and in its colour, the unranked last in the pool's.
 */
function TierRibbon({ board }: { board: Board }) {
  const shares = tierShares(board).filter((share) => share.count > 0);
  const waiting = poolCount(board);
  return (
    <span className="board-card__ribbon" aria-hidden="true">
      {shares.map((share, index) => (
        <span
          key={index}
          className="band"
          style={
            {
              flex: share.count,
              "--band-light": share.color,
              "--band-dark": share.colorDark,
            } as CSSProperties
          }
        />
      ))}
      {waiting > 0 && <span className="board-card__unranked" style={{ flex: waiting }} />}
    </span>
  );
}

/**
 * One board to a row, as the phone lists them: its picture, its name, how far
 * along it is and the ribbon of its tiers, the star and the way in at the end.
 * Picking boards to delete puts a box where the star was. Drawn again only
 * when its own board or choice changes, as a tile is.
 */
export const BoardRow = memo(function BoardRow({
  board,
  selecting,
  selected,
  onSelect,
  onStar,
}: BoardRowProps) {
  const title = titleOf(board);
  const from = fromOf(board);
  const spoken = spokenTitleOf(board);
  const ranked = rankedCount(board);
  const starred = board.favouritedAt !== null;
  // As on a tile: how far along it is and that it is public are read after the name.
  const id = useId();
  const facts = !isOut(board) ? `${id}-meta` : `${id}-meta ${id}-public`;
  const words = (
    <>
      <span className="board-card__thumb">
        <ListArt
          cover={board.coverImageUrl}
          previews={board.coverImageUrls.length > 1 ? board.coverImageUrls : previewsOf(board)}
          tierColors={rankedTiers(board).map((tier) => tier.colorLight)}
        />
      </span>
      <span className="board-card__text">
        <span className="board-card__title">
          <bdi>{title}</bdi>
          {from !== null && <span className="board-card__from">{from}</span>}
        </span>
        <span className="board-card__meta">
          <span id={`${id}-meta`}>{metaOf(board)}</span>
          {isOut(board) && (
            <span className="board-card__public" id={`${id}-public`}>
              <Icon name="public" />
              {strings.boards.filterPublic}
            </span>
          )}
        </span>
        {ranked > 0 ? (
          <TierRibbon board={board} />
        ) : (
          poolCount(board) > 0 && (
            <span className="board-card__hint">{strings.boards.startDragging}</span>
          )
        )}
      </span>
    </>
  );
  return (
    <li className={selected ? "board-card board-card--selected" : "board-card"}>
      {selecting ? (
        // The box at the end is what a screen reader and the keyboard use; the
        // row is only a larger place for a pointer to press.
        <button
          type="button"
          className="board-card__main"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onSelect(board.uid)}
        >
          {words}
        </button>
      ) : (
        <Link
          className="board-card__main"
          to={`/b/${encodeURIComponent(board.uid)}`}
          aria-label={fill(strings.boards.open, { name: spoken })}
          aria-describedby={facts}
        >
          {words}
        </Link>
      )}
      {selecting ? (
        <label className="board-card__pick">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(board.uid)}
            aria-label={fill(strings.boards.select, { name: spoken })}
            aria-describedby={facts}
          />
        </label>
      ) : (
        <>
          <button
            type="button"
            className={starred ? "board-card__star board-card__star--on" : "board-card__star"}
            aria-label={fill(starred ? strings.boards.unstar : strings.boards.star, {
              name: spoken,
            })}
            aria-pressed={starred}
            onClick={() => onStar(board)}
          >
            <Icon name="star" />
          </button>
          <Icon name="chevron_right" className="board-card__chevron" />
        </>
      )}
    </li>
  );
});
