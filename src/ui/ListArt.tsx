import { strings } from "../strings";
import "./ListArt.css";

interface ListArtProps {
  cover: string | null;
  previews: string[];
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
export function ListArt({ cover, previews, tierColors, title, decorative = false }: ListArtProps) {
  const named = (label: string) =>
    decorative
      ? ({ "aria-hidden": true } as const)
      : ({ role: "img", "aria-label": label } as const);
  if (cover !== null) {
    return (
      <div className="art art--cover">
        <img src={cover} alt="" loading="lazy" />
      </div>
    );
  }
  if (previews.length > 0) {
    return (
      <div className="art art--mosaic" data-count={Math.min(previews.length, MOSAIC_MAX)}>
        {previews.slice(0, MOSAIC_MAX).map((url, index) => (
          <img key={`${index}-${url}`} src={url} alt="" loading="lazy" />
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
