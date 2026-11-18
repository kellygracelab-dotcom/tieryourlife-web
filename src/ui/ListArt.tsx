import { useState } from "react";
import type { CoverFocus } from "../lib/coverFocus";
import { FocusedPicture } from "./FocusedPicture";
import { strings } from "../strings";
import "./ListArt.css";

interface ListArtProps {
  cover: string | null;
  /** Which part of the cover shows; none for the middle. */
  focus?: CoverFocus | null;
  previews: string[];
  /** Where each collage picture is looked at, by its address, as its card has it; the rest by their default. */
  cellFocus?: ReadonlyMap<string, CoverFocus>;
  /** A published list's: where each preview is cut, by its place (null: its default). */
  previewFocus?: readonly (CoverFocus | null)[] | undefined;
  tierColors: string[];
  /** Drawn on the tile when there is no picture at all. */
  title?: string;
  /**
   * Inside a link named by the list's title: the tile says nothing of its
   * own, or every card without pictures is read as "No picture" and its title.
   */
  decorative?: boolean;
}

const MOSAIC_MAX = 6;
const BARS_MAX = 5;

// The feed shows the same thing the app does: the cover if there is one,
// otherwise the first few card pictures, otherwise the author's palette.
export function ListArt({
  cover,
  focus,
  previews,
  cellFocus,
  previewFocus,
  tierColors,
  title,
  decorative = false,
}: ListArtProps) {
  // A picture that fails to load leaves the collage, as a card whose picture
  // fails shows its name on the board: no blank tile among the others (night W7).
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const drawn = previews.flatMap((url, at) =>
    broken.has(url) ? [] : [{ url, at, focus: cellFocus?.get(url) ?? previewFocus?.[at] ?? null }],
  );
  const named = (label: string) =>
    decorative
      ? ({ "aria-hidden": true } as const)
      : ({ role: "img", "aria-label": label } as const);
  if (cover !== null) {
    return (
      <div className="art art--cover">
        <FocusedPicture src={cover} focus={focus} loading="lazy" />
      </div>
    );
  }
  if (drawn.length > 0) {
    return (
      <div className="art art--mosaic" data-count={Math.min(drawn.length, MOSAIC_MAX)}>
        {drawn.slice(0, MOSAIC_MAX).map(({ url, at, focus: cell }) => (
          <FocusedPicture
            key={`${at}-${url}`}
            className="art__cell"
            src={url}
            focus={cell}
            loading="lazy"
            onError={() => setBroken((gone) => new Set(gone).add(url))}
          />
        ))}
      </div>
    );
  }
  // Untitled, the tile is the tier colours themselves, the way the phone draws
  // a board with no pictures; its name stands under it.
  if (title === undefined && tierColors.length > 0) {
    return (
      <div className="art art--stripes" {...named(strings.card.noArt)}>
        {tierColors.slice(0, BARS_MAX).map((color, index) => (
          <span key={`${index}-${color}`} style={{ backgroundColor: color }} />
        ))}
      </div>
    );
  }
  // Without a picture the tile carries the title, with the author's palette
  // as a strip along the bottom: a titled tile, never an empty rectangle.
  return (
    <div className="art art--titled" {...named(title ?? strings.card.noArt)}>
      {title !== undefined && <span className="art__title">{title}</span>}
      {tierColors.length > 0 && (
        <span className="art__bars" aria-hidden="true">
          {tierColors.slice(0, BARS_MAX).map((color, index) => (
            <span key={`${index}-${color}`} style={{ backgroundColor: color }} />
          ))}
        </span>
      )}
    </div>
  );
}
