import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sizedFor } from "../../lib/pictureSize";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { cardOf, type PlayBoard, type PlayCard } from "./board";
import type { Pair } from "./engine";
import { canUndo, currentPair, gameProgress, pick, skip, undo, type Game } from "./game";
import { duelText, gameName, secondLine } from "./labels";
import { lessMotion, SIDEWAYS, useMedia } from "./media";
import { useFitText } from "./useFitText";
import "./play.css";

/**
 * The design's timing of a pick: the chosen card grows and wears its ring
 * and check for 160 ms, both cards fade from 220 ms over 120, then the next
 * pair rises. A skip drops both cards in 150 ms. With less motion every step
 * is one 90 ms cross-fade.
 */
export const PICK_FADE_AT_MS = 220;
export const PICK_DONE_MS = 340;
export const SKIP_DONE_MS = 150;
export const REDUCED_MS = 90;
/** The bar fills to its end before the result comes. */
export const RESULT_AFTER_MS = 300;

/** The skip line is for the first few duels, until the idea has landed. */
const SKIP_HELP_DUELS = 3;

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

/** An answer on its way: what the cards are doing until the game takes it. */
type Motion =
  | {
      kind: "pick";
      winner: number;
      /** Past the ring: the cards that go are fading. */
      fading: boolean;
      /** Each side whose card stays for the next duel (the hill's champion): it does not fade. */
      stays: readonly [boolean, boolean];
    }
  | { kind: "skip" };

interface DuelLayerProps {
  game: Game;
  board: PlayBoard;
  /** A pick, a skip or an undo: the game after it. */
  onChange: (game: Game) => void;
  /** Quit, Escape: the page keeps the game and says so. */
  onQuit: () => void;
  /** Shown in place of the duels once the game is over: the result, with its own header. */
  children?: ReactNode;
}

/**
 * The duel screen: a layer over the whole site, header and all, with two
 * cards to choose between on a stage of their own. The keyboard belongs to
 * the layer while it is open: the board underneath hears nothing, and the
 * focus stays inside. Cards stay on the left-to-right order the engine gives
 * them in every language, so ← is always the first. Held sideways, the
 * header gives its height to the cards, as on the app: Quit and Undo stand
 * in a strip at the start, the count and Skip between the cards.
 */
export function DuelLayer({ game, board, onChange, onQuit, children }: DuelLayerProps) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useModal(box, onQuit, ".duel__title");
  const sideways = useMedia(SIDEWAYS);

  const pair = useMemo(() => currentPair(game), [game]);
  const progress = useMemo(() => gameProgress(game), [game]);
  const over = pair === null;
  const nameOf = (card: number) => cardOf(board, game.ids[card] ?? "").name;

  const [motion, setMotion] = useState<Motion | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, then: () => void) => {
    timers.current.push(setTimeout(then, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The result waits for the bar to fill when the last answer is given here;
  // a layer that opens on a finished game shows it at once.
  const [revealed, setRevealed] = useState(over);
  if (!over && revealed) setRevealed(false);
  useEffect(() => {
    if (!over || revealed) return;
    const timer = setTimeout(() => setRevealed(true), lessMotion() ? 0 : RESULT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [over, revealed]);
  const showResult = over && revealed;

  const answer = (next: Game) => {
    setMotion(null);
    onChange(next);
  };

  const act = (action: Action) => {
    if (motion !== null || over) return;
    if (action === "undo") {
      if (canUndo(game)) onChange(undo(game));
      return;
    }
    if (pair === null) return;
    const reduced = lessMotion();
    if (action === "skip") {
      setMotion({ kind: "skip" });
      later(reduced ? REDUCED_MS : SKIP_DONE_MS, () => answer(skip(game)));
      return;
    }
    const winner = action === "first" ? pair[0] : pair[1];
    const next = pick(game, winner);
    const coming = currentPair(next);
    const stays: [boolean, boolean] = [coming?.[0] === pair[0], coming?.[1] === pair[1]];
    if (reduced) {
      setMotion({ kind: "pick", winner, fading: true, stays });
      later(REDUCED_MS, () => answer(next));
      return;
    }
    setMotion({ kind: "pick", winner, fading: false, stays });
    later(PICK_FADE_AT_MS, () =>
      setMotion((now) => (now?.kind === "pick" ? { ...now, fading: true } : now)),
    );
    later(PICK_DONE_MS, () => answer(next));
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
  const count = over ? "" : duelText(progress);
  const line = secondLine(game, nameOf);

  const quit = (
    <button type="button" className="duel__icon" aria-label={strings.play.quit} onClick={onQuit}>
      <Icon name="close" />
    </button>
  );
  const undoButton = (
    <button
      type="button"
      className="duel__icon"
      aria-label={strings.play.undoPick}
      onClick={() => act("undo")}
      disabled={!canUndo(game) || over}
    >
      <Icon name="undo" />
    </button>
  );
  const heading = (
    <>
      <h2 className="duel__title" tabIndex={-1}>
        {count}
      </h2>
      <p className="duel__line">{line}</p>
    </>
  );
  const skipper = (
    <>
      <button type="button" className="btn duel__skip" onClick={() => act("skip")}>
        <span>{strings.play.skip}</span>
        <kbd className="duel__key duel__key--inline" aria-hidden="true">
          ↓
        </kbd>
      </button>
      <SkipHelp spent={game.history.length >= SKIP_HELP_DUELS} />
    </>
  );
  const slots =
    pair === null
      ? null
      : ([0, 1] as const).map((side) => (
          <Slot
            // Keyed by the card: one that stays (the hill's champion) keeps its place, only a new one rises.
            key={`${side}:${pair[side]}`}
            card={cardOf(board, game.ids[pair[side]] ?? "")}
            keycap={side === 0 ? "←" : "→"}
            state={stateOf(motion, pair, side)}
            leaving={leavingOf(motion, side)}
            onPick={() => act(side === 0 ? "first" : "second")}
          />
        ));

  return createPortal(
    <div
      ref={box}
      className={sideways ? "duel duel--side" : "duel"}
      role="dialog"
      aria-modal="true"
      aria-label={gameName(game.spec.kind)}
    >
      {showResult ? (
        <div className="duel__result">{children}</div>
      ) : (
        <>
          {!sideways && (
            <header className="duel__head">
              {quit}
              <div className="duel__heading">{heading}</div>
              {undoButton}
            </header>
          )}
          <div className={over ? "duel__bar duel__bar--full" : "duel__bar"}>
            <span
              className="duel__done"
              style={{ inlineSize: `${Math.round(done * 1000) / 10}%` }}
            />
          </div>
          <p className="play-hidden" aria-live="polite">
            {count}
          </p>
          {sideways ? (
            <div className="duel__side">
              <div className="duel__strip">
                {quit}
                {undoButton}
              </div>
              <div ref={stage} className="duel__stage" tabIndex={-1}>
                {slots?.[0]}
                <div className="duel__centre">
                  {heading}
                  {pair !== null && skipper}
                </div>
                {slots?.[1]}
              </div>
            </div>
          ) : (
            <>
              <div ref={stage} className="duel__stage" tabIndex={-1}>
                {slots?.[0]}
                {pair !== null && (
                  <span className="duel__or" aria-hidden="true">
                    {strings.play.or}
                  </span>
                )}
                {slots?.[1]}
              </div>
              {pair !== null && <footer className="duel__foot">{skipper}</footer>}
            </>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

type SlotState = "idle" | "chosen" | "other";

function stateOf(motion: Motion | null, pair: Pair, side: 0 | 1): SlotState {
  if (motion?.kind !== "pick") return "idle";
  return motion.winner === pair[side] ? "chosen" : "other";
}

/** How a side leaves: fading after a pick (unless its card stays), dropping on a skip. */
function leavingOf(motion: Motion | null, side: 0 | 1): "fade" | "drop" | null {
  if (motion === null) return null;
  if (motion.kind === "skip") return "drop";
  return motion.fading && !motion.stays[side] ? "fade" : null;
}

/** Said for the first duels; after them it keeps its line, unseen, so the cards above do not move. */
function SkipHelp({ spent }: { spent: boolean }) {
  return (
    <p className={spent ? "duel__help duel__help--spent" : "duel__help"} aria-hidden={spent}>
      {strings.play.skipHelp}
    </p>
  );
}

interface SlotProps {
  card: PlayCard;
  keycap: string;
  state: SlotState;
  leaving: "fade" | "drop" | null;
  onPick: () => void;
}

/** One side of the duel. */
function Slot({ card, keycap, state, leaving, onPick }: SlotProps) {
  const pictured = card.imageUrl !== null;
  return (
    <div className={leaving === null ? "duel__slot" : `duel__slot duel__slot--${leaving}`}>
      <button
        type="button"
        className={`duel-card duel-card--${state}${pictured ? "" : " duel-card--text"}`}
        aria-label={fill(strings.play.pick, { name: card.name })}
        onClick={onPick}
      >
        {card.imageUrl !== null ? (
          <img className="duel-card__picture" {...sizedFor(card.imageUrl, 300)} alt="" />
        ) : (
          <FittedName name={card.name} />
        )}
        {state === "chosen" && (
          <span className="duel-card__check" aria-hidden="true">
            <Icon name="check" />
          </span>
        )}
      </button>
      {pictured && (
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
