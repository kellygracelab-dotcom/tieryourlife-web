import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { KeyValueStore } from "../../lib/storage";
import { fill, plural, strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { boardOf, type PlayCard, type PlayTier } from "./board";
import { ChooseCards } from "./ChooseCards";
import { chosenIds, EVERYTHING, MAX_CARDS, MIN_CARDS, playable, type Chosen } from "./chosen";
import { DuelLayer } from "./DuelLayer";
import type { GameKind } from "./engine";
import {
  answered,
  applied,
  gameProgress,
  newGame,
  reconcile,
  seedOf,
  startRefine,
  type Game,
} from "./game";
import { GamePicker } from "./GamePicker";
import type { PlayButtonProps } from "./PlayButton";
import { SheetArrival } from "./sheet";
import { ResultView } from "./ResultView";
import { lastGame, localGames, rememberGame, type SavedGames } from "./savedGames";

/** What a page learns of a game it applies: for its history line and its own receipt. */
export interface Played {
  kind: GameKind;
  /** Cards the game was over. */
  cards: number;
  /** Duels answered, skips not counted. */
  duels: number;
}

export interface PlayOptions {
  /** The board's name, for the picker's "34 cards from …". */
  title: string;
  /** Somebody else's list: the picker says the result goes into Mine, and Apply is "Put in Mine". */
  theirs?: boolean;
  /**
   * Apply: every ranked tier's card ids after the result, the board's tiers in
   * order; a card in no row is in the pool. The played cards take their new
   * places and every other card stays where it was. Return a way to take it
   * back and the receipt "Board arranged from 136 duels · Undo" offers it;
   * return nothing for no receipt (Mine on somebody else's list).
   */
  onApply: (rows: string[][], played: Played) => (() => void) | void;
  /** Where Play's notices go: the page's snackbar. */
  notify: (notice: SnackbarNotice) => void;
  /** Where games are kept; this device's by default. The account-backed one goes here later. */
  games?: SavedGames;
  now?: () => number;
  random?: () => number;
}

export interface Play {
  /** For `<PlayButton {...play.button} />`, wherever the page's bar puts it. */
  button: PlayButtonProps;
  /** The picker, the choice of cards and the duel layer: render it once, anywhere in the page. */
  view: ReactNode;
  /** The duel layer is open; a page may mirror it as ?play=1. */
  playing: boolean;
  open: () => void;
  /** As the layer's Quit: keeps the game and closes. For the browser's back while playing. */
  quit: () => void;
}

type Screen = "none" | "picker" | "cards" | "cardsFirst" | "layer";

/**
 * Play mode for one board, everything a page needs in one call.
 *
 * ```tsx
 * const play = usePlay(board.uid, cards, tiers, localStorageStore, {
 *   title: board.title,
 *   notify: setNotice,
 *   onApply: (rows) => {
 *     const before = latest();
 *     keep(arrangeItems(before, rows, now()));
 *     return () => keep(before);
 *   },
 * });
 * …
 * <PlayButton {...play.button} />
 * {play.view}
 * ```
 *
 * `cards` are the board's cards (any order; the pool is every card no tier
 * holds) and `tiers` its ranked tiers with their card ids left to right; keep
 * both memoised. One's own board keys games by its uid; a list by something
 * that cannot meet a board's uid, such as `list:{id}`, with `theirs` set and
 * an `onApply` that fills Mine and switches to it.
 */
export function usePlay(
  boardKey: string,
  cards: readonly PlayCard[],
  tiers: readonly PlayTier[],
  store: KeyValueStore,
  options: PlayOptions,
): Play {
  const { title, theirs = false, onApply, notify, now = Date.now, random = Math.random } = options;
  const games = useMemo(() => options.games ?? localGames(store, now), [options.games, store, now]);
  const board = useMemo(() => boardOf(cards, tiers), [cards, tiers]);

  // Where Play is, and where it came from: a sheet that opens from nothing or
  // from the layer comes in; one page of it after another does not.
  const [at, setAt] = useState<{ screen: Screen; from: Screen }>({ screen: "none", from: "none" });
  const screen = at.screen;
  const setScreen = (next: Screen | ((current: Screen) => Screen)) =>
    setAt((current) => {
      const to = typeof next === "function" ? next(current.screen) : next;
      return to === current.screen ? current : { screen: to, from: current.screen };
    });
  const arriving = at.from === "none" || at.from === "layer";
  // The game on the layer; the saved one is what the store holds for this board.
  const [game, setGame] = useState<Game | null>(null);
  const [chosen, setChosen] = useState<Chosen>(EVERYTHING);
  const [kind, setKind] = useState<GameKind>(() => lastGame(store));
  const [saved, setSaved] = useState(() => ({ key: boardKey, game: games.load(boardKey) }));
  if (saved.key !== boardKey) setSaved({ key: boardKey, game: games.load(boardKey) });
  const savedGame = saved.key === boardKey ? saved.game : null;

  const keep = useCallback(
    (next: Game) => {
      games.save(boardKey, next);
      setSaved({ key: boardKey, game: next });
    },
    [games, boardKey],
  );
  const forget = useCallback(() => {
    games.discard(boardKey);
    setSaved({ key: boardKey, game: null });
  }, [games, boardKey]);

  const close = () => {
    setGame(null);
    setScreen("none");
  };

  const show = (next: Game) => {
    keep(next);
    setGame(next);
    setScreen("layer");
  };

  const open = () => {
    if (board.order.length < MIN_CARDS) return;
    // A board too big for one game chooses its cards first, unless a saved game waits.
    const tooMany = chosenIds(board, chosen).length > MAX_CARDS;
    setScreen(tooMany && savedGame === null ? "cardsFirst" : "picker");
  };

  /** A new game; the one saved before it goes, with a way back for a few seconds. */
  const begin = (gameKind: GameKind, from: Chosen) => {
    const ids = chosenIds(board, from);
    if (!playable(ids.length)) return;
    const before = savedGame;
    rememberGame(store, gameKind);
    show(newGame(gameKind, ids, from, seedOf(random), now()));
    if (before === null) return;
    notify({
      text: strings.play.savedDiscarded,
      action: {
        text: strings.play.undo,
        onClick: () => {
          keep(before);
          setGame(null);
          // Still playing the new game: back to the picker, where the old one waits.
          setScreen((current) => (current === "layer" ? "picker" : current));
        },
      },
    });
  };

  const resume = () => {
    if (savedGame === null) return;
    const resumed = reconcile(savedGame, board);
    if (resumed.kind !== "ready") return;
    setKind(resumed.game.spec.kind);
    setChosen(resumed.game.chosen);
    show(resumed.game);
  };

  const quit = () => {
    if (game !== null) {
      keep(game);
      const { overall } = gameProgress(game);
      notify({
        text: fill(strings.play.gameSaved, { asked: overall.asked, total: overall.total }),
        action: { text: strings.play.discard, onClick: forget },
      });
    }
    close();
  };

  const change = (next: Game) => {
    keep(next);
    setGame(next);
  };

  const apply = (finished: Game, result: string[][]) => {
    const played: Played = {
      kind: finished.spec.kind,
      cards: finished.ids.length,
      duels: answered(finished),
    };
    const takeBack = onApply(applied(board, result, finished.ids), played);
    forget();
    close();
    if (typeof takeBack === "function") {
      notify({
        text: plural(strings.play.arranged, played.duels),
        action: { text: strings.play.undo, onClick: takeBack },
      });
    }
  };

  const playAgain = (finished: Game) => {
    forget();
    setKind(finished.spec.kind);
    setChosen(finished.chosen);
    setGame(null);
    setScreen("picker");
  };

  const cancel = (finished: Game) => {
    forget();
    close();
    notify({
      text: strings.play.resultDiscarded,
      action: { text: strings.play.undo, onClick: () => show(finished) },
    });
  };

  const view = (
    <SheetArrival.Provider value={arriving}>
      {screen === "picker" && (
        <GamePicker
          title={title}
          count={chosenIds(board, chosen).length}
          kind={kind}
          onKind={setKind}
          saved={savedGame === null ? null : reconcile(savedGame, board)}
          theirs={theirs}
          now={now()}
          onChooseCards={() => setScreen("cards")}
          onResume={resume}
          onStartAgain={() => savedGame !== null && begin(savedGame.spec.kind, savedGame.chosen)}
          onStart={() => begin(kind, chosen)}
          onCancel={close}
        />
      )}
      {(screen === "cards" || screen === "cardsFirst") && (
        <ChooseCards
          board={board}
          chosen={chosen}
          onDone={(next) => {
            setChosen(next);
            setScreen("picker");
          }}
          // Reached from the picker, the arrow goes back to it; Cancel closes the sheet, as on the app.
          onBack={screen === "cards" ? () => setScreen("picker") : undefined}
          onCancel={close}
        />
      )}
      {screen === "layer" && game !== null && (
        <DuelLayer game={game} board={board} onChange={change} onQuit={quit}>
          <ResultView
            game={game}
            board={board}
            theirs={theirs}
            onApply={(result) => apply(game, result)}
            onRefine={() => change(startRefine(game))}
            onPlayAgain={() => playAgain(game)}
            onCancel={() => cancel(game)}
            onQuit={quit}
          />
        </DuelLayer>
      )}
    </SheetArrival.Provider>
  );

  return {
    button: {
      onClick: open,
      disabled: board.order.length < MIN_CARDS || board.tiers.length === 0,
      saved: savedGame !== null,
    },
    view,
    playing: screen === "layer" && game !== null,
    open,
    quit,
  };
}
