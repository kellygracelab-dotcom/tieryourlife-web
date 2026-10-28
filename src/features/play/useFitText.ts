import { useLayoutEffect, type RefObject } from "react";

/** A text-only card's name starts at 22/28 and shrinks no further than 14. */
export const NAME_LARGEST = 22;
export const NAME_SMALLEST = 14;

/** The largest whole size from `largest` down at which `fits` says yes; `smallest` when none above it does. */
export function fittedSize(
  fits: (size: number) => boolean,
  largest = NAME_LARGEST,
  smallest = NAME_SMALLEST,
): number {
  for (let size = largest; size > smallest; size--) if (fits(size)) return size;
  return smallest;
}

/**
 * Shrinks a clamped name until it shows whole: the font steps down a pixel
 * at a time, the line height with it in the design's 22/28 proportion, and
 * the window's size is followed, since the card's size follows it.
 */
export function useFitText(element: RefObject<HTMLElement | null>, text: string): void {
  useLayoutEffect(() => {
    const box = element.current;
    // Nothing to fit in a card with no name.
    if (box === null || text === "") return;
    const apply = (size: number) => {
      box.style.fontSize = `${size}px`;
      box.style.lineHeight = `${Math.round((size * 28) / 22)}px`;
    };
    const fit = () =>
      apply(
        fittedSize((size) => {
          apply(size);
          return box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1;
        }),
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [element, text]);
}
