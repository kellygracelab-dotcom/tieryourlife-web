import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "../../ui/backLayers";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { placed, type ScreenPoint } from "../tierboard/CardMenu";
import "./boards.css";

export interface ListMenuEntry {
  key: string;
  icon: IconName;
  text: string;
  onSelect: () => void;
  /** Delete and Discard: red, last, under a line. */
  danger?: boolean;
  /** Stays in the menu and says why under its word, as Play with fewer than three cards. */
  disabled?: boolean;
  note?: string;
  /** The key that does the same on the list, shown where there is a keyboard. */
  keys?: string;
  /** A line before it. */
  line?: boolean;
}

interface ListMenuProps {
  /** What the menu is read as. */
  label: string;
  /** The list's name over the items and what it holds, or nothing over them. */
  title?: string;
  meta?: string;
  entries: readonly ListMenuEntry[];
  /** The pointer, or the list's corner from the keyboard. */
  at: ScreenPoint;
  onClose: () => void;
}

const isRtl = (node: Element) => getComputedStyle(node).direction === "rtl";

/**
 * A list's own menu in Your lists (artboard 39): a right click, ⋮, a long
 * press or the menu key opens it where the pointer is, or at the list's corner,
 * and it turns back at the window's edge. The account menu's look: an icon,
 * the word, the key that does the same; Delete red and last. The arrows,
 * Home and End go through it, Enter or Space choose, Escape or Tab leave it;
 * a press elsewhere, a scroll or a resize closes it. The focus goes back to
 * what it came from, unless the item chosen took it somewhere.
 */
export function ListMenu({ label, title, meta, entries, at, onClose }: ListMenuProps) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [where, setWhere] = useState<ScreenPoint | null>(null);
  // What had the focus as the menu opened: read while drawing, before the first item takes it.
  const [before] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const box = menu.current;
    if (box === null) return;
    const size = box.getBoundingClientRect();
    setWhere(placed(at, size.width, size.height, isRtl(box)));
    box.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const box = menu.current;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target !== null && box?.contains(target)) return;
      close.current();
    };
    const away = () => close.current();
    const scrolled = (event: Event) => {
      if (event.target === document || event.target === document.documentElement) away();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", away);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
      // Back where it was, unless the choice moved it (Rename's field, the next list after Delete).
      const now = document.activeElement;
      const lost = now === null || now === document.body || box?.contains(now) === true;
      if (lost && before?.isConnected === true) before.focus({ preventScroll: true });
    };
  }, [before]);
  useBackLayer(true, onClose);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The page's own keys (Delete, F2) are not for the lists while the menu is open.
    event.stopPropagation();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const now = items.indexOf(document.activeElement as HTMLElement);
    const to: Record<string, number> = {
      ArrowDown: now + 1 >= items.length ? 0 : now + 1,
      ArrowUp: now <= 0 ? items.length - 1 : now - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = to[event.key];
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menu}
      className="list-menu"
      role="menu"
      tabIndex={-1}
      aria-label={label}
      aria-describedby={title === undefined ? undefined : `${id}-head`}
      style={where === null ? { left: 0, top: 0, opacity: 0 } : { left: where.x, top: where.y }}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {title !== undefined && (
        <>
          <div className="list-menu__head" id={`${id}-head`}>
            <bdi className="list-menu__title">{title}</bdi>
            {meta !== undefined && <span className="list-menu__meta">{meta}</span>}
          </div>
          <div className="list-menu__line" role="separator" />
        </>
      )}
      {entries.map((entry) => (
        <div key={entry.key} className="list-menu__entry">
          {entry.line === true && <div className="list-menu__line" role="separator" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={
              entry.danger === true ? "list-menu__item list-menu__item--danger" : "list-menu__item"
            }
            aria-disabled={entry.disabled === true || undefined}
            aria-keyshortcuts={entry.keys}
            onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
            onClick={() => {
              if (entry.disabled === true) return;
              onClose();
              entry.onSelect();
            }}
          >
            <Icon name={entry.icon} className="list-menu__icon" />
            <span className="list-menu__text">
              <span>{entry.text}</span>
              {entry.note !== undefined && <span className="list-menu__note">{entry.note}</span>}
            </span>
            {entry.keys !== undefined && (
              <span className="list-menu__keys" aria-hidden="true">
                {entry.keys === "Delete" ? "Del" : entry.keys}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
