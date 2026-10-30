import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  boxOf,
  CENTRED,
  moved,
  NUDGE_LONG_PX,
  NUDGE_PX,
  pinched,
  pointInFrame,
  wheelZoom,
  ZOOM_STEP,
  zoomedAround,
  type Framing,
  type Point,
  type Size,
} from "../../lib/framing";
import { SECTION_PICTURE_MIN } from "../../lib/pictures";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { SECTION_ASPECT, shortOf } from "./proposal";

/**
 * A section's picture in the form: the one it has, left as it is, or one
 * being framed, chosen on this device, kept from a try that failed, or the
 * section's own taken up again to recrop. Its size is known once it loads.
 */
export type PictureValue =
  | { kind: "kept"; url: string }
  | {
      kind: "framed";
      url: string;
      name: string;
      size: Size | null;
      framing: Framing;
      /** Somebody else's host: asked for so the page may draw it, and it may say no. */
      remote: boolean;
    };

/** The sample count under the name in the preview, as a busy section's tile says it. */
const SAMPLE_NEW = 12;

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
const ZOOM_KEYS: Record<string, number> = { "+": ZOOM_STEP, "=": ZOOM_STEP, "-": 1 / ZOOM_STEP };

/** Where the picture sits in a frame of any size: screen geometry, so in the style attribute. */
function placed(framing: Framing, size: Size): CSSProperties {
  const box = boxOf(framing, { picture: size, aspect: SECTION_ASPECT });
  return {
    left: `${box.left * 100}%`,
    top: `${box.top * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

/** The picture as a tile shows it: framed where it was placed, or the section's own, covering. */
function Drawn({ value }: { value: PictureValue }) {
  if (value.kind === "kept") {
    return <img className="crop__picture crop__picture--cover" src={value.url} alt="" />;
  }
  if (value.size === null) return null;
  return (
    <img
      className="crop__picture"
      src={value.url}
      crossOrigin={value.remote ? "anonymous" : undefined}
      alt=""
      draggable={false}
      style={placed(value.framing, value.size)}
    />
  );
}

/** The label a tile wears: the icon and the name, white on the scrim, bottom-start. */
function TileLabel({ name, icon, sample }: { name: string; icon: IconName; sample: boolean }) {
  return (
    <span className="crop__label">
      <span className="crop__name">
        <Icon name={icon} className="crop__icon" />
        <span className={name === "" ? "crop__text crop__text--empty" : "crop__text"}>
          {name === "" ? strings.propose.namePlaceholder : name}
        </span>
      </span>
      {sample && (
        <span className="crop__sample" title={strings.propose.sample}>
          {plural(strings.sections.newThisWeek, SAMPLE_NEW)}
        </span>
      )}
    </span>
  );
}

interface PictureFieldProps {
  value: PictureValue | null;
  onChange: Dispatch<SetStateAction<PictureValue | null>>;
  /** What went wrong with the picture, said under it. */
  trouble: string | null;
  onTrouble: (text: string | null) => void;
  /** The name and icon as typed and picked, for the live label. */
  name: string;
  icon: IconName;
  /** The frame's own picture, for the crop to be drawn from. */
  image: RefObject<HTMLImageElement | null>;
  /** The owner's edit: Recrop and Replace rather than Change picture. */
  editing?: boolean;
  /** The home page's two tile sizes under the crop: a section's, and no topic's. */
  thumbs?: boolean;
}

/**
 * The picture of a section in the making (docs/design-spec-admin.md, 2.3):
 * a drop zone until there is one, then the crop step in its place, a fixed
 * 16:10 frame the picture is dragged, pinched, scrolled or keyed into, with
 * the tile's own label over it and the tile at the home page's two sizes
 * under it. A picture too small for the tile is refused here, before it
 * goes anywhere.
 */
export function PictureField({
  value,
  onChange,
  trouble,
  onTrouble,
  name,
  icon,
  image,
  editing = false,
  thumbs = true,
}: PictureFieldProps) {
  const id = useId();
  const frame = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [paper, setPaper] = useState<"light" | "dark">("light");
  const [dragging, setDragging] = useState(false);

  const framed = value?.kind === "framed" ? value : null;
  const size = framed?.size ?? null;
  const shownName = name.trim();

  // A photo from this device is shown from an address of its own, and only while it is here.
  const ownUrl = framed !== null && framed.url.startsWith("blob:") ? framed.url : null;
  useEffect(() => {
    if (ownUrl === null) return;
    return () => URL.revokeObjectURL(ownUrl);
  }, [ownUrl]);

  const reframe = (change: (framing: Framing, size: Size) => Framing) =>
    onChange((current) =>
      current?.kind === "framed" && current.size !== null
        ? { ...current, framing: change(current.framing, current.size) }
        : current,
    );
  const stage = (picture: Size) => ({ picture, aspect: SECTION_ASPECT });

  // The wheel is the mouse's pinch. React listens to it passively, and the
  // dialog behind would scroll, so it is taken here.
  useEffect(() => {
    const target = frame.current;
    if (target === null || size === null) return;
    const onWheel = (event: WheelEvent) => {
      const at = pointInFrame(target.getBoundingClientRect(), event.clientX, event.clientY);
      if (at === null) return;
      event.preventDefault();
      const factor = wheelZoom(event.deltaY, event.deltaMode);
      onChange((current) =>
        current?.kind === "framed" && current.size !== null
          ? {
              ...current,
              framing: zoomedAround(current.framing, factor, at, {
                picture: current.size,
                aspect: SECTION_ASPECT,
              }),
            }
          : current,
      );
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [size, onChange]);

  const choose = (file: File) => {
    if (!file.type.startsWith("image/")) {
      onTrouble(fill(strings.new.pictureNotImage, { name: file.name }));
      return;
    }
    onTrouble(null);
    onChange({
      kind: "framed",
      url: URL.createObjectURL(file),
      name: file.name,
      size: null,
      framing: CENTRED,
      remote: false,
    });
  };

  // A picture copied elsewhere arrives with a paste, while there is none yet.
  const empty = value === null;
  useEffect(() => {
    if (!empty) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((one) =>
        one.type.startsWith("image/"),
      );
      if (file === undefined) return;
      event.preventDefault();
      choose(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const onLoad = (picture: HTMLImageElement) => {
    if (framed === null) return;
    const loaded = { width: picture.naturalWidth, height: picture.naturalHeight };
    if (loaded.width === 0 || loaded.height === 0) {
      onError();
      return;
    }
    const short = shortOf(loaded);
    if (short !== null) {
      onChange(framed.remote ? { kind: "kept", url: framed.url } : null);
      onTrouble(fill(strings.propose.tooSmall, { width: short, min: SECTION_PICTURE_MIN.width }));
      return;
    }
    onChange({ ...framed, size: loaded });
  };

  const onError = () => {
    if (framed === null) return;
    if (framed.remote) {
      onChange({ kind: "kept", url: framed.url });
      onTrouble(strings.admin.recropFailed);
    } else {
      onChange(null);
      onTrouble(fill(strings.new.pictureNotImage, { name: framed.name }));
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const at = pointInFrame(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    if (size === null || at === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, at);
  };

  // One finger or the mouse moves the picture; a second one pinches it.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    const at = pointInFrame(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    if (size === null || before === undefined || at === null) return;
    const other = [...pointers.current].find(([pointer]) => pointer !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, at);
    reframe((current, picture) =>
      other === undefined
        ? moved(current, at.x - before.x, at.y - before.y, stage(picture))
        : pinched(current, [before, other], [at, other], stage(picture)),
    );
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const width = event.currentTarget.getBoundingClientRect().width;
    if (size === null || width === 0) return;
    const arrow = ARROWS[event.key];
    const zoom = ZOOM_KEYS[event.key];
    if (arrow !== undefined) {
      const step = (event.shiftKey ? NUDGE_LONG_PX : NUDGE_PX) / width;
      reframe((current, picture) => moved(current, arrow.x * step, arrow.y * step, stage(picture)));
    } else if (zoom !== undefined) {
      reframe((current, picture) => zoomedAround(current, zoom, { x: 0, y: 0 }, stage(picture)));
    } else {
      return;
    }
    event.preventDefault();
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) choose(file);
  };

  const pickFile = () => picker.current?.click();
  const shown = value !== null && (value.kind === "kept" || value.size !== null);
  // The section's own picture taken up again loads behind the one on show, not behind a drop zone.
  const dropZone = value === null || (framed !== null && size === null && !framed.remote);

  return (
    <div className="picture-field">
      {dropZone && (
        <button
          type="button"
          className={dragging ? "drop-zone drop-zone--over" : "drop-zone"}
          aria-describedby={trouble === null ? undefined : `${id}-trouble`}
          onClick={pickFile}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Icon name="add_photo_alternate" className="drop-zone__icon" />
          <span className="drop-zone__title">{strings.propose.addPicture}</span>
          <span className="drop-zone__hint">
            {fill(strings.propose.pictureHint, { min: SECTION_PICTURE_MIN.width })}
          </span>
        </button>
      )}

      {value !== null && (
        <div
          ref={frame}
          className={["crop", shown ? "" : "crop--loading", size === null ? "crop--still" : ""]
            .filter(Boolean)
            .join(" ")}
          role="application"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it takes the arrows, + and −, so it takes the focus
          tabIndex={size === null ? -1 : 0}
          aria-label={strings.propose.frame}
          aria-describedby={`${id}-help`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {value.kind === "kept" ? (
            <img
              ref={image}
              className="crop__picture crop__picture--cover"
              src={value.url}
              alt=""
            />
          ) : (
            // A new element for each picture: a changed crossorigin would not fetch again.
            <img
              key={value.url}
              ref={image}
              className={
                value.size === null ? "crop__picture crop__picture--waiting" : "crop__picture"
              }
              src={value.url}
              crossOrigin={value.remote ? "anonymous" : undefined}
              alt=""
              draggable={false}
              style={value.size === null ? undefined : placed(value.framing, value.size)}
              onLoad={(event) => onLoad(event.currentTarget)}
              onError={onError}
            />
          )}
          <span className="crop__scrim" aria-hidden="true" />
          <span className="crop__safe" aria-hidden="true" />
          <span aria-hidden="true">
            <TileLabel name={shownName} icon={icon} sample />
          </span>
        </div>
      )}
      <p id={`${id}-help`} className="visually-hidden">
        {strings.propose.frameHelp}
      </p>

      {shown && (
        <>
          <div className="crop-row">
            {value.kind === "kept" ? (
              <>
                <Button
                  onClick={() =>
                    onChange({
                      kind: "framed",
                      url: value.url,
                      name: "",
                      size: null,
                      framing: CENTRED,
                      remote: true,
                    })
                  }
                >
                  {strings.admin.recrop}
                </Button>
                <Button onClick={pickFile}>{strings.admin.replace}</Button>
              </>
            ) : (
              <Button onClick={pickFile}>
                {editing ? strings.admin.replace : strings.propose.changePicture}
              </Button>
            )}
            <div className="segmented" role="group" aria-label={strings.propose.paper}>
              {(["light", "dark"] as const).map((one) => (
                <button
                  key={one}
                  type="button"
                  className="segmented__option"
                  aria-pressed={paper === one}
                  onClick={() => setPaper(one)}
                >
                  {paper === one && <Icon name="check" className="segmented__check" />}
                  {one === "light" ? strings.nav.themeLight : strings.nav.themeDark}
                </button>
              ))}
            </div>
          </div>
          {thumbs && (
            <figure className={`crop-thumbs crop-thumbs--${paper}`}>
              <div className="crop-thumbs__row">
                {(["phone", "desktop"] as const).map((at) => (
                  <span
                    key={at}
                    className={`crop-thumb crop-thumb--${at}`}
                    role="img"
                    aria-label={at === "phone" ? strings.propose.phone : strings.propose.desktop}
                  >
                    <span className="crop-thumb__frame">
                      <Drawn value={value} />
                    </span>
                    <span className="crop__scrim" />
                    <TileLabel name={shownName} icon={icon} sample={false} />
                  </span>
                ))}
              </div>
              <figcaption className="crop-thumbs__caption">{strings.propose.thumbs}</figcaption>
            </figure>
          )}
        </>
      )}

      {trouble !== null && (
        <p id={`${id}-trouble`} className="picture-field__trouble" role="alert">
          {trouble}
        </p>
      )}

      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="picture-field__picker"
        aria-label={strings.propose.choosePicture}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) choose(file);
        }}
      />
    </div>
  );
}
