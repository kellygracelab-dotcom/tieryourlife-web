import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./NameTip.css";

/** A card drawn by its picture: its name is in its label, and nowhere to be seen. */
const PICTURED = ".tile[aria-label]:not(.tile--name)";

/** Kept this far from the card and from the window's edges. */
const GAP = 6;
const MARGIN = 8;

interface Shown {
  name: string;
  card: DOMRect;
}

function cardAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(PICTURED) : null;
}

/**
 * A pictured card's name over it, for as long as a mouse or a pen rests on
 * it or the keyboard is on it: on one's own board, somebody else's list and
 * the pool alike, in every way a board is drawn. A finger has no hover, and
 * its tap goes on doing what it did; a held button is a drag, which shows
 * the card itself.
 */
export function NameTip() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    const show = (card: HTMLElement) => {
      const name = card.getAttribute("aria-label") ?? "";
      setShown(name === "" ? null : { name, card: card.getBoundingClientRect() });
    };
    const hide = () => setShown(null);
    const onOver = (event: PointerEvent) => {
      const card = cardAt(event.target);
      if (card === null || event.pointerType === "touch" || event.buttons !== 0) hide();
      else show(card);
    };
    const onOut = (event: PointerEvent) => {
      if (cardAt(event.target) !== cardAt(event.relatedTarget)) hide();
    };
    const onFocus = (event: FocusEvent) => {
      const card = cardAt(event.target);
      if (card !== null && card === event.target && card.matches(":focus-visible")) show(card);
      else hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);
  return shown === null ? null : createPortal(<Tip {...shown} />, document.body);
}

/** Above the card, or under it where the window has no room above; never past its sides. */
function Tip({ name, card }: Shown) {
  const tip = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = tip.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const middle = (card.left + card.right) / 2;
    const widest = document.documentElement.clientWidth - MARGIN - width;
    const left = Math.max(MARGIN, Math.min(middle - width / 2, widest));
    const above = card.top - GAP - height;
    setPlace({ left, top: above >= MARGIN ? above : card.bottom + GAP });
  }, [name, card]);
  return (
    <div
      ref={tip}
      className="name-tip"
      role="tooltip"
      dir="auto"
      style={place === null ? { visibility: "hidden" } : { left: place.left, top: place.top }}
    >
      {name}
    </div>
  );
}
