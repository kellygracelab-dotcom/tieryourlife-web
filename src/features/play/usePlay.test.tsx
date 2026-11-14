import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import type { PlayCard, PlayTier } from "./board";
import { EVERYTHING } from "./chosen";
import { newGame } from "./game";
import { PlayButton } from "./PlayButton";
import { localGames, playKey } from "./savedGames";
import { loadPlayScreens, usePlay, type PlayOptions } from "./usePlay";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();

const cardsOf = (n: number): PlayCard[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Card ${i}`, imageUrl: null }));

const tier = (id: string, cardIds: string[] = []): PlayTier => ({
  id,
  label: id.toUpperCase(),
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds,
});

const THREE = cardsOf(3);
const TIERS = [tier("s"), tier("a"), tier("b")];

interface PageProps {
  cards?: readonly PlayCard[];
  tiers?: readonly PlayTier[];
  store: KeyValueStore;
  boardKey?: string;
  onApply?: PlayOptions["onApply"];
  notify?: (notice: SnackbarNotice) => void;
  theirs?: boolean;
}

function Page({
  cards = THREE,
  tiers = TIERS,
  store,
  boardKey = "b1",
  onApply = () => undefined,
  notify = () => undefined,
  theirs,
}: PageProps) {
  const play = usePlay(boardKey, cards, tiers, store, {
    title: "Films",
    theirs,
    onApply,
    notify,
    now: () => NOW,
    random: () => 0.5,
  });
  return (
    <>
      <PlayButton {...play.button} />
      {play.playing && <p>playing</p>}
      {play.view}
    </>
  );
}

const playButton = () => screen.getByRole("button", { name: "Play" });

/** Opens the picker and starts the game named. */
async function startGame(name: RegExp) {
  await userEvent.click(playButton());
  await userEvent.click(screen.getByRole("radio", { name }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
}

/** Answers with a key, ← by default, and waits for the next duel or the end. */
async function pickLeft(times: number, key = "{ArrowLeft}") {
  for (let i = 0; i < times; i++) {
    const label = () => screen.queryAllByText(/^Duel/)[0]?.textContent;
    const before = label();
    await userEvent.keyboard(key);
    await waitFor(() => expect(label()).not.toBe(before));
  }
}

describe("Play on a page", () => {
  // The screens come as a chunk of their own; fetched here, Play opens in the frame it is pressed.
  beforeAll(() => loadPlayScreens());

  it("is not offered below three cards", async () => {
    render(<Page store={memoryStore()} cards={cardsOf(2)} />);
    expect(playButton()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(playButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("plays a game from the picker to the board", async () => {
    const store = memoryStore();
    const takeBack = vi.fn();
    const onApply = vi.fn<PlayOptions["onApply"]>(() => takeBack);
    const notify = vi.fn();
    render(<Page store={store} onApply={onApply} notify={notify} />);

    await userEvent.click(playButton());
    expect(screen.getByText("3 cards from Films")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("dialog", { name: "King of the hill" })).toBeInTheDocument();
    expect(screen.getByText("playing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Duel 1 of 2" })).toHaveFocus();
    expect(screen.getByText("King of the hill")).toBeInTheDocument();

    await pickLeft(2);
    // The last duel puts the result on the board: no result screen, nothing to confirm.
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Your result" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Apply|Refine)$/ })).toBeNull();

    const [rows, played] = onApply.mock.lastCall!;
    expect(rows).toHaveLength(3);
    expect(rows.flat().sort()).toEqual(["c0", "c1", "c2"]);
    expect(played).toEqual({ kind: "hill", cards: 3, duels: 2 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store.read(playKey("b1"))).toBeNull();

    const receipt = notify.mock.lastCall![0] as SnackbarNotice;
    expect(receipt.text).toBe("Board arranged from 2 duels");
    act(() => receipt.action!.onClick());
    expect(takeBack).toHaveBeenCalled();
  });

  it("says what a game did with no Undo of its own when the board's Undo takes it back", async () => {
    const notify = vi.fn();
    const onApply = vi.fn<PlayOptions["onApply"]>(() => undefined);
    render(<Page store={memoryStore()} notify={notify} onApply={onApply} theirs />);
    await userEvent.click(playButton());
    expect(
      screen.getByText("The result goes into Mine. The author’s ranking doesn’t change."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Bracket/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await pickLeft(2);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledExactlyOnceWith({ text: "Board arranged from 2 duels" });
  });

  it("puts nothing anywhere when every duel was skipped, and says so", async () => {
    const store = memoryStore();
    const notify = vi.fn();
    const onApply = vi.fn<PlayOptions["onApply"]>(() => undefined);
    render(<Page store={store} notify={notify} onApply={onApply} />);
    await startGame(/King of the hill/);
    await pickLeft(2, "{ArrowDown}");
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        text: "Every duel was skipped, so there is nothing to apply.",
      }),
    );
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store.read(playKey("b1"))).toBeNull();
  });

  it("keeps the game on Quit, says so, and resumes it from the picker", async () => {
    const store = memoryStore();
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    await startGame(/King of the hill/);
    await pickLeft(1);
    await userEvent.click(screen.getByRole("button", { name: "Quit" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((notify.mock.lastCall![0] as SnackbarNotice).text).toBe("Game saved · 1 of 2");
    expect(store.read(playKey("b1"))).not.toBeNull();
    expect(playButton()).toHaveAccessibleDescription("A game is saved.");

    await userEvent.click(playButton());
    expect(screen.getByText("King of the hill · 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Started today")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getAllByText("Duel 2 of 2")).not.toHaveLength(0);
  });

  it("discards the saved game from the receipt", async () => {
    const store = memoryStore();
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    await startGame(/Bracket/);
    await pickLeft(1);
    await userEvent.keyboard("{Escape}");
    const saved = notify.mock.lastCall![0] as SnackbarNotice;
    expect(saved.action!.text).toBe("Discard");
    act(() => saved.action!.onClick());
    expect(store.read(playKey("b1"))).toBeNull();
    expect(playButton()).not.toHaveAttribute("aria-describedby");
  });

  it("discards a saved game when another starts, with a way back to it", async () => {
    const store = memoryStore();
    const old = {
      ...newGame("swiss", ["c0", "c1", "c2"], EVERYTHING, 4, NOW),
      history: [[0, 1, 0] as const],
    };
    localGames(store, () => NOW).save("b1", old);
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    expect(playButton()).toHaveAccessibleDescription("A game is saved.");

    await startGame(/Bracket/);
    const receipt = notify.mock.lastCall![0] as SnackbarNotice;
    expect(receipt.text).toBe("Saved game discarded");
    // The new game is kept from its first answer on.
    expect(localGames(store).load("b1")).toBeNull();

    act(() => receipt.action!.onClick());
    expect(localGames(store).load("b1")).toEqual(old);
    // Back to the picker, where the old game waits.
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("opens the game picker with the full board above 64", async () => {
    render(<Page store={memoryStore()} cards={cardsOf(91)} />);
    await userEvent.click(playButton());
    expect(screen.getByText("91 cards from Films")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("goes from the picker to the choice of cards and back with the choice", async () => {
    const cards = cardsOf(5);
    const tiers = [tier("s", ["c0", "c1"]), tier("a")];
    render(<Page store={memoryStore()} cards={cards} tiers={tiers} />);
    await userEvent.click(playButton());
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Everything/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /The pool/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    // The pool alone: the picker names it, as the app does.
    expect(screen.getByText("3 cards from The pool")).toBeInTheDocument();
    // Cancel there goes back to the picker, not out.
    // The arrow goes back to the picker; Cancel there closes the whole sheet, as on the app.
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Play" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("resumes the same participants after a card was added to the board", async () => {
    const store = memoryStore();
    const old = { ...newGame("swiss", ["c0", "c1", "c2"], EVERYTHING, 4, NOW), history: [] };
    localGames(store, () => NOW).save("b1", old);
    render(<Page store={store} cards={cardsOf(4)} />);
    await userEvent.click(playButton());
    expect(screen.getByText("4 cards from Films")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("dialog", { name: "Losers stay" })).toBeInTheDocument();
  });

  it("starts a hill again when a card left the board under it", async () => {
    const store = memoryStore();
    const old = {
      ...newGame("hill", ["c0", "c1", "c2", "c3"], EVERYTHING, 4, NOW),
      history: [[0, 1, 0] as const],
    };
    localGames(store, () => NOW).save("b1", old);
    render(<Page store={store} />);
    await userEvent.click(playButton());
    expect(screen.getByText("The board changed, so this game can’t go on")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByRole("dialog", { name: "King of the hill" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Duel 1 of 2" })).toBeInTheDocument();
  });

  it("only lets go of a game whose tier was deleted, and offers the whole board (QA W-GS2)", async () => {
    const store = memoryStore();
    const inA = { kind: "picked", tier: "a", ids: ["c0", "c1", "c2"], keepTier: true } as const;
    const old = {
      ...newGame("hill", ["c0", "c1", "c2"], inA, 4, NOW),
      history: [[0, 1, 0] as const],
    };
    localGames(store, () => NOW).save("b1", old);
    // A was deleted: its cards went to the pool.
    render(<Page store={store} tiers={[tier("s"), tier("b")]} />);
    await userEvent.click(playButton());
    expect(screen.getByText("The board changed, so this game can’t go on")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start again" })).not.toBeInTheDocument();
    // Never "0 cards" with Start off: a new game is over the whole board.
    expect(screen.getByText("3 cards from Films")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      screen.queryByText("The board changed, so this game can’t go on"),
    ).not.toBeInTheDocument();
    expect(store.read(playKey("b1"))).toBeNull();
  });

  it("starts the next game from the whole board once a result is applied (QA W-GS1)", async () => {
    const onApply = vi.fn<PlayOptions["onApply"]>(() => undefined);
    render(
      <Page
        store={memoryStore()}
        onApply={onApply}
        cards={cardsOf(4)}
        tiers={[tier("s", ["c0"]), tier("a")]}
      />,
    );
    await userEvent.click(playButton());
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Everything/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /The pool/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("3 cards from The pool")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await pickLeft(2);
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(playButton());
    expect(screen.getByText("4 cards from Films")).toBeInTheDocument();
  });

  it("remembers the last game on this device", async () => {
    const store = memoryStore();
    const { unmount } = render(<Page store={store} />);
    await startGame(/Bracket/);
    await userEvent.keyboard("{Escape}");
    unmount();
    render(<Page store={store} boardKey="b2" />);
    await userEvent.click(playButton());
    expect(screen.getByRole("radio", { name: /Bracket/ })).toBeChecked();
  });

  it("keeps nothing of a game quit before any answer, and says nothing", async () => {
    const store = memoryStore();
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    await startGame(/Bracket/);
    await userEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(notify).not.toHaveBeenCalled();
    expect(store.read(playKey("b1"))).toBeNull();
    expect(playButton()).not.toHaveAttribute("aria-describedby");
  });

  it("sees a game kept in another tab, and Start says it goes", async () => {
    const store = memoryStore();
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    expect(playButton()).not.toHaveAttribute("aria-describedby");
    const elsewhere = {
      ...newGame("swiss", ["c0", "c1", "c2"], EVERYTHING, 4, NOW),
      history: [[0, 1, 0] as const],
    };
    localGames(store, () => NOW).save("b1", elsewhere);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "play:b1" })));
    expect(playButton()).toHaveAccessibleDescription("A game is saved.");
    await userEvent.click(playButton());
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect((notify.mock.lastCall![0] as SnackbarNotice).text).toBe("Saved game discarded");
  });

  it("shows no saved dot on a Play that cannot open", () => {
    const store = memoryStore();
    const old = {
      ...newGame("swiss", ["c0", "c1", "c2"], EVERYTHING, 4, NOW),
      history: [[0, 1, 0] as const],
    };
    localGames(store, () => NOW).save("b1", old);
    render(<Page store={store} cards={cardsOf(2)} />);
    expect(playButton()).toHaveAccessibleDescription("Play needs at least 3 cards.");
    expect(document.querySelector(".play-button__dot")).toBeNull();
  });

  it("keeps its keys from the board behind the sheet", async () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    try {
      render(<Page store={memoryStore()} />);
      await userEvent.click(playButton());
      // 1 places a picked card, the arrows move it and Ctrl+Z undoes, on the board.
      await userEvent.keyboard("1{ArrowRight}{Control>}z{/Control}");
      expect(heard).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Play" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    } finally {
      window.removeEventListener("keydown", heard);
    }
  });
});
