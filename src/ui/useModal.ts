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
      const items = inside();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      const away = !(active instanceof Node) || !box.current.contains(active);
      if (event.shiftKey && (away || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (away || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [box, initial]);
}
