import { useEffect, useReducer, type CSSProperties } from "react";
import type { PublishedList } from "../../api/types";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import {
  canUndo,
  init,
  placedCount,
  pool,
  reduce,
  tierForKey,
  type BoardAction,
  type BoardState,
} from "./model";
import "./board.css";
import "./ranking.css";

interface RankingBoardProps {
  list: PublishedList;
}

interface TileProps {
  list: PublishedList;
  item: number;
  selected: boolean;
  dispatch: (action: BoardAction) => void;
}

function Tile({ list, item, selected, dispatch }: TileProps) {
  const card = list.items[item];
  if (card === undefined) return null;
  return (
    <li>
      <button
        type="button"
        className={selected ? "tile tile--selected" : "tile"}
        aria-pressed={selected}
        aria-label={card.title}
        title={card.title}
        onClick={() => dispatch({ type: "select", item })}
      >
        {card.imageUrl !== null ? (
          <img src={card.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="tile__name">{card.title}</span>
        )}
      </button>
    </li>
  );
}

function useBoard(list: PublishedList) {
  return useReducer(reduce, list, (l) => init(l.tiers.length, l.items.length));
}

export function RankingBoard({ list }: RankingBoardProps) {
  const [state, dispatch] = useBoard(list);
  const selected = state.selected;
  const selectedTitle = selected === null ? null : (list.items[selected]?.title ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "Escape") return dispatch({ type: "select", item: null });
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        return dispatch({ type: "undo" });
      }
      const tier = tierForKey(event.key, list.tiers.length);
      if (tier !== null && selected !== null) dispatch({ type: "place", item: selected, tier });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, list.tiers.length, selected]);

  const left = pool(state);
  const keyboardTiers = Math.min(list.tiers.length, 9);

  return (
    <section className="ranking" aria-label={strings.rank.yours}>
      <div className="ranking__bar">
        <p className="ranking__progress" aria-live="polite">
          {fill(strings.rank.placed, { n: placedCount(state), total: list.items.length })}
        </p>
        <div className="ranking__actions">
          <Button icon="undo" onClick={() => dispatch({ type: "undo" })} disabled={!canUndo(state)}>
            {strings.rank.undo}
          </Button>
          <Button variant="filled" icon="check" disabled>
            {strings.rank.finish}
          </Button>
        </div>
      </div>

      <div className="board">
        {list.tiers.map((tier, index) => (
          <TierRow
            key={`${index}-${tier.label}`}
            list={list}
            state={state}
            tier={index}
            selectedTitle={selectedTitle}
            dispatch={dispatch}
          />
        ))}
      </div>

      <div className="pool">
        <div className="pool__head">
          <h2 className="pool__title">{plural(strings.rank.left, left.length)}</h2>
          <p className="pool__hint">
            {selectedTitle === null
              ? fill(strings.rank.hintPick, { keys: `1–${keyboardTiers}` })
              : fill(strings.rank.hintPlace, { name: selectedTitle })}
          </p>
        </div>
        <ul className="pool__items">
          {left.map((item) => (
            <Tile
              key={item}
              list={list}
              item={item}
              selected={selected === item}
              dispatch={dispatch}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

interface TierRowProps {
  list: PublishedList;
  state: BoardState;
  tier: number;
  selectedTitle: string | null;
  dispatch: (action: BoardAction) => void;
}

function TierRow({ list, state, tier, selectedTitle, dispatch }: TierRowProps) {
  const meta = list.tiers[tier];
  const row = state.rows[tier] ?? [];
  if (meta === undefined) return null;
  const selected = state.selected;
  const armed = selected !== null && !row.includes(selected);
  const place = () => {
    if (selected !== null) dispatch({ type: "place", item: selected, tier });
  };
  return (
    <div
      className={armed ? "tier tier--armed" : "tier"}
      style={{ "--band": meta.colorLight } as CSSProperties}
      onClick={armed ? place : undefined}
    >
      <div className="tier__band">
        <span className="tier__label">{meta.label}</span>
        {meta.caption !== null && <span className="tier__caption">{meta.caption}</span>}
        {tier < 9 && (
          <span className="tier__key" aria-hidden="true">
            {tier + 1}
          </span>
        )}
        {armed && selectedTitle !== null && (
          <button type="button" className="tier__place" onClick={place}>
            {fill(strings.rank.placeIn, { name: selectedTitle, tier: meta.label })}
          </button>
        )}
      </div>
      <ul className="tier__items" aria-label={meta.label}>
        {row.map((item) => (
          <Tile
            key={item}
            list={list}
            item={item}
            selected={selected === item}
            dispatch={dispatch}
          />
        ))}
      </ul>
    </div>
  );
}
