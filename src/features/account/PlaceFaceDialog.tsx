import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PixelSquare } from "../../lib/pictures";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import {
  boxOf,
  isMiddle,
  MIDDLE,
  moved,
  NUDGE_LONG_PX,
  NUDGE_PX,
  pinched,
  squareOf,
  wheelZoom,
  ZOOM_STEP,
  zoomedAround,
  type Placing,
  type Point,
  type Size,
} from "./placing";
import "./placing.css";

/** A picture to place: a card's from the catalogue, or a photo from this device. */
export type FaceSource =
  { kind: "card"; url: string } | { kind: "photo"; url: string; name: string };

/** What Use this hands back: the picture on screen and the square of it inside the circle. */
export interface Placed {
  picture: HTMLImageElement;
  square: PixelSquare;
  /** Moved or zoomed: something other than the middle square. */
  moved: boolean;
}

/**
 * The picture on its way, then on show. A card's host may not let the page
 * read it; the second, plain try shows it all the same, to be used as it is.
 */
type Shown =
  | { status: "loading"; plain: boolean }
  | { status: "ready"; size: Size; plain: boolean }
  | { status: "failed" };

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
const ZOOM_KEYS: Record<string, number> = { "+": ZOOM_STEP, "=": ZOOM_STEP, "-": 1 / ZOOM_STEP };

/** A place on screen in the circle's units, from its middle; null before the frame is laid out. */
function pointIn(frame: HTMLElement, clientX: number, clientY: number): Point | null {
  const box = frame.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  return { x: (clientX - box.left) / box.width - 0.5, y: (clientY - box.top) / box.height - 0.5 };
}

const percent = (units: number): string => `${units * 100}%`;

/**
 * Place your face: the chosen picture behind the circle people will see,
 * dragged to place, pinched, scrolled or keyed to zoom, and never with a gap
 * in the circle. Use this hands back the square to cut; for a picture that
 * can only be used as it is, nothing.
 */
export function PlaceFaceDialog({
  source,
  onCancel,
  onUse,
  onUnreadable,
}: {
  source: FaceSource;
  onCancel: () => void;
  onUse: (placed: Placed | null) => void;
  /** A photo from the device the browser cannot draw. */
  onUnreadable: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [shown, setShown] = useState<Shown>({ status: "loading", plain: false });
  const [placing, setPlacing] = useState<Placing>(MIDDLE);
  useModal(box, onCancel, ".placing__frame");

  // Only a picture the page may read can be cut, so only that one moves.
  const size = shown.status === "ready" && !shown.plain ? shown.size : null;

  // The wheel is the mouse's pinch. React listens to it passively, and the
  // page behind would scroll, so it is taken here.
  useEffect(() => {
    const target = frame.current;
    if (target === null || size === null) return;
    const onWheel = (event: WheelEvent) => {
      const at = pointIn(target, event.clientX, event.clientY);
      if (at === null) return;
      event.preventDefault();
      const factor = wheelZoom(event.deltaY, event.deltaMode);
      setPlacing((current) => zoomedAround(current, factor, at, size));
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [size]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const at = pointIn(event.currentTarget, event.clientX, event.clientY);
    if (size === null || at === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, at);
  };

  // One finger or the mouse moves the picture; a second one pinches it.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    const at = pointIn(event.currentTarget, event.clientX, event.clientY);
    if (size === null || before === undefined || at === null) return;
    const other = [...pointers.current].find(([pointer]) => pointer !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, at);
    setPlacing((current) =>
      other === undefined
        ? moved(current, at.x - before.x, at.y - before.y, size)
        : pinched(current, [before, other], [at, other], size),
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
      setPlacing((current) => moved(current, arrow.x * step, arrow.y * step, size));
    } else if (zoom !== undefined) {
      setPlacing((current) => zoomedAround(current, zoom, { x: 0, y: 0 }, size));
    } else {
      return;
    }
    event.preventDefault();
  };

  const onLoad = (picture: HTMLImageElement, plain: boolean) => {
    const { naturalWidth: width, naturalHeight: height } = picture;
    if (width > 0 && height > 0) setShown({ status: "ready", size: { width, height }, plain });
    else onError(plain);
  };

  const onError = (plain: boolean) => {
    if (source.kind === "photo") onUnreadable();
    else setShown(plain ? { status: "failed" } : { status: "loading", plain: true });
  };

  const use = () => {
    const picture = image.current;
    onUse(
      size !== null && picture !== null
        ? { picture, square: squareOf(placing, size), moved: !isMiddle(placing) }
        : null,
    );
  };

  const help =
    shown.status === "failed"
      ? strings.settings.placeFailed
      : shown.status === "ready" && shown.plain
        ? strings.settings.placeAsItIs
        : strings.settings.placeHelp;
  const drawn = shown.status === "ready" ? boxOf(shown.plain ? MIDDLE : placing, shown.size) : null;

  return createPortal(
    <div className="scrim placing__scrim">
      <div
        ref={box}
        className="dialog placing"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {strings.settings.placeTitle}
        </h2>
        <div
          ref={frame}
          className={size === null ? "placing__frame placing__frame--still" : "placing__frame"}
          role="application"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it takes the arrows, + and −, so it takes the focus
          tabIndex={0}
          aria-label={strings.settings.placeFrame}
          aria-describedby={`${id}-help`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {shown.status !== "failed" && (
            // A new element for the plain try: changing crossorigin on the old one would not fetch again.
            <img
              key={shown.plain ? "plain" : "read"}
              ref={image}
              className={
                drawn === null ? "placing__picture placing__picture--waiting" : "placing__picture"
              }
              src={source.url}
              crossOrigin={shown.plain ? undefined : "anonymous"}
              alt=""
              draggable={false}
              style={
                drawn === null
                  ? undefined
                  : {
                      left: percent(drawn.left),
                      top: percent(drawn.top),
                      width: percent(drawn.width),
                      height: percent(drawn.height),
                    }
              }
              onLoad={(event) => onLoad(event.currentTarget, shown.plain)}
              onError={() => onError(shown.plain)}
            />
          )}
          <span className="placing__ring" aria-hidden="true" />
        </div>
        <p id={`${id}-help`} className="placing__help">
          {help}
        </p>
        <div className="dialog__actions">
          <Button onClick={onCancel}>{strings.settings.cancel}</Button>
          <Button
            variant="tonal"
            className="placing__use"
            disabled={shown.status === "loading"}
            onClick={use}
          >
            {strings.settings.placeUse}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
