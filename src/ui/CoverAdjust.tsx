import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  focusOfFraming,
  framingOfFocus,
  placedBox,
  roundedFocus,
  type CoverFocus,
} from "../lib/coverFocus";
import {
  CENTRED,
  moved,
  NUDGE_LONG_PX,
  NUDGE_PX,
  pinched,
  pointInFrame,
  wheelZoom,
  ZOOM_MAX,
  ZOOM_STEP,
  zoomedAround,
  type Framing,
  type Point,
  type Size,
} from "../lib/framing";
import { strings } from "../strings";
import { Icon } from "./Icon";
import { MediaImage } from "./MediaImage";
import { useModal } from "./useModal";
import "./CoverAdjust.css";

/** The editor's frame: 4:3, as in the app (agreed with Android, 15.11.2026). */
const ADJUST_ASPECT = 4 / 3;

/** How the cover is seen elsewhere, under the frame: a feed's tile here, the app's page header. */
const COVER_PREVIEWS: readonly { label: () => string; aspect: number }[] = [
  { label: () => strings.cover.feed, aspect: 16 / 10 },
  { label: () => strings.cover.pageHeader, aspect: 2.05 },
];

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
const ZOOM_KEYS: Record<string, number> = { "+": ZOOM_STEP, "=": ZOOM_STEP, "-": 1 / ZOOM_STEP };

interface CoverAdjustProps {
  src: string;
  focus: CoverFocus | null;
  /** Kept: where the frame's middle is on the picture, and how near. */
  onDone: (focus: CoverFocus) => void;
  onCancel: () => void;
}

/**
 * Adjust cover (_coordination/cover-focus-2026-11-15/SPEC.md): the picture
 * under a 4:3 frame, the rest of it dimmed around, dragged, pinched, scrolled
 * or keyed into place, zoomed by the slider too; under it the cover as a
 * feed's tile and as the app's page header show it. Done keeps the place,
 * Reset puts it back in the middle, ✕ leaves it as it was.
 */
export function CoverAdjust({ src, focus, onDone, onCancel }: CoverAdjustProps) {
  const titleId = useId();
  const helpId = useId();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [size, setSize] = useState<Size | null>(null);
  const [framing, setFraming] = useState<Framing>(CENTRED);
  useModal(box, onCancel, ".cover-adjust__frame");

  const stage = (picture: Size) => ({ picture, aspect: ADJUST_ASPECT });
  const reframe = (change: (current: Framing, picture: Size) => Framing) => {
    if (size !== null) setFraming((current) => change(current, size));
  };
  const at = (clientX: number, clientY: number): Point | null => {
    const rect = frame.current?.getBoundingClientRect();
    return rect === undefined ? null : pointInFrame(rect, clientX, clientY);
  };

  // The wheel is the mouse's pinch; taken here, or the page behind scrolls.
  useEffect(() => {
    const target = area.current;
    if (target === null || size === null) return;
    const onWheel = (event: WheelEvent) => {
      const rect = frame.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const point = pointInFrame(rect, event.clientX, event.clientY);
      if (point === null) return;
      event.preventDefault();
      const factor = wheelZoom(event.deltaY, event.deltaMode);
      setFraming((current) =>
        zoomedAround(current, factor, point, { picture: size, aspect: ADJUST_ASPECT }),
      );
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [size]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const point = at(event.clientX, event.clientY);
    if (size === null || point === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point);
  };
  // One finger or the mouse moves the picture; a second one pinches it.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    const point = at(event.clientX, event.clientY);
    if (before === undefined || point === null) return;
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, point);
    reframe((current, picture) =>
      other === undefined
        ? moved(current, point.x - before.x, point.y - before.y, stage(picture))
        : pinched(current, [before, other], [point, other], stage(picture)),
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

  const now = size === null ? null : focusOfFraming(framing, size, ADJUST_ASPECT);
  const drawn = (aspect: number): CSSProperties | undefined =>
    size === null || now === null ? undefined : placedBox(size, aspect, now);

  return createPortal(
    <div className="scrim" onClick={onCancel}>
      <div
        ref={box}
        className="dialog cover-adjust"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cover-adjust__head">
          <button
            type="button"
            className="cover-adjust__close"
            aria-label={strings.cover.cancel}
            onClick={onCancel}
          >
            <Icon name="close" />
          </button>
          <h2 id={titleId} className="cover-adjust__title">
            {strings.cover.adjust}
          </h2>
        </div>

        <div
          ref={area}
          className={
            size === null ? "cover-adjust__area cover-adjust__area--waiting" : "cover-adjust__area"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            ref={frame}
            className="cover-adjust__frame"
            role="application"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it takes the arrows, + and −, so it takes the focus
            tabIndex={0}
            aria-label={strings.cover.frame}
            aria-describedby={helpId}
            onKeyDown={onKeyDown}
          >
            <MediaImage
              className="cover-adjust__picture"
              src={src}
              alt=""
              draggable={false}
              style={drawn(ADJUST_ASPECT)}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width === 0 || height === 0) return;
                const picture = { width, height };
                setSize(picture);
                setFraming(
                  focus === null ? CENTRED : framingOfFocus(focus, picture, ADJUST_ASPECT),
                );
              }}
            />
            <span className="cover-adjust__edge" aria-hidden="true" />
          </div>
        </div>
        <p id={helpId} className="visually-hidden">
          {strings.cover.frameHelp}
        </p>

        <label className="cover-adjust__zoom">
          <span>{strings.cover.zoom}</span>
          <input
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            value={framing.zoom}
            disabled={size === null}
            onChange={(event) => {
              const zoom = Number(event.target.value);
              reframe((current, picture) =>
                zoomedAround(current, zoom / current.zoom, { x: 0, y: 0 }, stage(picture)),
              );
            }}
          />
        </label>

        <p className="cover-adjust__label">{strings.cover.preview}</p>
        <div className="cover-adjust__previews">
          {COVER_PREVIEWS.map((preview) => (
            <figure key={preview.aspect} className="cover-adjust__preview">
              <span
                className="cover-adjust__shape"
                style={{ aspectRatio: String(preview.aspect) }}
                aria-hidden="true"
              >
                {size !== null && (
                  <MediaImage
                    className="cover-adjust__picture"
                    src={src}
                    alt=""
                    style={drawn(preview.aspect)}
                  />
                )}
              </span>
              <figcaption>{preview.label()}</figcaption>
            </figure>
          ))}
        </div>

        <div className="cover-adjust__actions">
          <button
            type="button"
            className="btn btn--outlined"
            disabled={size === null}
            onClick={() => setFraming(CENTRED)}
          >
            <span>{strings.cover.reset}</span>
          </button>
          <button
            type="button"
            className="btn btn--filled"
            disabled={now === null}
            onClick={() => {
              if (now !== null) onDone(roundedFocus(now));
            }}
          >
            <span>{strings.cover.done}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
