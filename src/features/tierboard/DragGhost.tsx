import type { CSSProperties } from "react";
import type { PublishedItem } from "../../api/types";
import type { DragState } from "./drag";
import { CardName } from "./CardName";
import type { BoardSize } from "./nameFit";
import { sizedFor } from "../../lib/pictureSize";

interface DragGhostProps {
  state: DragState;
  items: PublishedItem[];
  board: BoardSize;
}

const TILT = "rotate(-4deg) scale(1.06)";

export function DragGhost({ state, items, board }: DragGhostProps) {
  if (state.phase !== "dragging") return null;
  const card = items[state.item];
  if (card === undefined) return null;
  const { at, grab } = state;
  // The ghost sits exactly where the card was, so the card appears to be the
  // thing moving. The tilt lives here rather than in CSS `rotate`/`scale`:
  // those apply before `transform`, which would spin the card around a point
  // near the page's corner instead of its own centre.
  const style: CSSProperties = {
    transform: `translate(${at.x - grab.x}px, ${at.y - grab.y}px) ${TILT}`,
    ...(grab.width > 0 && grab.height > 0 ? { width: grab.width, height: grab.height } : {}),
  };
  return (
    <div className="ghost" style={style} aria-hidden="true">
      {card.imageUrl !== null ? (
        <img {...sizedFor(card.imageUrl, 64)} alt="" />
      ) : (
        <CardName title={card.title} board={board} />
      )}
    </div>
  );
}
