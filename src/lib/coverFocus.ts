import { FOCUS_ZOOM_MAX, type CoverFocus } from "../api/coverFocus";
import { held, shownSize, type Framing, type PixelRect, type Size } from "./framing";

export {
  CENTRE,
  FOCUS_ZOOM_MAX,
  focusOf,
  isCentre,
  sameFocus,
  type CoverFocus,
} from "../api/coverFocus";

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The SPEC's frame, to the letter: the part of a W×H picture a frame of
 * width / height `aspect` shows for a focus, in the picture's own pixels.
 */
export function frameOf(picture: Size, aspect: number, focus: CoverFocus): PixelRect {
  const { width: w, height: h } = picture;
  let cw: number;
  let ch: number;
  if (w / h > aspect) {
    ch = h;
    cw = h * aspect;
  } else {
    cw = w;
    ch = w / aspect;
  }
  cw /= focus.zoom;
  ch /= focus.zoom;
  return {
    left: clamp(focus.x * w - cw / 2, 0, w - cw),
    top: clamp(focus.y * h - ch / 2, 0, h - ch),
    width: cw,
    height: ch,
  };
}

/**
 * Where the picture is drawn so the frame is what shows, as percentages of
 * the element it fills: a box of any size with that shape draws the same part.
 */
export function placedBox(
  picture: Size,
  aspect: number,
  focus: CoverFocus,
): { left: string; top: string; width: string; height: string } {
  const frame = frameOf(picture, aspect, focus);
  const percent = (value: number) => `${value * 100}%`;
  return {
    left: percent(-frame.left / frame.width),
    top: percent(-frame.top / frame.height),
    width: percent(picture.width / frame.width),
    height: percent(picture.height / frame.height),
  };
}

/**
 * The editor holds a picture the framing way (src/lib/framing.ts): moved from
 * the middle in the frame's units. Its focus is the point at the frame's
 * middle, the zoom the same.
 */
export function focusOfFraming(framing: Framing, picture: Size, aspect: number): CoverFocus {
  const shown = shownSize({ picture, aspect }, framing.zoom);
  return {
    x: clamp(0.5 - framing.x / shown.width, 0, 1),
    y: clamp(0.5 - framing.y / shown.height, 0, 1),
    zoom: framing.zoom,
  };
}

/** And back: a focus as the editor holds it, held where the picture covers its frame. */
export function framingOfFocus(focus: CoverFocus, picture: Size, aspect: number): Framing {
  const stage = { picture, aspect };
  const shown = shownSize(stage, clamp(focus.zoom, 1, FOCUS_ZOOM_MAX));
  return held(
    {
      zoom: focus.zoom,
      x: (0.5 - focus.x) * shown.width,
      y: (0.5 - focus.y) * shown.height,
    },
    stage,
  );
}

/** Rounded for keeping: four places say where, two how near; the middle stays exactly the middle. */
export const roundedFocus = (focus: CoverFocus): CoverFocus => ({
  x: Math.round(focus.x * 10_000) / 10_000,
  y: Math.round(focus.y * 10_000) / 10_000,
  zoom: Math.round(focus.zoom * 100) / 100,
});
