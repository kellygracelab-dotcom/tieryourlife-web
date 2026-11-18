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
 * The newcomer's tips, one at a time, each by the element it explains
 * (artboards 47–50): nothing darkens, nothing takes the focus, and the page
 * under it goes on working. Got it closes it, No more tips closes them all;
 * Escape and a press anywhere else close it too. A tip goes by itself when
 * its element does (a card placed takes the first one away). Mounted once.
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
  return createPortal(<Bubble id={shown.id} at={shown.at} onClose={close} />, document.body);
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

function Bubble({ id, at, onClose }: { id: TipId; at: HTMLElement; onClose: () => void }) {
  const bubble = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    arrow: number;
    below: boolean;
  } | null>(null);

  // Beside its element wherever the page scrolls or the window turns.
  useLayoutEffect(() => {
    const element = bubble.current;
    if (element === null) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const target = at.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      const middle = (target.left + target.right) / 2;
      const widest = document.documentElement.clientWidth - MARGIN - width;
      const left = Math.max(MARGIN, Math.min(middle - width / 2, widest));
      const above = target.top - GAP - height;
      const below = above < MARGIN;
      setPlace({
        left,
        top: below ? target.bottom + GAP : above,
        arrow: Math.max(16, Math.min(middle - left, width - 16)),
        below,
      });
    };
    const soon = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
    sizes?.observe(at);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
      sizes?.disconnect();
    };
  }, [at]);

  // The ring on its element, and the ways out that are not its buttons.
  useEffect(() => {
    at.classList.add(TIP_RING);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !bubble.current?.contains(event.target)) onClose();
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
      ref={bubble}
      className={`tip${place?.below === true ? " tip--below" : ""}`}
      data-tip-for={id}
      style={
        place === null
          ? { visibility: "hidden" }
          : { left: place.left, top: place.top, ["--tip-arrow" as string]: `${place.arrow}px` }
      }
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
