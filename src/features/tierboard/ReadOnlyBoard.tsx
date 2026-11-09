import { MediaImage } from "../../ui/MediaImage";
import { useRef, useState, type CSSProperties } from "react";
import type { PublishedItem, PublishedTier } from "../../api/types";
import { plural, strings } from "../../strings";
import { DOUBLE_TAP_MS } from "./drag";
import { ImageCredits } from "./ImageCredits";
import { CardName } from "./CardName";
import { TierLabel } from "./TierLabel";
import { useBoardSize } from "./useBoardSize";
import type { BoardSize } from "./nameFit";
import "./board.css";
import { sizedFor } from "../../lib/pictureSize";

interface ReadOnlyBoardProps {
  label: string;
  tiers: readonly PublishedTier[];
  items: readonly PublishedItem[];
  rows: readonly (readonly number[])[];
  pool: readonly number[];
}

// The card's place in the list, as the ranking board's tiles carry it: a switch between the two moves the same cards.
function Tile({
  item,
  position,
  board,
}: {
  item: PublishedItem;
  position: number;
  board: BoardSize;
}) {
  const lastClick = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const credit = item.credit?.trim();
  const className = item.imageUrl === null ? "tile tile--name" : "tile";
  const art =
    item.imageUrl !== null ? (
      <MediaImage {...sizedFor(item.imageUrl, 64)} alt={item.title} loading="lazy" />
    ) : (
      <CardName title={item.title} board={board} wide />
    );
  return (
    <li>
      <button
        type="button"
        data-item={position}
        aria-label={item.title}
        aria-haspopup="dialog"
        className={`${className} tile--credit`}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        onClick={(event) => {
          const now = Date.now();
          if (
            event.detail === 0 ||
            (lastClick.current !== null && now - lastClick.current < DOUBLE_TAP_MS)
          ) {
            lastClick.current = null;
            setOpen(true);
          } else lastClick.current = now;
        }}
      >
        {art}
      </button>
      {open && (
        <ImageCredits
          title={item.title}
          credit={credit ?? ""}
          imageUrl={item.imageUrl}
          details
          close={() => setOpen(false)}
        />
      )}
    </li>
  );
}

function useTiles(items: readonly PublishedItem[]) {
  const board = useBoardSize();
  return (position: number) => {
    const item = items[position];
    return item === undefined ? null : (
      <Tile key={`${position}-${item.title}`} item={item} position={position} board={board} />
    );
  };
}

/**
 * The cards an arrangement left unranked, under its board: the author's own
 * view, a ranking's page and a visitor's Theirs all say them, as the app does.
 */
export function UnrankedPool({
  items,
  pool,
}: {
  items: readonly PublishedItem[];
  pool: readonly number[];
}) {
  const tileOf = useTiles(items);
  if (pool.length === 0) return null;
  return (
    <div className="pool">
      <h2 className="pool__title">{plural(strings.board.unranked, pool.length)}</h2>
      <ul className="pool__items">{pool.map(tileOf)}</ul>
    </div>
  );
}

export function ReadOnlyBoard({ label, tiers, items, rows, pool }: ReadOnlyBoardProps) {
  const tileOf = useTiles(items);
  const board = useBoardSize();
  return (
    <section className="board" aria-label={label}>
      {tiers.map((tier, index) => (
        <div
          key={`${index}-${tier.label}`}
          className="tier band"
          style={
            { "--band-light": tier.colorLight, "--band-dark": tier.colorDark } as CSSProperties
          }
        >
          <div className="tier__band">
            <TierLabel label={tier.label} caption={tier.caption} band={board} />
            {tier.caption !== null && <bdi className="tier__caption">{tier.caption}</bdi>}
          </div>
          <ul className="tier__items" aria-label={tier.label}>
            {(rows[index] ?? []).map(tileOf)}
          </ul>
        </div>
      ))}
      <UnrankedPool items={items} pool={pool} />
    </section>
  );
}
