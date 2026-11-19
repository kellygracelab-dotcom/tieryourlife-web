import { memo, useId } from "react";
import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ListArt } from "../../ui/ListArt";
import { fromOf, labelOf, metaPartsOf, spokenTitleOf, titleOf } from "./boardText";
import { RenameField } from "./RenameField";
import { cardFocusByPicture, coverFocusOf, previewsOf, rankedTiers, type Board } from "./model";

interface BoardTileProps {
  board: Board;
  selecting: boolean;
  selected: boolean;
  onSelect: (uid: string) => void;
  onStar: (board: Board) => void;
  /** Its name is a field (Rename in its menu). */
  renaming?: boolean;
  onRename?: (board: Board, title: string | null) => void;
}

/** ⋮ on a list: its menu (artboard 39), on a computer when the list is pointed at or focused. */
export function MoreButton({ name, className }: { name: string; className: string }) {
  return (
    <button
      type="button"
      className={`board-more ${className}`}
      data-menu-button=""
      aria-haspopup="menu"
      aria-label={fill(strings.listMenu.label, { name })}
    >
      <Icon name="more_vert" />
    </button>
  );
}

/** Public or Saved before the count (artboard 42), in a tile and in a row alike. */
/**
 * "14 cards · nothing placed yet" in two pieces that each keep together while
 * they fit, so a narrow tile breaks between them rather than a word to a line.
 */
export function MetaParts({ board }: { board: Board }) {
  const [count, progress] = metaPartsOf(board);
  return (
    <>
      <span className="board-meta__part">{count} ·</span>{" "}
      <span className="board-meta__part">{progress}</span>
    </>
  );
}

export function ListLabel({
  text,
  id,
  className,
}: {
  text: string;
  id: string;
  className: string;
}) {
  return (
    <span className={`list-label ${className}`} id={id}>
      {text}
    </span>
  );
}

/**
 * One board as the phone's grid shows it: its picture, its name, and on one
 * line Public or Saved before how far along it is (artboard 42). The star
 * over the picture's corner shows on a favourite, and on a computer where the
 * tile is pointed at or reached by the keyboard; ⋮ waits in the lower corner.
 * The picture is the chosen cover, else a collage of the first cards, else
 * the tier colours. Drawn again only when its own board or choice changes: a
 * star or a keystroke elsewhere leaves it be.
 */
export const BoardTile = memo(function BoardTile({
  board,
  selecting,
  selected,
  onSelect,
  onStar,
  renaming = false,
  onRename,
}: BoardTileProps) {
  const starred = board.favouritedAt !== null;
  // A conflict's copy says where it came from, here as in rows and on the phone.
  const from = fromOf(board);
  const spoken = spokenTitleOf(board);
  // The name replaces what the link holds, so whose it is and how far along
  // it is are read after it instead of lost.
  const id = useId();
  const label = labelOf(board);
  const facts = label === null ? `${id}-meta` : `${id}-label ${id}-meta`;
  const art = (
    <ListArt
      cover={board.coverImageUrl}
      focus={coverFocusOf(board)}
      previews={board.coverImageUrls.length > 1 ? board.coverImageUrls : previewsOf(board)}
      cellFocus={cardFocusByPicture(board)}
      tierColors={rankedTiers(board).map((tier) => tier.colorLight)}
    />
  );
  const words = (
    <span className="board-tile__words">
      {renaming ? (
        <RenameField
          className="board-tile__title board-rename"
          title={board.title}
          onDone={(title) => onRename?.(board, title)}
        />
      ) : (
        <bdi className="board-tile__title">{titleOf(board)}</bdi>
      )}
      {from !== null && <span className="board-tile__from">{from}</span>}
      <span className="board-tile__facts">
        {label !== null && (
          <ListLabel text={label} id={`${id}-label`} className="board-tile__label" />
        )}
        <span className="board-tile__meta" id={`${id}-meta`}>
          <MetaParts board={board} />
        </span>
      </span>
    </span>
  );
  return (
    <li
      className={selected ? "board-tile board-tile--selected" : "board-tile"}
      data-board={board.uid}
    >
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
      ) : renaming ? (
        <div className="board-tile__main">
          {art}
          {words}
        </div>
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
          <MoreButton name={spoken} className="board-tile__more" />
        </>
      )}
    </li>
  );
});
