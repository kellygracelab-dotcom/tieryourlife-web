import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardOf, type PlayTier } from "./board";
import { EVERYTHING } from "./chosen";
import {
  DuelLayer,
  PICK_DONE_MS,
  PICK_FADE_AT_MS,
  REDUCED_MS,
  RESULT_AFTER_MS,
  SKIP_DONE_MS,
} from "./DuelLayer";
import { currentPair, newGame, pick, type Game } from "./game";
import { SIDEWAYS } from "./media";

const cards = [
  { id: "a", name: "Arrival", imageUrl: null },
  { id: "b", name: "Blade Runner", imageUrl: "https://example.org/b.jpg" },
  { id: "c", name: "Contact", imageUrl: null },
  { id: "d", name: "Dune: Part Two", imageUrl: null },
];
const s: PlayTier = {
  id: "s",
  label: "S",
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds: [],
};
const board = boardOf(cards, [s]);
const nameOf = (game: Game, card: number) => cards.find((c) => c.id === game.ids[card])!.name;

/** The window as a media query would find it: these queries hold, no others. */
const windowWhere = (...holding: string[]) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: holding.includes(query),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

/** A browser that welcomes motion: the design's full timing. */
const FULL_MOTION = "(prefers-reduced-motion: no-preference)";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The layer over a game it plays for real, with every change seen. */
function Harness({
  start,
  onChange,
  onQuit,
}: {
  start: Game;
  onChange: (g: Game) => void;
  onQuit: () => void;
}) {
  const [game, setGame] = useState(start);
  return (
    <DuelLayer
      game={game}
      board={board}
      onChange={(next) => {
        onChange(next);
        setGame(next);
      }}
      onQuit={onQuit}
    >
      <p>The result</p>
    </DuelLayer>
  );
}

function play(game = newGame("bracket", ["a", "b", "c", "d"], EVERYTHING, 3, 0)) {
  const onChange = vi.fn<(g: Game) => void>();
  const onQuit = vi.fn();
  render(<Harness start={game} onChange={onChange} onQuit={onQuit} />);
  return { game, onChange, onQuit, last: () => onChange.mock.lastCall![0] };
}

/** Presses a key and waits for the game to take the answer. */
async function answer(key: string, onChange: { mock: { calls: unknown[] } }) {
  const before = onChange.mock.calls.length;
  await userEvent.keyboard(key);
  await waitFor(() => expect(onChange.mock.calls.length).toBe(before + 1));
}

describe("the duel layer", () => {
  it("shows the duel, the game's line, and two cards to pick by name", () => {
    const { game } = play();
    const [first, second] = currentPair(game)!;
    expect(screen.getByRole("dialog", { name: "Bracket" })).toBeInTheDocument();
    expect(screen.getAllByText("Duel 1 of 3")).toHaveLength(2); // the header and the live region
    expect(screen.getByRole("heading", { name: "Duel 1 of 3" })).toBeInTheDocument();
    expect(screen.getByText("Semi-finals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Pick ${nameOf(game, first)}` })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Pick ${nameOf(game, second)}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo last pick" })).toBeDisabled();
    expect(screen.getByText("Skip if you can’t choose. Nothing is recorded.")).toBeInTheDocument();
  });

  it("draws a card without a picture on its own surface, a pictured one by its picture", () => {
    // A seed whose first duel puts Blade Runner, the one pictured card, against a word.
    const seeded = Array.from({ length: 64 }, (_, seed) =>
      newGame("bracket", ["a", "b", "c", "d"], EVERYTHING, seed, 0),
    ).find((game) => currentPair(game)!.some((card) => game.ids[card] === "b"))!;
    const { game } = play(seeded);
    const [first, second] = currentPair(game)!.map((card) => nameOf(game, card));
    const worded = first === "Blade Runner" ? second! : first!;
    expect(screen.getByRole("button", { name: `Pick ${worded}` })).toHaveClass("duel-card--text");
    expect(screen.getByRole("button", { name: "Pick Blade Runner" })).not.toHaveClass(
      "duel-card--text",
    );
  });

  it("picks with a click, after the picked card has shown its ring and check", async () => {
    const { game, onChange } = play();
    const [first] = currentPair(game)!;
    const card = screen.getByRole("button", { name: `Pick ${nameOf(game, first)}` });
    await userEvent.click(card);
    expect(card).toHaveClass("duel-card--chosen");
    expect(card.querySelector(".duel-card__check")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(pick(game, first)));
  });

  it("picks the left card with ← and the right with →", async () => {
    const { game, onChange, last } = play();
    const [first] = currentPair(game)!;
    await answer("{ArrowLeft}", onChange);
    expect(last().history).toEqual([[...currentPair(game)!, first]]);
    const afterOne = last();
    const [, second] = currentPair(afterOne)!;
    await answer("{ArrowRight}", onChange);
    expect(last().history[1]).toEqual([...currentPair(afterOne)!, second]);
    expect(screen.getAllByText("Duel 3 of 3")).toHaveLength(2);
    // The bracket's last duel is its final.
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("skips with ↓ and the Skip button, recording no winner", async () => {
    const { last, onChange } = play();
    await answer("{ArrowDown}", onChange);
    expect(last().history[0]![2]).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Skip/ }));
    await waitFor(() => expect(last().history).toHaveLength(2));
    expect(last().history[1]![2]).toBeNull();
  });

  it("takes the last answer back with Z, Backspace and the button", async () => {
    const { last, onChange } = play();
    await answer("{ArrowDown}", onChange);
    await answer("{ArrowDown}", onChange);
    expect(last().history).toHaveLength(2);
    await userEvent.keyboard("z");
    expect(last().history).toHaveLength(1);
    await userEvent.keyboard("{Backspace}");
    expect(last().history).toHaveLength(0);
    await answer("{ArrowDown}", onChange);
    await userEvent.click(screen.getByRole("button", { name: "Undo last pick" }));
    expect(last().history).toHaveLength(0);
  });

  it("takes one answer at a time: a key while a pick settles is not a second one", async () => {
    const { onChange } = play();
    await userEvent.keyboard("{ArrowLeft}{ArrowRight}{ArrowDown}");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it("says the skip line for the first three duels, then keeps its place unseen", async () => {
    const { onChange } = play(newGame("swiss", ["a", "b", "c", "d"], EVERYTHING, 3, 0));
    const help = () => screen.getByText(/Skip if you can’t choose/);
    await answer("{ArrowDown}", onChange);
    await answer("{ArrowDown}", onChange);
    expect(help()).not.toHaveClass("duel__help--spent");
    await answer("{ArrowDown}", onChange);
    // Still there, so the cards above it do not move; hidden from sight and from a screen reader.
    expect(help()).toHaveClass("duel__help--spent");
    expect(help()).toHaveAttribute("aria-hidden", "true");
  });

  it("says losers stay's round on the line under the count", () => {
    play(newGame("swiss", ["a", "b", "c", "d"], EVERYTHING, 3, 0));
    expect(screen.getByText("Losers stay · Round 1 of 4")).toBeInTheDocument();
  });

  it("says who holds the hill once it has won twice in a row", async () => {
    const { onChange, last } = play(newGame("hill", ["a", "b", "c", "d"], EVERYTHING, 3, 0));
    expect(screen.getByText("King of the hill")).toBeInTheDocument();
    await answer("{ArrowLeft}", onChange);
    await answer("{ArrowLeft}", onChange);
    const champion = nameOf(last(), currentPair(last())![0]);
    expect(screen.getByText(`${champion} has won 2 in a row`)).toBeInTheDocument();
  });

  it("quits with Escape and with Quit", async () => {
    const { onQuit } = play();
    await userEvent.keyboard("{Escape}");
    expect(onQuit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(onQuit).toHaveBeenCalledTimes(2);
  });

  it("keeps its keys from the board underneath, Escape aside", async () => {
    const heard: string[] = [];
    const underneath = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener("keydown", underneath);
    try {
      play();
      await userEvent.keyboard("{ArrowDown}z1{Escape}");
    } finally {
      window.removeEventListener("keydown", underneath);
    }
    expect(heard).toEqual(["Escape"]);
  });

  it("keeps the focus inside", async () => {
    play();
    expect(screen.getByRole("heading", { name: "Duel 1 of 3" })).toHaveFocus();
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    }
  });

  it("shows the result in place of the duels once the game is over, with nothing to undo", async () => {
    const { last, onChange } = play(newGame("hill", ["a", "b", "c"], EVERYTHING, 3, 0));
    await answer("{ArrowDown}", onChange);
    await answer("{ArrowDown}", onChange);
    expect(last().history).toHaveLength(2);
    expect(await screen.findByText("The result")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pick/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Duel/)).not.toBeInTheDocument();
    // The result has its own header: the duels' Undo and keys mean nothing there.
    expect(screen.queryByRole("button", { name: "Undo last pick" })).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}z");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("puts Quit and Undo in a strip and the count and Skip between the cards, held sideways", () => {
    windowWhere(SIDEWAYS);
    play();
    expect(document.querySelector(".duel")).toHaveClass("duel--side");
    expect(document.querySelector(".duel__head")).toBeNull();
    const strip = document.querySelector(".duel__strip")!;
    expect(strip.querySelectorAll("button")).toHaveLength(2);
    const centre = document.querySelector<HTMLElement>(".duel__centre")!;
    expect(centre).toHaveTextContent("Duel 1 of 3");
    expect(centre).toHaveTextContent("Semi-finals");
    expect(centre.querySelector(".duel__skip")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Duel 1 of 3" })).toHaveFocus();
  });

  it("times a pick the design's way: the ring, the fade from 220 ms, the next pair at 340", () => {
    windowWhere(FULL_MOTION);
    vi.useFakeTimers();
    const { game, onChange } = play();
    const [first] = currentPair(game)!;
    act(() => screen.getByRole("button", { name: `Pick ${nameOf(game, first)}` }).click());
    act(() => vi.advanceTimersByTime(PICK_FADE_AT_MS - 1));
    expect(document.querySelectorAll(".duel__slot--fade")).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelectorAll(".duel__slot--fade")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(PICK_DONE_MS - PICK_FADE_AT_MS - 1));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the hill's champion in place while the challenger goes", () => {
    windowWhere(FULL_MOTION);
    vi.useFakeTimers();
    const { game, onChange } = play(newGame("hill", ["a", "b", "c", "d"], EVERYTHING, 3, 0));
    const [champion] = currentPair(game)!;
    const card = screen.getByRole("button", { name: `Pick ${nameOf(game, champion)}` });
    act(() => card.click());
    act(() => vi.advanceTimersByTime(PICK_FADE_AT_MS));
    expect(document.querySelectorAll(".duel__slot--fade")).toHaveLength(1);
    expect(card.closest(".duel__slot")).not.toHaveClass("duel__slot--fade");
    act(() => vi.advanceTimersByTime(PICK_DONE_MS));
    expect(onChange).toHaveBeenCalledTimes(1);
    // The same card, still on the stage: it did not leave and come back.
    expect(card).toBeInTheDocument();
  });

  it("drops both cards on a skip, then moves on", () => {
    windowWhere(FULL_MOTION);
    vi.useFakeTimers();
    const { onChange } = play();
    act(() => screen.getByRole("button", { name: /Skip/ }).click());
    expect(document.querySelectorAll(".duel__slot--drop")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(SKIP_DONE_MS - 1));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("fills the bar before the result comes", () => {
    windowWhere(FULL_MOTION);
    vi.useFakeTimers();
    play(newGame("hill", ["a", "b", "c"], EVERYTHING, 3, 0));
    for (let i = 0; i < 2; i++) {
      act(() => screen.getByRole("button", { name: /Skip/ }).click());
      act(() => vi.advanceTimersByTime(SKIP_DONE_MS));
    }
    expect(document.querySelector(".duel__bar")).toHaveClass("duel__bar--full");
    expect(screen.queryByText("The result")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(RESULT_AFTER_MS));
    expect(screen.getByText("The result")).toBeInTheDocument();
  });

  it("shows a finished game's result at once", () => {
    let game = newGame("hill", ["a", "b", "c"], EVERYTHING, 3, 0);
    for (let pair = currentPair(game); pair !== null; pair = currentPair(game)) {
      game = pick(game, pair[0]);
    }
    play(game);
    expect(screen.getByText("The result")).toBeInTheDocument();
  });

  it("settles in one short cross-fade with less motion", () => {
    windowWhere("(prefers-reduced-motion: reduce)");
    vi.useFakeTimers();
    const { onChange } = play();
    act(() => screen.getAllByRole("button", { name: /^Pick/ })[0]!.click());
    expect(document.querySelectorAll(".duel__slot--fade")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(REDUCED_MS - 1));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
