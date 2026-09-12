import type { PublishedItem } from "../../api/types";
import type { DragState } from "./drag";

interface DragGhostProps {
  state: DragState;
  items: PublishedItem[];
}

export function DragGhost({ state, items }: DragGhostProps) {
  if (state.phase !== "dragging") return null;
  const card = items[state.item];
  if (card === undefined) return null;
  return (
    <div
      className="ghost"
      style={{ transform: `translate(${state.at.x}px, ${state.at.y}px)` }}
      aria-hidden="true"
    >
      {card.imageUrl !== null ? (
        <img src={card.imageUrl} alt="" />
      ) : (
        <span className="tile__name">{card.title}</span>
      )}
    </div>
  );
}
