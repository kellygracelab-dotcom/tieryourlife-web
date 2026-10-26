import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * What a modal dialog owes the keyboard: the focus moves in when it opens
 * (to `initial` when given, the first control otherwise), Tab and Shift+Tab
 * go round inside it, Escape closes it, and closing hands the focus back to
 * whatever opened it. `onClose` may change between renders without the focus
 * jumping: the latest one is called.
 */
export function useModal(
  box: RefObject<HTMLElement | null>,
  onClose: () => void,
  initial?: string,
): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inside = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const start =
      initial === undefined ? undefined : box.current?.querySelector<HTMLElement>(initial);
    (start ?? inside()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab" || box.current === null) return;
      // Every Tab is taken here, not only the one at either end: Safari's
      // default skips buttons and links, and its own next stop could be a
      // field behind the dialog.
      const items = inside();
      if (items.length === 0) return;
      const active = document.activeElement;
      const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next = event.shiftKey
        ? items[at <= 0 ? items.length - 1 : at - 1]
        : items[at === -1 || at === items.length - 1 ? 0 : at + 1];
      event.preventDefault();
      next?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [box, initial]);
}
