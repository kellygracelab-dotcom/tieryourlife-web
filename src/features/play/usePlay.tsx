import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { freshChunk } from "../../lib/freshChunk";
import type { KeyValueStore } from "../../lib/storage";
import { fill, plural, strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { boardOf, type PlayBoard, type PlayCard, type PlayTier } from "./board";
import {
  areaName,
  chosenIds,
  EVERYTHING,
  lostTier,
  MIN_CARDS,
  playable,
  replaySelection,
  type Chosen,
} from "./chosen";
import type { GameKind } from "./engine";
import type { Game, Unplayed } from "./game";
import type { PlayButtonProps } from "./PlayButton";
import { SheetArrival } from "./sheet";
import { lastGame, localGames, rememberGame, type SavedGames } from "./savedGames";

type Screens = typeof import("./screens");

let screens: Screens | null = null;
let loading: Promise<Screens> | null = null;

/**
 * Play's screens, fetched the first time Play opens and kept for the tab. A
 * chunk a deploy took away reloads the tab once, as a page's does; one that
 * still will not come lets the next press try again.
 */
export function loadPlayScreens(): Promise<Screens> {
  loading ??= freshChunk(() => import("./screens"))().then(
    (loaded) => (screens = loaded),
    (failure: unknown) => {
      loading = null;
      throw failure;
    },
  );
  return loading;
}

/**
 * What the picker says the cards are from: the pool, the ranked tiers or a
 * tier by its letter and caption, as on the app; the board’s name for the
 * whole board or a choice of rows.
 */
export function areaTitle(board: PlayBoard, chosen: Chosen, title: string): string {
  const area = areaName(board, chosen);
  switch (area.kind) {
    case "board":
      return title;
    case "pool":
      return strings.play.poolArea;
    case "ranked":
      return strings.play.rankedArea;
    case "tier": {
      const caption = area.tier.caption?.trim() ?? "";
      // The letter alone without a caption, as the app has it: "34 cards from S".
      return caption === "" ? area.tier.label : `${area.tier.label} · ${caption}`;
    }
  }
}

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
   * places and the unplayed cards follow the selected policy. Return a way to take it
   * back and the receipt "Board arranged from 136 duels · Undo" offers it;
   * return nothing for no receipt.
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
  /** Play is on screen: the picker, the choice of cards or the duel layer. */
  playing: boolean;
  open: () => void;
  /** As the layer's Quit: keeps the game and closes, a sheet too. For the browser's back while playing. */
  quit: () => void;
}

type Screen = "none" | "picker" | "cards" | "layer";

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

  // A game kept elsewhere is seen here too: another tab's, or one the
  // account's copy of the board brought down, so it is read again whenever
  // the board changes.
  useEffect(() => {
    const reread = () => {
      const kept = games.load(boardKey);
      setSaved((current) =>
        current.key === boardKey && JSON.stringify(current.game) === JSON.stringify(kept)
          ? current
          : { key: boardKey, game: kept },
      );
    };
    reread();
    window.addEventListener("storage", reread);
    return () => window.removeEventListener("storage", reread);
  }, [games, boardKey, board]);

  const forget = useCallback(() => {
    games.discard(boardKey);
    setSaved({ key: boardKey, game: null });
  }, [games, boardKey]);
  const keep = useCallback(
    (next: Game) => {
      // A game with nothing answered is not worth keeping, as on the app.
      if (next.history.length === 0) {
        forget();
        return;
      }
      games.save(boardKey, next);
      setSaved({ key: boardKey, game: next });
    },
    [games, boardKey, forget],
  );

  // The screens, once they are here: at once for a tab that opened Play before.
  const [arrived, setArrived] = useState<Screens | null>(screens);
  const shown = arrived ?? screens;
  useEffect(() => {
    if (screen === "none" || shown !== null) return;
    let live = true;
    loadPlayScreens().then(
      (loaded) => {
        if (live) setArrived(loaded);
      },
      () => {
        if (!live) return;
        // Nothing was played yet: Play closes, and says why.
        setGame(null);
        setAt((current) => ({ screen: "none", from: current.screen }));
        notify({ text: strings.play.couldNotOpen });
      },
    );
    return () => {
      live = false;
    };
  }, [screen, shown, notify]);

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
    setScreen("picker");
  };

  /** A new game; the one saved before it goes, with a way back for a few seconds. */
  const begin = (rules: Screens, gameKind: GameKind, from: Chosen) => {
    const ids = chosenIds(board, from);
    if (!playable(ids.length)) return;
    // Read again: a game kept since in another tab goes with a way back too.
    const before = games.load(boardKey);
    rememberGame(store, gameKind);
    show(rules.newGame(gameKind, ids, from, rules.seedOf(random), now()));
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

  const resume = (rules: Screens) => {
    if (savedGame === null) return;
    const resumed = rules.reconcile(savedGame, board);
    if (resumed.kind !== "ready") return;
    setKind(resumed.game.spec.kind);
    setChosen(resumed.game.chosen);
    show(resumed.game);
  };

  const quit = () => {
    // Nothing answered: nothing was kept, and nothing is said. (A game is on
    // screen only once the screens are here.)
    if (game !== null && game.history.length > 0 && shown !== null) {
      keep(game);
      const { overall } = shown.gameProgress(game);
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

  const apply = (rules: Screens, finished: Game, result: string[][], unplayed: Unplayed) => {
    // A tier the game was drawn from left the board since: nothing is put anywhere (WIRE-SPEC rule 6).
    if (lostTier(board, finished.chosen)) {
      notify({ text: strings.play.changed });
      return;
    }
    const played: Played = {
      kind: finished.spec.kind,
      cards: finished.ids.length,
      duels: rules.answered(finished),
    };
    const takeBack = onApply(rules.applied(board, result, finished, unplayed), played);
    forget();
    close();
    if (typeof takeBack === "function") {
      notify({
        text: plural(strings.play.arranged, played.duels),
        action: { text: strings.play.undo, onClick: takeBack },
      });
    }
  };

  // The finished game stays put down until another starts: the picker offers
  // it to resume, and Start says it went, with a way back.
  const playAgain = (finished: Game) => {
    setKind(finished.spec.kind);
    setChosen(replaySelection(board, finished.chosen, finished.ids));
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

  // Until the screens are here, nothing: the button keeps the focus.
  const view =
    shown === null ? null : (
      <SheetArrival.Provider value={arriving}>
        {screen === "picker" && (
          <shown.GamePicker
            title={areaTitle(board, chosen, title)}
            count={chosenIds(board, chosen).length}
            kind={kind}
            onKind={setKind}
            saved={savedGame === null ? null : shown.reconcile(savedGame, board)}
            theirs={theirs}
            now={now()}
            onChooseCards={() => setScreen("cards")}
            onResume={() => resume(shown)}
            onStartAgain={() =>
              savedGame !== null && begin(shown, savedGame.spec.kind, savedGame.chosen)
            }
            onStart={() => begin(shown, kind, chosen)}
            onCancel={close}
          />
        )}
        {screen === "cards" && (
          <shown.ChooseCards
            board={board}
            chosen={chosen}
            onDone={(next) => {
              setChosen(next);
              setScreen("picker");
            }}
            // Reached from the picker, the arrow goes back to it; Cancel closes the sheet, as on the app.
            onBack={() => setScreen("picker")}
            onCancel={close}
          />
        )}
        {screen === "layer" && game !== null && (
          <shown.DuelLayer game={game} board={board} onChange={change} onQuit={quit}>
            <shown.ResultView
              game={game}
              board={board}
              theirs={theirs}
              onApply={(result, unplayed) => apply(shown, game, result, unplayed)}
              onRefine={() => change(shown.startRefine(game))}
              onPlayAgain={() => playAgain(game)}
              onCancel={() => cancel(game)}
              onQuit={quit}
            />
          </shown.DuelLayer>
        )}
      </SheetArrival.Provider>
    );

  const disabled = board.order.length < MIN_CARDS || board.tiers.length === 0;
  return {
    button: {
      onClick: open,
      disabled,
      // The game stays kept, but the dot is only on a Play that can open it, as on the app.
      saved: savedGame !== null && !disabled,
    },
    view,
    playing: screen !== "none",
    open,
    quit,
  };
}
