import type { CSSProperties } from "react";
import type { PublishedItem, PublishedList } from "../../api/types";
import { plural, strings } from "../../strings";
import { arrange, type Row } from "./arrange";
import "./board.css";

interface ReadOnlyBoardProps {
  list: PublishedList;
}

function Tile({ item }: { item: PublishedItem }) {
  return (
    <li className="tile" title={item.title}>
      {item.imageUrl !== null ? (
        <img src={item.imageUrl} alt={item.title} loading="lazy" />
      ) : (
        <span className="tile__name">{item.title}</span>
      )}
    </li>
  );
}

function TierRow({ tier, items }: Row) {
  return (
    <div className="tier" style={{ "--band": tier.colorLight } as CSSProperties}>
      <div className="tier__band">
        <span className="tier__label">{tier.label}</span>
        {tier.caption !== null && <span className="tier__caption">{tier.caption}</span>}
      </div>
      <ul className="tier__items" aria-label={tier.label}>
        {items.map((item, index) => (
          <Tile key={`${index}-${item.title}`} item={item} />
        ))}
      </ul>
    </div>
  );
}

export function ReadOnlyBoard({ list }: ReadOnlyBoardProps) {
  const { rows, pool } = arrange(list);
  return (
    <section className="board" aria-label={strings.board.authorsVersion}>
      {rows.map((row, index) => (
        <TierRow key={`${index}-${row.tier.label}`} {...row} />
      ))}
      {pool.length > 0 && (
        <div className="pool">
          <h2 className="pool__title">{plural(strings.board.unranked, pool.length)}</h2>
          <ul className="pool__items">
            {pool.map((item, index) => (
              <Tile key={`${index}-${item.title}`} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
