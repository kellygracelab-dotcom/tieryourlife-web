import { strings } from "../strings";
import "./ListArt.css";

interface ListArtProps {
  cover: string | null;
  previews: string[];
  tierColors: string[];
}

const MOSAIC_MAX = 6;
const BARS_MAX = 5;

// The feed shows the same thing the app does: the cover if there is one,
// otherwise the first few card pictures, otherwise the author's palette.
export function ListArt({ cover, previews, tierColors }: ListArtProps) {
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
  if (tierColors.length > 0) {
    return (
      <div className="art art--bars" role="img" aria-label={strings.card.noArt}>
        {tierColors.slice(0, BARS_MAX).map((color, index) => (
          <span key={`${index}-${color}`} style={{ background: color }} />
        ))}
      </div>
    );
  }
  return <div className="art art--empty" role="img" aria-label={strings.card.noArt} />;
}
