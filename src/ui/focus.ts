/** What the keyboard can reach. */
export const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Hands the focus to the first control after `leaving` in the page, for a
 * part that is about to go while it holds the focus: otherwise the focus
 * falls to the page itself, and the keyboard starts again from the top.
 */
export function focusAfter(leaving: Element): void {
  if (!leaving.contains(document.activeElement)) return;
  const next = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
    (one) =>
      !leaving.contains(one) &&
      (leaving.compareDocumentPosition(one) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  next?.focus();
}
