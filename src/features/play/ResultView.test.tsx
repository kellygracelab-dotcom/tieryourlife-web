import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { boardOf, type PlayTier } from "./board";
import { EVERYTHING } from "./chosen";
import { currentPair, newGame, pick, refineCount, resultOf, type Game } from "./game";
import { ResultView } from "./ResultView";

const ids = ["a", "b", "c", "d"];
const cards = ids.map((id) => ({ id, name: id.toUpperCase(), imageUrl: null }));
const tier = (id: string): PlayTier => ({
  id,
  label: id.toUpperCase(),
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds: [],
});
const board = boardOf(
  cards,
  ["s", "a", "b", "c", "d"].map((id) => tier(id)),
);

function playOut(game: Game, winner: (pair: readonly [number, number]) => number): Game {
  let next = game;
  for (let pair = currentPair(next); pair !== null; pair = currentPair(next)) {
    next = pick(next, winner(pair));
  }
  return next;
}

// A hill where the first champion beats everybody: three cards play one duel each.
const thin = playOut(newGame("hill", ids, EVERYTHING, 9, 0), ([champion]) => champion);
// Losers stay with a clear order: every card plays enough.
const solid = playOut(newGame("swiss", ids, EVERYTHING, 9, 0), ([a, b]) => Math.min(a, b));

function show(game: Game, theirs = false) {
  const handlers = { onApply: vi.fn(), onRefine: vi.fn(), onPlayAgain: vi.fn(), onCancel: vi.fn() };
  render(<ResultView game={game} board={board} theirs={theirs} {...handlers} />);
  return handlers;
}

describe("the result", () => {
  it("says how many duels it rests on, and takes the focus", () => {
    show(solid);
    expect(screen.getByRole("heading", { name: "Your result" })).toHaveFocus();
    expect(screen.getByText(`From ${solid.history.length} duels`)).toBeInTheDocument();
  });

  it("draws the board with every tier, an empty one saying so", () => {
    show(solid);
    const rows = resultOf(solid, board);
    for (const [index, row] of rows.entries()) {
      if (row.length === 0) continue;
      const list = screen.getByRole("list", { name: board.tiers[index]!.label });
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.title),
      ).toEqual(row.map((id) => id.toUpperCase()));
    }
    const empty = rows.filter((row) => row.length === 0).length;
    expect(screen.getAllByText("Empty")).toHaveLength(empty);
  });

  it("has no banner and no dashes when every card played enough", () => {
    show(solid);
    expect(screen.queryByText(/so their places are a guess/)).not.toBeInTheDocument();
    expect(screen.queryByText("Dashed: played fewer than 2 duels.")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".result-tile--dashed")).toHaveLength(0);
  });

  it("dashes the cards that played fewer than two duels, and says the result is thin", () => {
    show(thin);
    expect(screen.getByText("Dashed: played fewer than 2 duels.")).toBeInTheDocument();
    const dashed = [...document.querySelectorAll<HTMLElement>(".result-tile--dashed")];
    expect(dashed).toHaveLength(3);
    const refine = refineCount(thin);
    expect(
      screen.getByText(
        `3 cards played fewer than 2 duels, so their places are a guess. Refine adds up to ${refine} ${refine === 1 ? "duel" : "duels"} for them, or apply now and adjust by hand.`,
      ),
    ).toBeInTheDocument();
  });

  it("applies the result's rows, into Mine on somebody else's list", async () => {
    const own = show(solid);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(own.onApply).toHaveBeenCalledWith(resultOf(solid, board));
  });

  it("calls Apply Put in Mine on somebody else's list", () => {
    show(solid, true);
    expect(screen.getByRole("button", { name: "Put in Mine" })).toBeInTheDocument();
  });

  it("offers Refine with what it adds, then no more once it is used", async () => {
    const { onRefine } = show(thin);
    const refine = refineCount(thin);
    expect(
      screen.getByText(`+ up to ${refine} ${refine === 1 ? "duel" : "duels"}`),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refine" }));
    expect(onRefine).toHaveBeenCalled();
  });

  it("hides Refine once used, and the banner only says to adjust by hand", () => {
    // Refine used and its close calls answered with skips: still as thin as before.
    const used: Game = { ...thin, refineFixed: { from: thin.history.length, pairs: [] } };
    show(used);
    expect(screen.queryByRole("button", { name: "Refine" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "3 cards played fewer than 2 duels, so their places are a guess. Apply now and adjust by hand.",
      ),
    ).toBeInTheDocument();
  });

  it("plays again and cancels", async () => {
    const { onPlayAgain, onCancel } = show(solid);
    await userEvent.click(screen.getByRole("button", { name: "Play again" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onPlayAgain).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows only the kept tier when the cards stay in it", () => {
    const kept: Game = {
      ...solid,
      chosen: { kind: "rows", tiers: ["a"], pool: false, keepTier: true },
    };
    show(kept);
    expect(screen.getByRole("list", { name: "A" })).toBeInTheDocument();
    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
    expect(screen.queryByText("S")).not.toBeInTheDocument();
  });
});
