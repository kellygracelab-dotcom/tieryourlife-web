/**
 * A picture behind a frame of fixed shape, the way the face dialog places a
 * face in its circle, for any aspect: a section's 16:10 tile, a cover, a
 * banner. The frame is 1 wide and 1 / aspect tall; the picture at zoom 1 just
 * covers it; x and y move the picture's middle from the frame's. Kept in
 * these units, so a frame drawn at another size (a dialog's 512, a phone's
 * 358) holds the same crop, and a smaller copy of the same picture too.
 */
export interface Framing {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A place in the frame's units (frame widths, both ways), from its middle. */
export interface Point {
  x: number;
  y: number;
}

/** The picture behind a frame: its own size in pixels and the frame's width over height. */
export interface Stage {
  picture: Size;
  aspect: number;
}

/** A rectangle of a picture, in the picture's own pixels. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** As far as a picture zooms in: four times the size that just covers the frame. */
export const ZOOM_MAX = 4;
/** One press of + or − zooms by a tenth. */
export const ZOOM_STEP = 1.1;
/** One press of an arrow moves the picture this far on screen; with Shift, the long step. */
export const NUDGE_PX = 8;
export const NUDGE_LONG_PX = 32;
/** A wheel's notch is some 100 px; this many make the picture e times larger or smaller. */
const WHEEL_PX_PER_E = 500;
/** A wheel that counts in lines or pages, in pixels. */
const LINE_PX = 16;
const PAGE_PX = 800;

/** Nothing moved yet: the middle of the picture, at the size that just covers the frame. */
export const CENTRED: Framing = { zoom: 1, x: 0, y: 0 };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export const isCentred = (framing: Framing): boolean =>
  framing.zoom === CENTRED.zoom && framing.x === CENTRED.x && framing.y === CENTRED.y;

/** The frame's height in its own units: a 16:10 frame is 1 wide and 0.625 tall. */
export const frameHeight = (aspect: number): number => 1 / aspect;

/**
 * The picture's size behind the frame at a zoom, in the frame's units. A
 * picture wider than the frame is held by its height, a narrower one by its
 * width; worked out from the ratio, so a picture of the frame's own shape
 * comes out exactly 1 wide.
 */
export function shownSize({ picture, aspect }: Stage, zoom: number): Size {
  const ratio = picture.width / picture.height;
  return ratio >= aspect
    ? { width: (ratio / aspect) * zoom, height: frameHeight(aspect) * zoom }
    : { width: zoom, height: zoom / ratio };
}

/**
 * Held where the picture still covers the whole frame, so the crop never has
 * a gap at an edge, and zoomed no less than 1 and no more than 4.
 */
export function held(framing: Framing, stage: Stage): Framing {
  const zoom = clamp(framing.zoom, 1, ZOOM_MAX);
  const shown = shownSize(stage, zoom);
  // A rounding error must not leave a reach below nought, which would flip the clamp.
  const reachX = Math.max(0, (shown.width - 1) / 2);
  const reachY = Math.max(0, (shown.height - frameHeight(stage.aspect)) / 2);
  // Plus nought: a clamp can answer -0, and a picture put back in the middle should be the middle.
  return {
    zoom,
    x: clamp(framing.x, -reachX, reachX) + 0,
    y: clamp(framing.y, -reachY, reachY) + 0,
  };
}

/** Moved by dx, dy in the frame's units, then held. */
export const moved = (framing: Framing, dx: number, dy: number, stage: Stage): Framing =>
  held({ ...framing, x: framing.x + dx, y: framing.y + dy }, stage);

/**
 * Zoomed by a factor around a point, so the part of the picture under the
 * point stays under it, then held.
 */
export function zoomedAround(
  framing: Framing,
  factor: number,
  point: Point,
  stage: Stage,
): Framing {
  const zoom = clamp(framing.zoom * factor, 1, ZOOM_MAX);
  const grown = zoom / framing.zoom;
  return held(
    {
      zoom,
      x: point.x - (point.x - framing.x) * grown,
      y: point.y - (point.y - framing.y) * grown,
    },
    stage,
  );
}

/**
 * Two fingers that moved from `before` to `after`: the picture follows the
 * point between them and grows as far as they spread, around that point.
 */
export function pinched(
  framing: Framing,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
  stage: Stage,
): Framing {
  const middle = ([a, b]: readonly [Point, Point]): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const apart = ([a, b]: readonly [Point, Point]): number => Math.hypot(a.x - b.x, a.y - b.y);
  const from = middle(before);
  const to = middle(after);
  const spread = apart(before) === 0 ? 1 : apart(after) / apart(before);
  return zoomedAround(moved(framing, to.x - from.x, to.y - from.y, stage), spread, to, stage);
}

/** A wheel's turn as a zoom: away from the person zooms in, towards them out. */
export function wheelZoom(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  return Math.exp(-pixels / WHEEL_PX_PER_E);
}

/**
 * A place on screen in the frame's units, from its middle; null before the
 * frame is laid out. Both ways are measured in frame widths, so a drag moves
 * the picture as far up as it does across.
 */
export function pointInFrame(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): Point | null {
  if (box.width === 0 || box.height === 0) return null;
  return {
    x: (clientX - box.left) / box.width - 0.5,
    y: (clientY - box.top - box.height / 2) / box.width,
  };
}

/**
 * Where the picture is drawn, as fractions of the frame: left and width of
 * its width, top and height of its height. A frame of any size draws the same
 * crop from these, as percentages.
 */
export function boxOf(framing: Framing, stage: Stage): Size & { left: number; top: number } {
  const shown = shownSize(stage, framing.zoom);
  const tall = frameHeight(stage.aspect);
  return {
    left: 0.5 + framing.x - shown.width / 2,
    top: (tall / 2 + framing.y - shown.height / 2) / tall,
    width: shown.width,
    height: shown.height / tall,
  };
}

/**
 * The part of the picture inside the frame, in the picture's own pixels:
 * what gets exported. Rounded, of the frame's shape to the pixel, and always
 * inside the picture, whatever rounding would leave hanging over an edge.
 */
export function cropOf(framing: Framing, stage: Stage): PixelRect {
  const { picture, aspect } = stage;
  const shown = shownSize(stage, framing.zoom);
  // The frame's width in the picture's pixels.
  const unit = picture.width / shown.width;
  const width = clamp(Math.round(unit), 1, picture.width);
  const height = clamp(Math.round(width / aspect), 1, picture.height);
  return {
    left: clamp(Math.round((shown.width / 2 - framing.x - 0.5) * unit), 0, picture.width - width),
    top: clamp(
      Math.round((shown.height / 2 - framing.y - frameHeight(aspect) / 2) * unit),
      0,
      picture.height - height,
    ),
    width,
    height,
  };
}
