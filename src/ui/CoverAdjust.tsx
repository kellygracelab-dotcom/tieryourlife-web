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
  defaultFocusOf,
  FOCUS_ZOOM_MAX,
  frameOf,
  keptFocus,
  placedBox,
  shownFocus,
  type CoverFocus,
} from "../lib/coverFocus";
import { wheelZoom, ZOOM_STEP, type Size } from "../lib/framing";
import { strings } from "../strings";
import { Icon } from "./Icon";
import { LIST_COVER_PREVIEWS, type FocusPreview } from "./focusPreviews";
import { MediaImage } from "./MediaImage";
import { useModal } from "./useModal";
import "./CoverAdjust.css";

/** One press of an arrow moves the focus by this much of the picture; with Shift, the long step. */
const NUDGE = 0.02;
const NUDGE_LONG = 0.1;
/** A press that moved less than this many pixels is a tap: the focus goes where it landed. */
const TAP_PX = 6;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
const ZOOM_KEYS: Record<string, number> = { "+": ZOOM_STEP, "=": ZOOM_STEP, "-": 1 / ZOOM_STEP };

const withZoom = (focus: CoverFocus, zoom: number): CoverFocus => ({
  ...focus,
  zoom: clamp(zoom, 1, FOCUS_ZOOM_MAX),
});

interface CoverAdjustProps {
  src: string;
  focus: CoverFocus | null;
  /** The shapes the picture shows in, the widest first: its frame is drawn on the picture. */
  previews?: readonly FocusPreview[];
  /** The dialog's title; Adjust cover unless said. */
  title?: string;
  /** Kept: the point the picture is looked at and how near, or null for its default. */
  onDone: (focus: CoverFocus | null) => void;
  onCancel: () => void;
}

/**
 * Adjust cover (_coordination/cover-focus-2026-11-15/SPEC.md, second round):
 * the whole picture, with the point it is looked at and the frame of its
 * widest shape on it, the rest dimmed. The point moves anywhere on the
 * picture, both ways: dragged, tapped, or keyed with the arrows; the slider,
 * a pinch, the wheel and + and − zoom. Under it each shape the picture shows
 * in, cut by the shared formula. Done keeps the place, Reset puts back the
 * picture's default, ✕ leaves it as it was.
 */
/** The previews' greatest height and the gap between them, in px. */
const PREVIEW_HIGH = 132;
const PREVIEW_GAP = 12;

export function CoverAdjust({
  src,
  focus,
  previews = LIST_COVER_PREVIEWS,
  title = strings.cover.adjust,
  onDone,
  onCancel,
}: CoverAdjustProps) {
  const titleId = useId();
  const helpId = useId();
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** Where the press began and whether it has moved past a tap. */
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [now, setNow] = useState<CoverFocus | null>(null);
  useModal(box, onCancel, ".cover-adjust__stage");

  const main = previews[0]?.aspect ?? 2.05;
  const change = (next: (current: CoverFocus) => CoverFocus) =>
    setNow((current) => (current === null ? current : next(current)));

  // The wheel is the mouse's pinch; taken here, or the page behind scrolls.
  useEffect(() => {
    const target = stage.current;
    if (target === null || size === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = wheelZoom(event.deltaY, event.deltaMode);
      setNow((current) => (current === null ? current : withZoom(current, current.zoom * factor)));
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [size]);

  /** A point on the screen as a place on the picture, 0 to 1 both ways. */
  const onPicture = (clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (now === null) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    press.current =
      pointers.current.size === 1 ? { x: event.clientX, y: event.clientY, moved: false } : null;
  };
  // One finger or the mouse moves the point with it; a second one pinches.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    const rect = stage.current?.getBoundingClientRect();
    if (before === undefined || rect === undefined || rect.width === 0) return;
    const point = { x: event.clientX, y: event.clientY };
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, point);
    if (press.current !== null && !press.current.moved) {
      const far = Math.hypot(point.x - press.current.x, point.y - press.current.y);
      if (far < TAP_PX) return;
      press.current.moved = true;
    }
    if (other === undefined) {
      const dx = (point.x - before.x) / rect.width;
      const dy = (point.y - before.y) / rect.height;
      change((current) => ({
        ...current,
        x: clamp(current.x + dx, 0, 1),
        y: clamp(current.y + dy, 0, 1),
      }));
    } else {
      const was = Math.hypot(before.x - other.x, before.y - other.y);
      const is = Math.hypot(point.x - other.x, point.y - other.y);
      if (was > 0) change((current) => withZoom(current, (current.zoom * is) / was));
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const tap = press.current !== null && !press.current.moved && pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (event.type === "pointerup" && tap) {
      const place = onPicture(event.clientX, event.clientY);
      if (place !== null) {
        change((current) => ({ ...current, x: clamp(place.x, 0, 1), y: clamp(place.y, 0, 1) }));
      }
    }
    if (pointers.current.size === 0) press.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (now === null) return;
    const arrow = ARROWS[event.key];
    const zoom = ZOOM_KEYS[event.key];
    if (arrow !== undefined) {
      const step = event.shiftKey ? NUDGE_LONG : NUDGE;
      change((current) => ({
        ...current,
        x: clamp(current.x + arrow.x * step, 0, 1),
        y: clamp(current.y + arrow.y * step, 0, 1),
      }));
    } else if (zoom !== undefined) {
      change((current) => withZoom(current, current.zoom * zoom));
    } else {
      return;
    }
    event.preventDefault();
  };

  const drawn = (aspect: number): CSSProperties | undefined =>
    size === null || now === null ? undefined : placedBox(size, aspect, now);
  // The widest shape's frame on the whole picture, in its own percentages.
  const edge = (): CSSProperties | undefined => {
    if (size === null || now === null) return undefined;
    const rect = frameOf(size, main, now);
    const percent = (part: number, whole: number) => `${(part / whole) * 100}%`;
    return {
      left: percent(rect.left, size.width),
      top: percent(rect.top, size.height),
      width: percent(rect.width, size.width),
      height: percent(rect.height, size.height),
    };
  };
  const ratio = size === null ? 4 / 3 : size.width / size.height;

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
            {title}
          </h2>
        </div>

        <div
          className={
            size === null ? "cover-adjust__area cover-adjust__area--waiting" : "cover-adjust__area"
          }
        >
          <div
            ref={stage}
            className="cover-adjust__stage"
            style={{
              aspectRatio: String(ratio),
              width: `min(100%, calc(var(--cover-adjust-height) * ${ratio}))`,
            }}
            role="application"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it takes the arrows, + and −, so it takes the focus
            tabIndex={0}
            aria-label={strings.cover.frame}
            aria-describedby={helpId}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <MediaImage
              className="cover-adjust__whole"
              src={src}
              alt=""
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width === 0 || height === 0) return;
                const picture = { width, height };
                setSize(picture);
                setNow(shownFocus(focus, picture));
              }}
            />
            {now !== null && (
              <>
                <span className="cover-adjust__edge" style={edge()} aria-hidden="true" />
                <span
                  className="cover-adjust__point"
                  style={{ left: `${now.x * 100}%`, top: `${now.y * 100}%` }}
                  aria-hidden="true"
                />
              </>
            )}
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
            max={FOCUS_ZOOM_MAX}
            step={0.01}
            value={now?.zoom ?? 1}
            disabled={now === null}
            onChange={(event) => {
              const zoom = Number(event.target.value);
              change((current) => withZoom(current, zoom));
            }}
          />
        </label>

        <p className="cover-adjust__label">{strings.cover.preview}</p>
        <div
          className="cover-adjust__previews"
          style={{
            gridTemplateColumns: previews.map((preview) => `${preview.aspect}fr`).join(" "),
            // At most PREVIEW_HIGH tall: tall shapes (a card's tile) stay small.
            width: `min(100%, ${
              previews.reduce((sum, preview) => sum + preview.aspect, 0) * PREVIEW_HIGH +
              PREVIEW_GAP * (previews.length - 1)
            }px)`,
          }}
        >
          {previews.map((preview) => (
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
            onClick={() => {
              if (size !== null) setNow(defaultFocusOf(size));
            }}
          >
            <span>{strings.cover.reset}</span>
          </button>
          <button
            type="button"
            className="btn btn--filled"
            disabled={now === null || size === null}
            onClick={() => {
              if (now !== null && size !== null) onDone(keptFocus(now, size));
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
