/**
 * Whether something stands over the page around `element`: a modal dialog it
 * is not in, or an open menu. A page's shortcuts on the window wait while it
 * does, or a number pressed in a dialog would move a card behind it.
 */
export function isCovered(element: Element | null): boolean {
  const dialogs = document.querySelectorAll("[aria-modal='true']");
  for (const dialog of dialogs) {
    if (element === null || !dialog.contains(element)) return true;
  }
  return document.querySelector("details.menu[open], [role='menu']") !== null;
}
