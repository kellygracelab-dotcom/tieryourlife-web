import {
  ATTRIBUTION_LIMITS,
  catalogueSourceOf,
  type PictureAttribution,
} from "../../api/pictureAttribution";
import type { Board, BoardItem } from "./model";

/**
 * The board with the catalogue pictures the account now shows from our
 * shared copies (CONTRACT, Catalogue pictures on a board) shown from those
 * copies here too: each card, the cover and the collage that still name a
 * catalogue address of `copies` name its copy instead, and the card's
 * attribution keeps the catalogue address in `originalUrl`, so a publish
 * sends the copy back with the address it was copied from. The same board,
 * object and all, when nothing here names any of them: a second answer with
 * the same copies changes nothing.
 *
 * A card with no attribution gets the catalogue's, told by the address's
 * host; one whose catalogue cannot be told, or whose address is too long to
 * keep as `originalUrl`, keeps its address, since its copy would name nobody. The cover goes by the address alone: it carries no
 * credit of its own. Not an edit: the edit time stays, so the board neither
 * moves up the list nor reads as changed since it was published.
 */
export function withCopies(board: Board, copies: ReadonlyMap<string, string>): Board {
  if (copies.size === 0) return board;
  let changed = false;
  const items = board.items.map((item) => {
    const moved = movedItem(item, copies);
    changed ||= moved !== item;
    return moved;
  });
  const coverImageUrl =
    board.coverImageUrl === null ? null : (copies.get(board.coverImageUrl) ?? board.coverImageUrl);
  const coverImageUrls = board.coverImageUrls.map((url) => copies.get(url) ?? url);
  const coverMoved =
    coverImageUrl !== board.coverImageUrl ||
    coverImageUrls.some((url, at) => url !== board.coverImageUrls[at]);
  const credited = board.coverCredit === undefined ? undefined : copies.get(board.coverCredit.url);
  if (!changed && !coverMoved && credited === undefined) return board;
  return {
    ...board,
    items: changed ? items : board.items,
    ...(coverMoved ? { coverImageUrl, coverImageUrls } : {}),
    // A house board's cover credit is tied to the cover picture: it follows it.
    ...(credited === undefined || board.coverCredit === undefined
      ? {}
      : { coverCredit: { ...board.coverCredit, url: credited } }),
  };
}

function movedItem(item: BoardItem, copies: ReadonlyMap<string, string>): BoardItem {
  // An own photo goes by its id; its address is never a catalogue's.
  if (item.pictureId !== null || item.imageUrl === null) return item;
  const copy = copies.get(item.imageUrl);
  if (copy === undefined) return item;
  const attribution = attributionAfter(item.attribution, item.imageUrl);
  return attribution === null ? item : { ...item, imageUrl: copy, attribution };
}

function attributionAfter(
  before: PictureAttribution | undefined,
  originalUrl: string,
): PictureAttribution | null {
  // Longer than an attribution keeps one: the card would lose where its copy came from.
  if (originalUrl.length > ATTRIBUTION_LIMITS.url) return null;
  if (before !== undefined) return { ...before, originalUrl };
  const source = catalogueSourceOf(originalUrl);
  return source === null ? null : { source, originalUrl };
}
