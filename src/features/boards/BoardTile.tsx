import { memo, useId } from "react";
import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ListArt } from "../../ui/ListArt";
import { fromOf, metaOf, spokenTitleOf, titleOf } from "./boardText";
import { previewsOf, rankedTiers, type Board } from "./model";

interface BoardTileProps {
  board: Board;
  selecting: boolean;
  selected: boolean;
  onSelect: (uid: string) => void;
  onStar: (board: Board) => void;
}

/**
 * One board as the phone's grid shows it: its picture, its name, how far
 * along it is and, once out, that it is public, with the star over the
 * picture's corner. The picture is the chosen cover, else a collage of the
 * first cards, else the tier colours. Drawn again only when its own board or
 * choice changes: a star or a keystroke elsewhere leaves it be.
 */
export const BoardTile = memo(function BoardTile({
  board,
  selecting,
  selected,
  onSelect,
  onStar,
}: BoardTileProps) {
  const starred = board.favouritedAt !== null;
  // A conflict's copy says where it came from, here as in rows and on the phone.
  const from = fromOf(board);
  const spoken = spokenTitleOf(board);
  // The name replaces what the link holds, so how far along it is and that it
  // is public are read after it instead of lost.
  const id = useId();
  const facts = board.publishedId === null ? `${id}-meta` : `${id}-meta ${id}-public`;
  const art = (
    <ListArt
      cover={board.coverImageUrl}
      previews={board.coverImageUrls.length > 1 ? board.coverImageUrls : previewsOf(board)}
      tierColors={rankedTiers(board).map((tier) => tier.colorLight)}
    />
  );
  const words = (
    <span className="board-tile__words">
      <bdi className="board-tile__title">{titleOf(board)}</bdi>
      {from !== null && <span className="board-tile__from">{from}</span>}
      <span className="board-tile__meta" id={`${id}-meta`}>
        {metaOf(board)}
      </span>
      {board.publishedId !== null && (
        <span className="board-tile__public" id={`${id}-public`}>
          <Icon name="public" />
          {strings.boards.filterPublic}
        </span>
      )}
    </span>
  );
  return (
    <li className={selected ? "board-tile board-tile--selected" : "board-tile"}>
      {selecting ? (
        <button
          type="button"
          className="board-tile__main"
          aria-pressed={selected}
          aria-label={fill(strings.boards.select, { name: spoken })}
          aria-describedby={facts}
          onClick={() => onSelect(board.uid)}
        >
          {art}
          {words}
          <span className="board-tile__pick" aria-hidden="true">
            <Icon name={selected ? "check" : "add"} />
          </span>
        </button>
      ) : (
        <>
          <Link
            className="board-tile__main"
            to={`/b/${encodeURIComponent(board.uid)}`}
            aria-label={fill(strings.boards.open, { name: spoken })}
            aria-describedby={facts}
          >
            {art}
            {words}
          </Link>
          <button
            type="button"
            className={starred ? "board-tile__star board-tile__star--on" : "board-tile__star"}
            aria-label={fill(starred ? strings.boards.unstar : strings.boards.star, {
              name: spoken,
            })}
            aria-pressed={starred}
            onClick={() => onStar(board)}
          >
            <Icon name="star" />
          </button>
        </>
      )}
    </li>
  );
});
