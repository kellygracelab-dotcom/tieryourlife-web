import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardOf, type PlayTier } from "./board";
import { EVERYTHING } from "./chosen";
import { DuelLayer } from "./DuelLayer";
import { currentPair, newGame, pick, type Game } from "./game";

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

describe("the duel layer", () => {
  it("shows the game, the duel, and two cards to pick by name", () => {
    const { game } = play();
    const [first, second] = currentPair(game)!;
    expect(screen.getByRole("dialog", { name: "Bracket" })).toBeInTheDocument();
    expect(screen.getAllByText("Duel 1 of 3")).toHaveLength(2); // the header and the live region
    expect(screen.getByRole("button", { name: `Pick ${nameOf(game, first)}` })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Pick ${nameOf(game, second)}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo last pick" })).toBeDisabled();
    expect(screen.getByText("Skip if you can’t choose. Nothing is recorded.")).toBeInTheDocument();
  });

  it("picks with a click, after the picked card has shown its ring", async () => {
    const { game, onChange } = play();
    const [first] = currentPair(game)!;
    const card = screen.getByRole("button", { name: `Pick ${nameOf(game, first)}` });
    await userEvent.click(card);
    expect(card).toHaveClass("duel-card--chosen");
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(pick(game, first)));
  });

  it("picks the left card with ← and the right with →", async () => {
    const { game, onChange, last } = play();
    const [first] = currentPair(game)!;
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(last().history).toEqual([[...currentPair(game)!, first]]);
    const afterOne = last();
    const [, second] = currentPair(afterOne)!;
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(last().history[1]).toEqual([...currentPair(afterOne)!, second]);
    expect(screen.getAllByText("Duel 3 of 3")).toHaveLength(2);
  });

  it("skips with ↓ and the Skip button, recording no winner", async () => {
    const { last } = play();
    await userEvent.keyboard("{ArrowDown}");
    expect(last().history[0]![2]).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(last().history).toHaveLength(2);
    expect(last().history[1]![2]).toBeNull();
  });

  it("takes the last answer back with Z, Backspace and the button", async () => {
    const { last } = play();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(last().history).toHaveLength(2);
    await userEvent.keyboard("z");
    expect(last().history).toHaveLength(1);
    await userEvent.keyboard("{Backspace}");
    expect(last().history).toHaveLength(0);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.click(screen.getByRole("button", { name: "Undo last pick" }));
    expect(last().history).toHaveLength(0);
  });

  it("shows the skip line for the first three duels only", async () => {
    play(newGame("swiss", ["a", "b", "c", "d"], EVERYTHING, 3, 0));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByText(/Skip if you can’t choose/)).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.queryByText(/Skip if you can’t choose/)).not.toBeInTheDocument();
  });

  it("says losers stay's round in the header", () => {
    play(newGame("swiss", ["a", "b", "c", "d"], EVERYTHING, 3, 0));
    expect(screen.getByText("Round 1 of 4")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Bracket" })).toHaveFocus();
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    }
  });

  it("shows the result in place of the stage once the game is over", async () => {
    const { last } = play(newGame("hill", ["a", "b", "c"], EVERYTHING, 3, 0));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(last().history).toHaveLength(2);
    expect(screen.getByText("The result")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pick/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Duel/)).not.toBeInTheDocument();
    // Arrows mean nothing on the result; undo still takes the last answer back.
    await userEvent.keyboard("{ArrowLeft}");
    expect(last().history).toHaveLength(2);
    await userEvent.keyboard("z");
    expect(screen.queryByText("The result")).not.toBeInTheDocument();
  });

  it("settles faster with less motion", () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: query.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
    vi.useFakeTimers();
    try {
      const { onChange } = play();
      act(() => screen.getAllByRole("button", { name: /^Pick/ })[0]!.click());
      act(() => vi.advanceTimersByTime(89));
      expect(onChange).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = before;
    }
  });
});
