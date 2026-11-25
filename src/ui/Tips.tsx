import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fill, strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import {
  subscribeToTips,
  TIP_IDS,
  tipSeen,
  tipsAreOff,
  tipsOff,
  tipWanted,
  type TipId,
} from "./tipMemory";
import "./Tips.css";

/** A tip comes this long after its place appears: the page settles first. */
export const TIP_DELAY_MS = 1000;
/** Kept this far from its element and from the window's edges. */
const GAP = 10;
const MARGIN = 8;
/** The strip stands this far over the bottom panel, as a notice does. */
const STRIP_GAP = 8;
/** The element a tip points at wears this while the tip is on screen. */
export const TIP_RING = "tip-ring";

/** Where a page offers a tip: `data-tip` names it, and a tip with a number reads `data-tip-n`. */
const placeOf = (id: TipId): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-tip="${id}"]`);

/** A mouse and a keyboard: the board's number keys are worth naming. */
const withKeys = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** The first tip a page offers that is still wanted, in the tips' order. */
function offered(): { id: TipId; at: HTMLElement } | null {
  for (const id of TIP_IDS) {
    const at = placeOf(id);
    // A place hidden from sight (the other half of a list, a closed panel) offers nothing.
    const seen = at !== null && (typeof at.checkVisibility !== "function" || at.checkVisibility());
    if (at !== null && seen && tipWanted(id)) return { id, at };
  }
  return null;
}

/**
 * The newcomer's tips, one at a time (artboards 47–50): nothing darkens,
 * nothing takes the focus, and the page under it goes on working. Got it
 * closes it, No more tips closes them all; Escape and a press anywhere else
 * close it too. A tip goes by itself when its element does (a card placed
 * takes the first one away). It is a thin strip over the bottom panel, its
 * element ringed in place: first on a phone (Danylo's yes of 25.11.2026),
 * where a bubble by its element covered the title, the search field or the
 * first card, then on a computer too (walkthrough of 25.11, item 4), where
 * the bubbles covered the pool's count and the field cards are typed into.
 * While one is up the board's own hint lines step aside (ranking.css), so
 * there is one hint on screen at a time. Mounted once.
 */
export function Tips() {
  const [shown, setShown] = useState<{ id: TipId; at: HTMLElement } | null>(null);
  const waiting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const look = () => {
      if (waiting.current !== undefined) return;
      if (offered() === null) return;
      waiting.current = setTimeout(() => {
        waiting.current = undefined;
        const next = offered();
        if (next === null) return;
        tipSeen(next.id);
        setShown(next);
      }, TIP_DELAY_MS);
    };
    if (shown !== null) {
      // Gone with its element, or with the word that offered it.
      const watch = new MutationObserver(() => {
        if (!shown.at.isConnected || shown.at.dataset.tip !== shown.id) setShown(null);
      });
      watch.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-tip"],
      });
      return () => watch.disconnect();
    }
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-tip"],
    });
    const stop = subscribeToTips(look);
    return () => {
      watch.disconnect();
      stop();
      clearTimeout(waiting.current);
      waiting.current = undefined;
    };
  }, [shown]);

  // Turned off elsewhere (Settings): the tip on screen goes as well.
  useEffect(
    () =>
      subscribeToTips(() => {
        if (tipsAreOff()) setShown(null);
      }),
    [],
  );

  const close = useCallback(() => setShown(null), []);
  if (shown === null) return null;
  return createPortal(<Strip id={shown.id} at={shown.at} onClose={close} />, document.body);
}

function textOf(id: TipId, at: HTMLElement) {
  const start = <strong>{strings.tips.startHere}</strong>;
  if (id === "place") {
    const keys = at.dataset.tipKeys;
    return withKeys() && keys !== undefined
      ? fillNodes(strings.tips.placeKeys, { start, keys })
      : fillNodes(strings.tips.place, { start });
  }
  if (id === "play") {
    return fillNodes(fill(strings.tips.play, { n: at.dataset.tipN ?? "" }), {
      play: <strong>{strings.play.play}</strong>,
    });
  }
  return strings.tips.add;
}

/** The field somebody is typing into, if any: the strip never goes over it. */
function typedInto(): HTMLElement | null {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement)) return null;
  const typed =
    field.isContentEditable ||
    field.matches(
      "textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=range])",
    );
  return typed ? field : null;
}

/**
 * The top of what is docked to the window's foot: the board's "Cards left"
 * tray, or a pinned row at the foot of a sheet. Found by what stands at the
 * foot rather than by name, so the pages keep their markup to themselves. A
 * fixed thing reaching above the middle (a sheet over the whole page) is not
 * a panel: then the pinned row at its foot counts, if it has one.
 */
function panelTop(foot: number, tip: HTMLElement): number {
  if (typeof document.elementsFromPoint !== "function") return foot;
  const middle = document.documentElement.clientWidth / 2;
  const docked = (box: DOMRect) => box.bottom >= foot - 1 && box.top > foot / 2;
  for (const hit of document.elementsFromPoint(middle, foot - 1)) {
    if (tip.contains(hit)) continue;
    let row: HTMLElement | null = null;
    for (let node: Element | null = hit; node instanceof HTMLElement; node = node.parentElement) {
      if (node === document.body) break;
      const box = node.getBoundingClientRect();
      const { position } = getComputedStyle(node);
      if (position === "fixed" || position === "sticky") {
        if (docked(box)) return box.top;
        return row === null ? foot : row.getBoundingClientRect().top;
      }
      if (docked(box)) row = node;
    }
    // The first thing at the foot that is not the tip decides: the page's own flow docks nothing.
    return foot;
  }
  return foot;
}

/**
 * How far above the window's foot the strip stands: over the bottom
 * panel, an open keyboard and any notice there, and off the element it
 * explains and the field being typed into (above it where there is room,
 * else under it).
 */
function stripLift(tip: HTMLElement, at: HTMLElement): number {
  const foot = document.documentElement.clientHeight;
  const view = window.visualViewport;
  // An open keyboard covers the window's foot and whatever is docked there.
  const keyboard = view ? view.offsetTop + view.height : foot;
  let floor = Math.min(foot, keyboard, panelTop(foot, tip));
  for (const notice of document.querySelectorAll<HTMLElement>(".snackbar")) {
    const box = notice.getBoundingClientRect();
    if (box.height > 0 && box.top > foot / 2) floor = Math.min(floor, box.top);
  }
  const { height } = tip.getBoundingClientRect();
  let bottom = floor - STRIP_GAP;
  // The field typed into goes last, so it wins where both cannot be kept clear.
  for (const kept of [at, typedInto()]) {
    if (kept === null) continue;
    const box = kept.getBoundingClientRect();
    if (bottom <= box.top || bottom - height >= box.bottom) continue;
    if (box.top - GAP - height >= MARGIN) bottom = box.top - GAP;
    else if (box.bottom + GAP + height <= floor - STRIP_GAP) bottom = box.bottom + GAP + height;
  }
  return Math.max(0, foot - bottom);
}

function Strip({ id, at, onClose }: { id: TipId; at: HTMLElement; onClose: () => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState<number | null>(null);

  // Over the bottom panel as it grows or shrinks, the page scrolls, the
  // window turns, a keyboard opens, the field focused changes, its own words
  // wrap anew, or the tray and notices change under a still page.
  useLayoutEffect(() => {
    const element = strip.current;
    if (element === null) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setLift(stripLift(element, at));
    };
    const soon = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    const view = window.visualViewport;
    window.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    view?.addEventListener("resize", soon);
    view?.addEventListener("scroll", soon);
    document.addEventListener("focusin", soon);
    document.addEventListener("focusout", soon);
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
    sizes?.observe(at);
    sizes?.observe(element);
    const changes = new MutationObserver(soon);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
      view?.removeEventListener("resize", soon);
      view?.removeEventListener("scroll", soon);
      document.removeEventListener("focusin", soon);
      document.removeEventListener("focusout", soon);
      sizes?.disconnect();
      changes.disconnect();
    };
  }, [at]);

  // The ring on its element, and the ways out that are not its buttons.
  useEffect(() => {
    at.classList.add(TIP_RING);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !strip.current?.contains(event.target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      at.classList.remove(TIP_RING);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [at, onClose]);

  return (
    <div
      ref={strip}
      className="tip"
      data-tip-for={id}
      style={lift === null ? { visibility: "hidden" } : { ["--tip-lift" as string]: `${lift}px` }}
    >
      {/* Read out when it comes, without taking the focus from where it is. */}
      <p className="tip__text" role="status">
        {textOf(id, at)}
      </p>
      <div className="tip__actions">
        <button
          type="button"
          className="tip__button tip__button--quiet"
          onClick={() => {
            tipsOff();
            onClose();
          }}
        >
          {strings.tips.noMore}
        </button>
        <button type="button" className="tip__button" onClick={onClose}>
          {strings.tips.gotIt}
        </button>
      </div>
    </div>
  );
}
