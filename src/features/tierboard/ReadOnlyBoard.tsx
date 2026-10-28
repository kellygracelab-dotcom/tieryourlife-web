import type { CSSProperties } from "react";
import type { PublishedItem, PublishedTier } from "../../api/types";
import { plural, strings } from "../../strings";
import { CardName } from "./CardName";
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

function Tile({ item, board }: { item: PublishedItem; board: BoardSize }) {
  return (
    <li className="tile" title={item.title}>
      {item.imageUrl !== null ? (
        <img {...sizedFor(item.imageUrl, 64)} alt={item.title} loading="lazy" />
      ) : (
        <CardName title={item.title} board={board} />
      )}
    </li>
  );
}

export function ReadOnlyBoard({ label, tiers, items, rows, pool }: ReadOnlyBoardProps) {
  const board = useBoardSize();
  const tileOf = (position: number) => {
    const item = items[position];
    return item === undefined ? null : (
      <Tile key={`${position}-${item.title}`} item={item} board={board} />
    );
  };
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
            <span className="tier__label">{tier.label}</span>
            {tier.caption !== null && <span className="tier__caption">{tier.caption}</span>}
          </div>
          <ul className="tier__items" aria-label={tier.label}>
            {(rows[index] ?? []).map(tileOf)}
          </ul>
        </div>
      ))}
      {pool.length > 0 && (
        <div className="pool">
          <h2 className="pool__title">{plural(strings.board.unranked, pool.length)}</h2>
          <ul className="pool__items">{pool.map(tileOf)}</ul>
        </div>
      )}
    </section>
  );
}
