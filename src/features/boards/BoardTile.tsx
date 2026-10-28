import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ListArt } from "../../ui/ListArt";
import { metaOf } from "./boardText";
import { previewsOf, rankedTiers, type Board } from "./model";

interface BoardTileProps {
  board: Board;
  title: string;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onStar: () => void;
}

/**
 * One board as the phone's grid shows it: its picture, its name, how far
 * along it is and, once out, that it is public, with the star over the
 * picture's corner. The picture is the chosen cover, else a collage of the
 * first cards, else the tier colours.
 */
export function BoardTile({ board, title, selecting, selected, onSelect, onStar }: BoardTileProps) {
  const starred = board.favouritedAt !== null;
  const art = (
    <ListArt
      cover={board.coverImageUrl}
      previews={board.coverImageUrls.length > 1 ? board.coverImageUrls : previewsOf(board)}
      tierColors={rankedTiers(board).map((tier) => tier.colorLight)}
    />
  );
  const words = (
    <span className="board-tile__words">
      <span className="board-tile__title">{title}</span>
      <span className="board-tile__meta">{metaOf(board)}</span>
      {board.publishedId !== null && (
        <span className="board-tile__public">
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
          aria-label={fill(strings.boards.select, { name: title })}
          onClick={onSelect}
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
            aria-label={fill(strings.boards.open, { name: title })}
          >
            {art}
            {words}
          </Link>
          <button
            type="button"
            className={starred ? "board-tile__star board-tile__star--on" : "board-tile__star"}
            aria-label={fill(starred ? strings.boards.unstar : strings.boards.star, {
              name: title,
            })}
            aria-pressed={starred}
            onClick={onStar}
          >
            <Icon name="star" />
          </button>
        </>
      )}
    </li>
  );
}
