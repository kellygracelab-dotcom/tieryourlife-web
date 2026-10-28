import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import type { PlayCard, PlayTier } from "./board";
import { EVERYTHING } from "./chosen";
import { newGame } from "./game";
import { PlayButton } from "./PlayButton";
import { localGames, playKey } from "./savedGames";
import { usePlay, type PlayOptions } from "./usePlay";

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

/** Answers with ← and waits for the next duel. */
async function pickLeft(times: number) {
  for (let i = 0; i < times; i++) {
    const label = () => screen.queryAllByText(/^(Duel|Refine)/)[0]?.textContent;
    const before = label();
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(label()).not.toBe(before));
  }
}

describe("Play on a page", () => {
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
    expect(screen.getByRole("heading", { name: "King of the hill" })).toHaveFocus();

    await pickLeft(2);
    expect(screen.getByRole("heading", { name: "Your result" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    const [rows, played] = onApply.mock.lastCall!;
    expect(rows).toHaveLength(3);
    expect(rows.flat().sort()).toEqual(["c0", "c1", "c2"]);
    expect(played).toEqual({ kind: "hill", cards: 3, duels: 2 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.read(playKey("b1"))).toBeNull();

    const receipt = notify.mock.lastCall![0] as SnackbarNotice;
    expect(receipt.text).toBe("Board arranged from 2 duels");
    act(() => receipt.action!.onClick());
    expect(takeBack).toHaveBeenCalled();
  });

  it("gives no receipt when Apply has nothing to take back", async () => {
    const notify = vi.fn();
    render(<Page store={memoryStore()} notify={notify} theirs />);
    await userEvent.click(playButton());
    expect(
      screen.getByText("The result goes into Mine. Theirs doesn’t change."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Bracket/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await pickLeft(2);
    await userEvent.click(screen.getByRole("button", { name: "Put in Mine" }));
    expect(notify).not.toHaveBeenCalled();
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
    await userEvent.keyboard("{Escape}");
    const saved = notify.mock.lastCall![0] as SnackbarNotice;
    expect(saved.action!.text).toBe("Discard");
    act(() => saved.action!.onClick());
    expect(store.read(playKey("b1"))).toBeNull();
    expect(playButton()).not.toHaveAccessibleDescription();
  });

  it("discards a saved game when another starts, with a way back to it", async () => {
    const store = memoryStore();
    const old = { ...newGame("swiss", ["c0", "c1", "c2"], EVERYTHING, 4, NOW), history: [] };
    localGames(store, () => NOW).save("b1", old);
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    expect(playButton()).toHaveAccessibleDescription("A game is saved.");

    await startGame(/Bracket/);
    const receipt = notify.mock.lastCall![0] as SnackbarNotice;
    expect(receipt.text).toBe("Saved game discarded");
    expect(localGames(store).load("b1")?.spec.kind).toBe("bracket");

    act(() => receipt.action!.onClick());
    expect(localGames(store).load("b1")).toEqual(old);
    // Back to the picker, where the old game waits.
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("asks a board too big for one game to choose its cards first", async () => {
    render(<Page store={memoryStore()} cards={cardsOf(70)} />);
    await userEvent.click(playButton());
    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    expect(screen.getByText("3 cards from Films")).toBeInTheDocument();
    // Cancel there goes back to the picker, not out.
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Play" })).toBeInTheDocument();
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

  it("cancels a result with a way back to it, and plays again over the same cards", async () => {
    const store = memoryStore();
    const notify = vi.fn();
    render(<Page store={store} notify={notify} />);
    await startGame(/King of the hill/);
    await pickLeft(2);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const receipt = notify.mock.lastCall![0] as SnackbarNotice;
    expect(receipt.text).toBe("Result discarded");
    expect(store.read(playKey("b1"))).toBeNull();

    act(() => receipt.action!.onClick());
    expect(screen.getByRole("heading", { name: "Your result" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.getByRole("dialog", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /King of the hill/ })).toBeChecked();
    expect(store.read(playKey("b1"))).toBeNull();
  });

  it("refines a result on the same screen", async () => {
    render(<Page store={memoryStore()} cards={cardsOf(6)} />);
    await startGame(/King of the hill/);
    await pickLeft(5);
    await userEvent.click(screen.getByRole("button", { name: "Refine" }));
    expect(screen.getAllByText(/^Refine · 1 of \d+$/)).not.toHaveLength(0);
  });
});
