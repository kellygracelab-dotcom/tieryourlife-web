import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sizedFor } from "../../lib/pictureSize";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { cardOf, type PlayBoard, type PlayCard } from "./board";
import { canUndo, currentPair, gameProgress, pick, skip, undo, type Game } from "./game";
import { duelText, gameName, roundText } from "./labels";
import { useFitText } from "./useFitText";
import "./play.css";

/** How long a picked card shows its ring before the next pair comes: the design's 160 ms, 90 with less motion. */
export const SETTLE_MS = 160;
export const SETTLE_REDUCED_MS = 90;

/** The skip line is for the first few duels, until the idea has landed. */
const SKIP_HELP_DUELS = 3;

const lessMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Action = "first" | "second" | "skip" | "undo";

/** ← and → pick, ↓ skips, Z or Backspace takes the last answer back; Z by its place on any keyboard. */
function actionOf(event: KeyboardEvent): Action | null {
  if (event.key === "ArrowLeft") return "first";
  if (event.key === "ArrowRight") return "second";
  if (event.key === "ArrowDown") return "skip";
  if (event.key === "Backspace" || event.key.toLowerCase() === "z" || event.code === "KeyZ") {
    return "undo";
  }
  return null;
}

interface DuelLayerProps {
  game: Game;
  board: PlayBoard;
  /** A pick, a skip or an undo: the game after it. */
  onChange: (game: Game) => void;
  /** Quit, Escape: the page keeps the game and says so. */
  onQuit: () => void;
  /** Shown in place of the stage once the game is over: the result. */
  children?: ReactNode;
}

/**
 * The duel screen: a layer over the whole site, header and all, with two
 * cards to choose between. The keyboard belongs to the layer while it is open:
 * the board underneath hears nothing, and the focus stays inside. Cards stay
 * on the left-to-right order the engine gives them in every language, so ←
 * is always the first.
 */
export function DuelLayer({ game, board, onChange, onQuit, children }: DuelLayerProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useModal(box, onQuit, ".duel__title");

  const pair = useMemo(() => currentPair(game), [game]);
  const progress = useMemo(() => gameProgress(game), [game]);
  const over = pair === null;
  // The card picked, while it shows its ring and before the game moves on.
  const [chosen, setChosen] = useState<number | null>(null);
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settling.current), []);

  const act = (action: Action) => {
    if (chosen !== null) return;
    if (action === "undo") {
      if (canUndo(game)) onChange(undo(game));
      return;
    }
    if (pair === null) return;
    if (action === "skip") {
      onChange(skip(game));
      return;
    }
    const winner = action === "first" ? pair[0] : pair[1];
    setChosen(winner);
    settling.current = setTimeout(
      () => {
        setChosen(null);
        onChange(pick(game, winner));
      },
      lessMotion() ? SETTLE_REDUCED_MS : SETTLE_MS,
    );
  };
  // The key listener is added once; it reaches the latest game through here.
  const latest = useRef(act);
  useEffect(() => {
    latest.current = act;
  });

  useEffect(() => {
    // Caught on the way down, before the board's own keys hear it. Escape and
    // Tab go on to useModal, which quits and keeps the focus in.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") return;
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const action = actionOf(event);
      if (action === null) return;
      event.preventDefault();
      latest.current(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // A picked card's button goes with its pair; the focus stays in the layer.
  useEffect(() => {
    if (pair !== null && !box.current?.contains(document.activeElement)) stage.current?.focus();
  }, [pair]);

  const done = over ? 1 : progress.total === 0 ? 0 : progress.asked / progress.total;
  const round = over ? null : roundText(progress);
  const stateOf = (card: number) =>
    chosen === null ? "idle" : chosen === card ? "chosen" : "other";

  return createPortal(
    <div ref={box} className="duel" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <header className="duel__head">
        <button
          type="button"
          className="duel__icon"
          aria-label={strings.play.quit}
          onClick={onQuit}
        >
          <Icon name="close" />
        </button>
        <div className="duel__heading">
          <h2 id={`${id}-title`} className="duel__title" tabIndex={-1}>
            {gameName(game.spec.kind)}
          </h2>
          {!over && <p className="duel__count">{duelText(progress)}</p>}
        </div>
        {round !== null && <p className="duel__round">{round}</p>}
        <button
          type="button"
          className="duel__icon"
          aria-label={strings.play.undoPick}
          onClick={() => act("undo")}
          disabled={!canUndo(game)}
        >
          <Icon name="undo" />
        </button>
      </header>
      <div className="duel__bar">
        <span className="duel__done" style={{ inlineSize: `${Math.round(done * 1000) / 10}%` }} />
      </div>
      <p className="play-hidden" aria-live="polite">
        {over ? "" : duelText(progress)}
      </p>

      {pair === null ? (
        <div className="duel__result">{children}</div>
      ) : (
        <>
          <div ref={stage} className="duel__stage" tabIndex={-1}>
            <Slot
              key={`first:${pair[0]}`}
              card={cardOf(board, game.ids[pair[0]] ?? "")}
              keycap="←"
              state={stateOf(pair[0])}
              onPick={() => act("first")}
            />
            <span className="duel__or" aria-hidden="true">
              {strings.play.or}
            </span>
            <Slot
              key={`second:${pair[1]}`}
              card={cardOf(board, game.ids[pair[1]] ?? "")}
              keycap="→"
              state={stateOf(pair[1])}
              onPick={() => act("second")}
            />
          </div>
          <footer className="duel__foot">
            <button type="button" className="btn duel__skip" onClick={() => act("skip")}>
              <span>{strings.play.skip}</span>
              <kbd className="duel__key duel__key--inline" aria-hidden="true">
                ↓
              </kbd>
            </button>
            {game.history.length < SKIP_HELP_DUELS && (
              <p className="duel__help">{strings.play.skipHelp}</p>
            )}
          </footer>
        </>
      )}
    </div>,
    document.body,
  );
}

interface SlotProps {
  card: PlayCard;
  keycap: string;
  state: "idle" | "chosen" | "other";
  onPick: () => void;
}

/**
 * One side of the duel. Keyed by the card, so a card that stays (the hill's
 * champion) keeps its place and only a new one slides in.
 */
function Slot({ card, keycap, state, onPick }: SlotProps) {
  return (
    <div className="duel__slot">
      <button
        type="button"
        className={`duel-card duel-card--${state}`}
        aria-label={fill(strings.play.pick, { name: card.name })}
        onClick={onPick}
      >
        {card.imageUrl !== null ? (
          <img className="duel-card__picture" {...sizedFor(card.imageUrl, 300)} alt="" />
        ) : (
          <FittedName name={card.name} />
        )}
      </button>
      {card.imageUrl !== null && (
        <p className="duel-card__name" aria-hidden="true">
          {card.name}
        </p>
      )}
      <kbd className="duel__key" aria-hidden="true">
        {keycap}
      </kbd>
    </div>
  );
}

/** A card without a picture: its name inside, as large as five lines allow. */
function FittedName({ name }: { name: string }) {
  const text = useRef<HTMLSpanElement>(null);
  useFitText(text, name);
  return (
    <span ref={text} className="duel-card__text" dir="auto">
      {name}
    </span>
  );
}
