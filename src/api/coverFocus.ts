/*
 * What the backend says of a cover's focus (CONTRACT, Cover focus), read here
 * so every list, board and topic read from it carries only a valid one; the
 * drawing of it is lib/coverFocus.ts.
 */

/**
 * Where a cover is looked at (_coordination/cover-focus-2026-11-15/SPEC.md):
 * the point of the picture, as fractions of its width and height, that sits
 * in the middle of every frame it is drawn in, and how far it is zoomed in
 * past the largest crop of that frame's shape. Every place a cover is drawn,
 * whatever its shape, crops the picture by `frameOf`, as the app does, so the
 * place chosen shows in a narrow header and a near-square tile alike.
 */
export interface CoverFocus {
  x: number;
  y: number;
  zoom: number;
}

/** None chosen: the middle, at the largest crop, as every cover was drawn before. */
export const CENTRE: CoverFocus = { x: 0.5, y: 0.5, zoom: 1 };

export const FOCUS_ZOOM_MAX = 4;

/** Drawn as before: no focus, or the middle at the largest crop. */
export const isCentre = (focus: CoverFocus | null | undefined): boolean =>
  focus === null ||
  focus === undefined ||
  (focus.x === CENTRE.x && focus.y === CENTRE.y && focus.zoom === CENTRE.zoom);

/**
 * The same place. None is not the middle: without a focus a tall picture
 * shows high (SPEC, second round), so the middle chosen on one is kept.
 */
export const sameFocus = (
  a: CoverFocus | null | undefined,
  b: CoverFocus | null | undefined,
): boolean =>
  a === null || a === undefined || b === null || b === undefined
    ? (a ?? null) === (b ?? null)
    : a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/**
 * A focus as somebody sent it, read with care: numbers in range, anything
 * else none at all. A zoom outside 1–4 or a point off the picture is no focus.
 */
export function focusOf(raw: unknown): CoverFocus | null {
  if (raw === null || typeof raw !== "object") return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  const fraction = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (!fraction(x) || !fraction(y)) return null;
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 1 || zoom > FOCUS_ZOOM_MAX) {
    return null;
  }
  return { x, y, zoom };
}
