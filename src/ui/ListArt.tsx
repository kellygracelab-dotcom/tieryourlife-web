import { useState } from "react";
import type { CoverFocus } from "../lib/coverFocus";
import { FocusedPicture } from "./FocusedPicture";
import { strings } from "../strings";
import "./ListArt.css";
import { shownLight } from "../lib/tierColour";

interface ListArtProps {
  cover: string | null;
  /** Which part of the cover shows; none for the middle. */
  focus?: CoverFocus | null;
  previews: string[];
  /** Where each collage picture is looked at, by its address, as its card has it; the rest by their default. */
  cellFocus?: ReadonlyMap<string, CoverFocus>;
  /** A published list's: where each preview is cut, by its place (null: its default). */
  previewFocus?: readonly (CoverFocus | null)[] | undefined;
  /**
   * A published list's collage as one picture (its summary's collageUrl):
   * drawn instead of the mosaic when there is no cover, the mosaic again if
   * it fails to load.
   */
  collage?: string | null;
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
  collage = null,
  tierColors,
  title,
  decorative = false,
}: ListArtProps) {
  // Each picture shows once it has come (a short fade); until then, and for
  // good when it fails, its place is the tile's one quiet surface, no frame and
  // no gap, with one soft shimmer over the whole tile while any is on its way
  // (the Designer, 23.11). Only when every picture failed does the tile fall
  // back to the title or the colours, as for a list without pictures.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [collageFailed, setCollageFailed] = useState<string | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const add = (set: typeof setLoaded, key: string) => () =>
    set((seen) => (seen.has(key) ? seen : new Set(seen).add(key)));
  const cells = previews.slice(0, MOSAIC_MAX).map((url, at) => ({
    url,
    key: `${at}-${url}`,
    focus: cellFocus?.get(url) ?? previewFocus?.[at] ?? null,
  }));
  const waiting = (keys: readonly string[]) =>
    keys.some((key) => !loaded.has(key) && !broken.has(key));
  const named = (label: string) =>
    decorative
      ? ({ "aria-hidden": true } as const)
      : ({ role: "img", "aria-label": label } as const);
  const cellClass = (key: string, base: string) => (loaded.has(key) ? `${base} art__shown` : base);
  if (cover !== null) {
    const key = `cover-${cover}`;
    return (
      <div className={waiting([key]) ? "art art--cover art--waiting" : "art art--cover"}>
        <FocusedPicture
          key={key}
          className={cellClass(key, "art__picture")}
          src={cover}
          focus={focus}
          loading="lazy"
          onLoad={add(setLoaded, key)}
          onError={add(setBroken, key)}
        />
      </div>
    );
  }
  // One picture for the whole collage, drawn by the site's server, coming in
  // the same way; the pictures one by one only if it will not load.
  if (collage !== null && collage !== collageFailed) {
    const key = `collage-${collage}`;
    return (
      <div className={waiting([key]) ? "art art--collage art--waiting" : "art art--collage"}>
        <FocusedPicture
          key={key}
          className={cellClass(key, "art__picture")}
          src={collage}
          focus={null}
          loading="lazy"
          onLoad={add(setLoaded, key)}
          onError={() => setCollageFailed(collage)}
        />
      </div>
    );
  }
  if (cells.length > 0 && !cells.every(({ key }) => broken.has(key))) {
    return (
      <div
        className={
          waiting(cells.map(({ key }) => key)) ? "art art--mosaic art--waiting" : "art art--mosaic"
        }
        data-count={cells.length}
      >
        {cells.map(({ url, key, focus: cell }) => (
          <FocusedPicture
            key={key}
            className={cellClass(key, "art__cell")}
            src={url}
            focus={cell}
            loading="lazy"
            onLoad={add(setLoaded, key)}
            onError={add(setBroken, key)}
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
          <span key={`${index}-${color}`} style={{ backgroundColor: shownLight(color) }} />
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
            <span key={`${index}-${color}`} style={{ backgroundColor: shownLight(color) }} />
          ))}
        </span>
      )}
    </div>
  );
}
