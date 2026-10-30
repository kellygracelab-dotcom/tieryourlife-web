import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { PublishedTier } from "../../api/types";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";

/** A point on the screen, in the viewport's own pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

interface CardMenuProps {
  /** The card's name, which names the menu. */
  name: string;
  tiers: readonly PublishedTier[];
  /** Where the card is now, or null in the pool. */
  current: number | null;
  /** Where the menu opens: the pointer, or the card's corner from the keyboard. */
  at: ScreenPoint;
  /** Where the focus goes back to when the menu closes. */
  opener: RefObject<HTMLElement | null>;
  onPlace: (tier: number) => void;
  onUnplace: () => void;
  onRemove?: () => void;
  onClose: () => void;
}

/** How far a menu keeps from the window's edges. */
const EDGE = 8;

/**
 * How long the tiers stay once the pointer is on another item: a pointer on
 * its way to a low tier cuts across the items under Move to a tier.
 */
export const TIERS_GRACE_MS = 250;

/** Place a box of this size at `at`, or as near as the window allows. */
function placed(at: ScreenPoint, width: number, height: number, rtl: boolean): ScreenPoint {
  const room = { w: window.innerWidth - EDGE, h: window.innerHeight - EDGE };
  // A menu opens towards the line's end from the pointer, and turns back at the window's edge.
  let x = rtl ? at.x - width : at.x;
  if (x + width > room.w) x = at.x - width;
  if (x < EDGE) x = Math.min(EDGE, room.w - width);
  let y = at.y;
  if (y + height > room.h) y = Math.max(EDGE, room.h - height);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

const isRtl = (node: Element) => getComputedStyle(node).direction === "rtl";

/** The first tier the card can go to, or the first of all. */
function focusFirstTier(box: HTMLElement) {
  const items = [...box.querySelectorAll<HTMLElement>("[role='menuitem']")];
  (items.find((item) => item.getAttribute("aria-disabled") !== "true") ?? items[0])?.focus({
    preventScroll: true,
  });
}

/**
 * A card's menu on a computer, where the pointer is: Move to a tier with the
 * tiers in a menu of their own, Back to the pool, Remove from list. The phone's
 * sheet has the same three (MoveSheet); this is its desktop form, as a right
 * click opens in any app. The keyboard has the menu's own keys: the arrows go
 * up and down and in and out of the tiers, Home and End to either end, Enter
 * or Space to choose, Escape to step back; Tab leaves it. A press anywhere
 * else, a scroll or a resize closes it.
 */
export function CardMenu({
  name,
  tiers,
  current,
  at,
  opener,
  onPlace,
  onUnplace,
  onRemove,
  onClose,
}: CardMenuProps) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const moveItem = useRef<HTMLButtonElement>(null);
  const [where, setWhere] = useState<ScreenPoint | null>(null);
  const [tiersOpen, setTiersOpen] = useState(false);
  const [subWhere, setSubWhere] = useState<ScreenPoint | null>(null);
  // Focus the first tier once the tiers are laid out, when the keyboard opened them.
  const focusTiers = useRef(false);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const leaving = useRef<number | undefined>(undefined);
  const stay = () => window.clearTimeout(leaving.current);
  const leaveTiers = () => {
    stay();
    leaving.current = window.setTimeout(() => setTiersOpen(false), TIERS_GRACE_MS);
  };
  useEffect(() => () => window.clearTimeout(leaving.current), []);

  // Measured first, then shown where it fits; the first item takes the focus.
  useLayoutEffect(() => {
    const box = menu.current;
    if (box === null) return;
    const size = box.getBoundingClientRect();
    setWhere(placed(at, size.width, size.height, isRtl(box)));
    box.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
  }, [at]);

  // The tiers open beside their item, towards the line's end, or back over the menu where there is no room.
  useLayoutEffect(() => {
    if (!tiersOpen) return;
    const item = moveItem.current?.getBoundingClientRect();
    const box = sub.current;
    if (item === undefined || box === null) return;
    const size = box.getBoundingClientRect();
    const rtl = isRtl(box);
    const start = { x: rtl ? item.left : item.right, y: item.top - 4 };
    let spot = placed(start, size.width, size.height, rtl);
    const fits = rtl ? spot.x + size.width <= item.left : spot.x >= item.right;
    if (!fits) spot = { ...spot, x: rtl ? item.right : Math.max(0, item.left - size.width) };
    setSubWhere(placed(spot, size.width, size.height, false));
    if (focusTiers.current) {
      focusTiers.current = false;
      focusFirstTier(box);
    }
  }, [tiersOpen]);

  // Anything outside the menu closes it; the focus goes back to the card on the way out.
  useEffect(() => {
    const card = opener.current;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target !== null && (menu.current?.contains(target) || sub.current?.contains(target))) {
        return;
      }
      close.current();
    };
    const away = () => close.current();
    // The page's own scroll only: a tray that brings its picked card to its
    // start scrolls by itself, and the menu is not in the tray.
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
      if (card?.isConnected === true) card.focus({ preventScroll: true });
    };
  }, [opener]);

  // A press on Move to a tier keeps the tiers open (the pointer opened them on its way);
  // Enter, Space or the arrow also take the focus into them.
  const openTiers = (focus: boolean) => {
    if (tiersOpen) {
      if (focus && sub.current !== null) focusFirstTier(sub.current);
      return;
    }
    focusTiers.current = focus;
    setTiersOpen(true);
  };
  const closeTiers = () => {
    setTiersOpen(false);
    moveItem.current?.focus({ preventScroll: true });
  };

  // The arrows, Home and End within one menu; whatever they do not take is the caller's.
  const roam = (event: KeyboardEvent<HTMLElement>, box: HTMLElement | null): boolean => {
    const items = [...(box?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const now = items.indexOf(document.activeElement as HTMLElement);
    const to: Record<string, number> = {
      ArrowDown: now + 1 >= items.length ? 0 : now + 1,
      ArrowUp: now <= 0 ? items.length - 1 : now - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = to[event.key];
    if (next === undefined) return false;
    event.preventDefault();
    items[next]?.focus({ preventScroll: true });
    return true;
  };
  // The arrow that points into the tiers, and the one back out, follow the line.
  const inward = (event: KeyboardEvent<HTMLElement>) =>
    event.key === (isRtl(event.currentTarget) ? "ArrowLeft" : "ArrowRight");
  const outward = (event: KeyboardEvent<HTMLElement>) =>
    event.key === (isRtl(event.currentTarget) ? "ArrowRight" : "ArrowLeft");

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The board's own keys (a number places, Escape lets go) are not for the board while its menu is open.
    event.stopPropagation();
    if (roam(event, menu.current)) {
      if (tiersOpen) setTiersOpen(false);
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      onClose();
      return;
    }
    if (inward(event) && document.activeElement === moveItem.current) {
      event.preventDefault();
      openTiers(true);
    }
  };
  const onTiersKey = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (roam(event, sub.current)) return;
    if (event.key === "Tab") {
      onClose();
      return;
    }
    if (event.key === "Escape" || outward(event)) {
      event.preventDefault();
      closeTiers();
    }
  };

  // Unplaced, the menu is measured unseen: transparent rather than hidden, since
  // a hidden item cannot take the focus. It is placed before the first paint.
  const hidden = (spot: ScreenPoint | null): CSSProperties =>
    spot === null ? { left: 0, top: 0, opacity: 0 } : { left: spot.x, top: spot.y };

  return createPortal(
    <>
      <div
        ref={menu}
        className="card-menu"
        role="menu"
        tabIndex={-1}
        aria-label={name}
        style={hidden(where)}
        onKeyDown={onMenuKey}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button
          ref={moveItem}
          type="button"
          role="menuitem"
          tabIndex={-1}
          id={`${id}-move`}
          className="card-menu__item"
          aria-haspopup="menu"
          aria-expanded={tiersOpen}
          onClick={(event) => openTiers(event.detail === 0)}
          onPointerEnter={(event) => {
            stay();
            event.currentTarget.focus({ preventScroll: true });
            if (event.pointerType !== "touch") openTiers(false);
          }}
        >
          <span className="card-menu__text">{strings.boards.moveTo}</span>
          <Icon name="chevron_right" className="card-menu__more ms--mirrored" />
        </button>
        {current !== null && (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="card-menu__item"
            onClick={onUnplace}
            onPointerEnter={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              leaveTiers();
            }}
          >
            <span className="card-menu__text">{strings.boards.backToPool}</span>
          </button>
        )}
        {onRemove !== undefined && (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="card-menu__item card-menu__item--danger"
            onClick={onRemove}
            onPointerEnter={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              leaveTiers();
            }}
          >
            <span className="card-menu__text">{strings.boards.removeFromList}</span>
          </button>
        )}
      </div>
      {tiersOpen && (
        <div
          ref={sub}
          className="card-menu card-menu--tiers"
          role="menu"
          tabIndex={-1}
          aria-labelledby={`${id}-move`}
          style={hidden(subWhere)}
          onPointerEnter={stay}
          onKeyDown={onTiersKey}
          onContextMenu={(event) => event.preventDefault()}
        >
          {tiers.map((tier, index) => (
            <button
              key={`${index}-${tier.label}`}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="card-menu__item"
              aria-disabled={index === current}
              onClick={() => {
                if (index !== current) onPlace(index);
              }}
              onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
            >
              <span
                className="card-menu__swatch band"
                style={
                  {
                    "--band-light": tier.colorLight,
                    "--band-dark": tier.colorDark,
                  } as CSSProperties
                }
                aria-hidden="true"
              />
              <span className="card-menu__text">
                <span className="card-menu__label">{tier.label}</span>
                {tier.caption !== null && tier.caption !== "" && (
                  <span className="card-menu__caption">{tier.caption}</span>
                )}
              </span>
              {index === current && (
                <span className="card-menu__note">{strings.boards.currentTier}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}
