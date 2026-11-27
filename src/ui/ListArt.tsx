import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CoverFocus } from "../lib/coverFocus";
import { FocusedPicture } from "./FocusedPicture";
import { strings } from "../strings";
import "./ListArt.css";
import { shownLight } from "../lib/tierColour";
import { sizedFor } from "../lib/pictureSize";
import {
  GLUED_MIN,
  gluedBroken,
  gluedKept,
  gluedKey,
  gluedNow,
  glueLater,
  type Shape,
} from "../lib/gluedCollage";

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
  /**
   * One of the first tiles the page opens on: its pictures are asked for at
   * once and before the rest, not when the browser gets round to lazy ones.
   */
  first?: boolean;
  /**
   * A board of this browser's, whose (null: made without an account) and
   * which: its mosaic is glued into one picture kept on this device, and
   * shown alone the next time (cover-collage BRIEF, steps 2 and 3).
   */
  glue?: { owner: string | null; board: string };
}

const MOSAIC_MAX = 6;
/**
 * A collage that would not load is asked for once more after this long, before
 * the tile falls back to its pictures one by one: the site's function, woken by
 * a new browser's whole page at once, may answer a few late (Danylo, 27.11:
 * "covers load picture by picture again" on a first visit).
 */
export const COLLAGE_RETRY_MS = 1_500;
/** A mosaic cell's width for its picture's copy: up to six of them in a tile. */
const CELL_WIDTH = 200;

/**
 * The collage each list last showed on this visit, by its address without the
 * version: a tile drawn again after an Update shows it until the new one has
 * come, the server drawing that one when first asked.
 */
const lastCollage = new Map<string, string>();
const collageBase = (url: string): string => url.split("?")[0] ?? url;
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
  first = false,
  glue,
}: ListArtProps) {
  const asked = first
    ? ({ loading: "eager", fetchPriority: "high" } as const)
    : ({ loading: "lazy" } as const);
  // Each picture shows once it has come (a short fade); until then, and for
  // good when it fails, its place is the tile's one quiet surface, no frame and
  // no gap, with one soft shimmer over the whole tile while any is on its way
  // (the Designer, 23.11). Only when every picture failed does the tile fall
  // back to the title or the colours, as for a list without pictures.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [collageFailed, setCollageFailed] = useState<string | null>(null);
  // The collage asked for once more (after COLLAGE_RETRY_MS), and the one waiting to be.
  const [collageAgain, setCollageAgain] = useState<string | null>(null);
  const [collageMissed, setCollageMissed] = useState<string | null>(null);
  useEffect(() => {
    if (collageMissed === null) return;
    const timer = setTimeout(() => setCollageAgain(collageMissed), COLLAGE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [collageMissed]);
  // The collage last shown: an Update gives the list a new one (its ?v=), drawn
  // by the server when first asked, and until it has come the old one stays,
  // never a grey tile (Designer, background Update, 26.11).
  const [shownCollage, setShownCollage] = useState<string | null>(() =>
    collage === null ? null : (lastCollage.get(collageBase(collage)) ?? null),
  );
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const add = (set: typeof setLoaded, key: string) => () =>
    set((seen) => (seen.has(key) ? seen : new Set(seen).add(key)));
  const cells = previews.slice(0, MOSAIC_MAX).map((url, at) => ({
    url,
    key: `${at}-${url}`,
    focus: cellFocus?.get(url) ?? previewFocus?.[at] ?? null,
  }));
  // A board's own: its tile's shape once laid out, then the picture kept for
  // its pictures, looked for before any of them is asked for.
  const box = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const gluing =
    glue !== undefined && cover === null && collage === null && cells.length >= GLUED_MIN;
  const gluedAs =
    gluing && shape !== null && shape.width > 0
      ? gluedKey(
          glue.owner,
          glue.board,
          cells.map(({ url, focus: cell }) => ({ url, focus: cell })),
          shape,
        )
      : null;
  const [found, setFound] = useState<{ key: string; url: string | null } | null>(null);
  const [gluedFailed, setGluedFailed] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!gluing || shape !== null || box.current === null) return;
    const { width, height } = box.current.getBoundingClientRect();
    // Not laid out (a test's page): the mosaic, as before.
    setShape(
      width >= 1 && height >= 1
        ? { width: Math.round(width), height: Math.round(height) }
        : { width: 0, height: 0 },
    );
  }, [gluing, shape]);
  useLayoutEffect(() => {
    if (gluedAs === null || found?.key === gluedAs) return;
    const now = gluedNow(gluedAs);
    if (now !== null) {
      setFound({ key: gluedAs, url: now });
      return;
    }
    let active = true;
    void gluedKept(gluedAs).then((url) => {
      if (active) setFound({ key: gluedAs, url });
    });
    return () => {
      active = false;
    };
  }, [gluedAs, found]);
  const glued =
    gluedAs !== null && found?.key === gluedAs && gluedAs !== gluedFailed ? found.url : null;
  const looking = gluing && (shape === null || (gluedAs !== null && found?.key !== gluedAs));
  // Every picture of the mosaic has come (from the browser's cache, now):
  // glued once, for the next time.
  const allIn =
    gluedAs !== null && glued === null && cells.every(({ key: cell }) => loaded.has(cell));
  useEffect(() => {
    if (allIn && gluedAs !== null && shape !== null)
      glueLater(
        gluedAs,
        cells.map(({ url, focus: cell }) => ({ url, focus: cell })),
        shape,
      );
    // The pictures are in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIn, gluedAs]);
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
          {...asked}
          onLoad={add(setLoaded, key)}
          onError={add(setBroken, key)}
        />
      </div>
    );
  }
  // One picture for the whole collage, drawn by the site's server, coming in
  // the same way; the pictures one by one only if it will not load.
  if (collage !== null && collage !== collageFailed) {
    const again = collageAgain === collage;
    // A new address for the second try: the CDN and the browser ask the function anew.
    const src = again ? `${collage}${collage.includes("?") ? "&" : "?"}again=1` : collage;
    const key = `collage-${src}`;
    const before =
      shownCollage !== null && shownCollage !== collage && !loaded.has(key) ? shownCollage : null;
    return (
      <div
        className={
          waiting([key]) && before === null ? "art art--collage art--waiting" : "art art--collage"
        }
      >
        {before !== null && (
          <FocusedPicture
            key={`collage-${before}`}
            className="art__picture art__shown art__before"
            src={before}
            focus={null}
          />
        )}
        <FocusedPicture
          key={key}
          className={cellClass(key, "art__picture")}
          src={src}
          focus={null}
          {...asked}
          onLoad={() => {
            add(setLoaded, key)();
            setShownCollage(src);
            lastCollage.set(collageBase(collage), src);
          }}
          onError={() => (again ? setCollageFailed(collage) : setCollageMissed(collage))}
        />
      </div>
    );
  }
  // A board's mosaic glued on this device: one picture, no other loads.
  if (glued !== null && gluedAs !== null) {
    const shownKey = `glued-${gluedAs}`;
    return (
      <div
        ref={box}
        className={waiting([shownKey]) ? "art art--collage art--waiting" : "art art--collage"}
      >
        <FocusedPicture
          key={shownKey}
          className={cellClass(shownKey, "art__picture")}
          src={glued}
          focus={null}
          onLoad={add(setLoaded, shownKey)}
          onError={() => {
            gluedBroken(gluedAs);
            setGluedFailed(gluedAs);
          }}
        />
      </div>
    );
  }
  // Looking for it: the quiet surface a moment, so no picture is asked for in vain.
  if (looking) return <div ref={box} className="art art--waiting" aria-hidden="true" />;
  if (cells.length > 0 && !cells.every(({ key }) => broken.has(key))) {
    return (
      <div
        ref={box}
        className={
          waiting(cells.map(({ key }) => key)) ? "art art--mosaic art--waiting" : "art art--mosaic"
        }
        data-count={cells.length}
      >
        {cells.map(({ url, key, focus: cell }) => (
          <FocusedPicture
            key={key}
            className={cellClass(key, "art__cell")}
            // A cell is a sixth of a tile: its card's small copy, not the original
            // (a board's own keeps the original, glued from the browser's cache).
            src={glue === undefined ? sizedFor(url, CELL_WIDTH).src : url}
            focus={cell}
            {...asked}
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
