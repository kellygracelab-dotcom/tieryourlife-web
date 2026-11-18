import { useState } from "react";
import type { FoundPicture } from "../../api/pictures";
import { sizedFor } from "../../lib/pictureSize";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import { kindName } from "./pictureNames";
import { shortCredit } from "./shortCredit";

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
      <span className="cards__pick-picture">
        <MediaImage
          {...sizedFor(found.thumbUrl ?? found.imageUrl, 120)}
          alt=""
          loading="lazy"
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
