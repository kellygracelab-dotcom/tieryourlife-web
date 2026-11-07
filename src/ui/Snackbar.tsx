import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import "./Snackbar.css";

export interface SnackbarNotice {
  text: string;
  action?: { text: string; onClick: () => void };
  /** Stays as long as the app's long snackbar: an Undo that is the only way back to something. */
  long?: boolean;
}

/** How long a notice stays; the design's six seconds, counted while nobody holds it. */
export const SNACKBAR_MS = 6000;
/** A long notice's time, the app's SnackbarDuration.Long. */
export const SNACKBAR_LONG_MS = 10000;

interface SnackbarProps {
  notice: SnackbarNotice | null;
  onDone: () => void;
}

/**
 * One line at the bottom left, with at most one action, gone by itself.
 * The status region is there before anything is said in it, so the words
 * are read out when they come.
 */
export function Snackbar({ notice, onDone }: SnackbarProps) {
  return (
    <div className="snackbar-region" role="status">
      {notice !== null && <Notice notice={notice} onDone={onDone} />}
    </div>
  );
}

/**
 * The shell's snackbar, for what a page that is gone could not say itself.
 * It is there only while it says something, so the pages' own status regions
 * stay the only ones; an alert is read out as it appears, which a status
 * region that comes with its words already in it is not.
 */
export function SiteSnackbar({ notice, onDone }: SnackbarProps) {
  if (notice === null) return null;
  return (
    <div className="snackbar-region" role="alert">
      <Notice notice={notice} onDone={onDone} />
    </div>
  );
}

/** The room between two notices. */
const SNACKBAR_GAP = 8;

/**
 * The notices on the screen, oldest first, each with its height: the shell's
 * notice and a page's own can be there at once, and each stands above the
 * ones before it, so neither covers the other's Undo.
 */
let stack: readonly { key: symbol; height: number }[] = [];
const stackListeners = new Set<() => void>();
const setStack = (next: readonly { key: symbol; height: number }[]) => {
  stack = next;
  stackListeners.forEach((listener) => listener());
};
const subscribeToStack = (listener: () => void) => {
  stackListeners.add(listener);
  return () => {
    stackListeners.delete(listener);
  };
};
const currentStack = () => stack;

/**
 * How much higher than its place a notice stands: the height of the ones shown
 * before it. The place itself is the stylesheets' (16 px, or above a page's
 * pool, dock or bar); the lift is added to it, never put in its stead.
 */
function useStackLift(box: RefObject<HTMLDivElement | null>, notice: SnackbarNotice): number {
  const [key] = useState(() => Symbol("snackbar"));
  const shown = useSyncExternalStore(subscribeToStack, currentStack, currentStack);

  useLayoutEffect(() => {
    setStack([...stack, { key, height: 0 }]);
    return () => setStack(stack.filter((one) => one.key !== key));
  }, [key]);

  useLayoutEffect(() => {
    const node = box.current;
    if (node === null) return;
    const measure = () => {
      const height = node.offsetHeight;
      if (stack.some((one) => one.key === key && one.height !== height)) {
        setStack(stack.map((one) => (one.key === key ? { key, height } : one)));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [box, key, notice]);

  const at = shown.findIndex((one) => one.key === key);
  return shown.slice(0, Math.max(at, 0)).reduce((lift, one) => lift + one.height + SNACKBAR_GAP, 0);
}

/**
 * While the pointer or the focus is on a notice, it waits. An action whose
 * press took the focus with it (a card removed, a list deleted) gets the
 * focus, so its Undo is one Enter away rather than the whole page.
 */
function Notice({ notice, onDone }: { notice: SnackbarNotice; onDone: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const action = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const lift = useStackLift(box, notice);

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDone, notice.long === true ? SNACKBAR_LONG_MS : SNACKBAR_MS);
    return () => clearTimeout(timer);
  }, [notice, onDone, held]);

  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) action.current?.focus();
  }, [notice]);

  return (
    <div
      ref={box}
      className="snackbar"
      style={{ "--snackbar-lift": `${lift}px` } as CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span>{notice.text}</span>
      {notice.action !== undefined && (
        <button
          ref={action}
          type="button"
          className="snackbar__action"
          onClick={() => {
            notice.action?.onClick();
            onDone();
          }}
        >
          {notice.action.text}
        </button>
      )}
    </div>
  );
}
