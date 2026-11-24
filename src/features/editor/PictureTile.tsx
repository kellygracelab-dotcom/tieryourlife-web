import { useEffect, useRef, useState } from "react";
import type { FoundPicture } from "../../api/pictures";
import { sizedFor } from "../../lib/pictureSize";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import { kindName } from "./pictureNames";
import { shortCredit } from "./shortCredit";

/**
 * How long a picture in sight may take before its tile goes: a site that
 * never answers leaves no grey square behind (search-quality BRIEF, 25.11).
 */
export const TILE_WAIT_MS = 8_000;

/** One picture the catalogues found, to be picked: the add box's and a pasted name's. */
export function PictureTile({
  found,
  added,
  busy,
  onPick,
}: {
  found: FoundPicture;
  added: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  // Counted from when it is in sight, as a lazy picture is only asked for then.
  useEffect(() => {
    const image = picture.current;
    if (loaded || broken || image === null || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      timer = setTimeout(() => setBroken(true), TILE_WAIT_MS);
    });
    observer.observe(image);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [loaded, broken]);
  // Another site's picture says so: nobody vouches for it as a catalogue does (stage 1b).
  const from =
    found.source === "web"
      ? fill(strings.new.fromSources, { sources: strings.new.webSource })
      : null;
  const line = [from, kindName(found.kind), found.subtitle].filter(Boolean).join(" · ");
  const credit = shortCredit(found);
  // A picture that will not load leaves no empty tile behind.
  if (broken) return null;
  return (
    // Not disabled when added: a disabled button drops the keyboard's focus to
    // the page, and the person picking several would have to find the grid again.
    <button
      type="button"
      className="cards__pick"
      onClick={() => {
        if (!added && !busy) onPick();
      }}
      aria-disabled={added || busy}
      aria-pressed={added}
      aria-busy={busy || undefined}
    >
      {/* A calm shimmer while it comes, then a short fade (as list covers do). */}
      <span
        className={
          loaded
            ? "cards__pick-picture cards__pick-picture--shown"
            : "cards__pick-picture cards__pick-picture--waiting"
        }
      >
        <MediaImage
          ref={picture}
          {...sizedFor(found.thumbUrl ?? found.imageUrl, 120)}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
        {added && <Icon name="check" className="cards__pick-tick" />}
      </span>
      <span className="cards__pick-title">{found.title}</span>
      {line !== "" && <span className="cards__pick-sub">{line}</span>}
      {/* The license asks for the name beside the picture. */}
      {credit !== null && (
        <span className="cards__pick-credit" title={found.credit ?? credit}>
          {credit}
        </span>
      )}
    </button>
  );
}
