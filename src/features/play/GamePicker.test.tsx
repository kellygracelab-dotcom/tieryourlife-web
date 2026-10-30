import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EVERYTHING } from "./chosen";
import { newGame, type Resume } from "./game";
import { GamePicker } from "./GamePicker";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const YESTERDAY = new Date(2026, 9, 27, 20, 0).getTime();

function show(props: Partial<Parameters<typeof GamePicker>[0]> = {}) {
  const handlers = {
    onKind: vi.fn(),
    onChooseCards: vi.fn(),
    onResume: vi.fn(),
    onStartAgain: vi.fn(),
    onStart: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <GamePicker
      title="Sci-fi films"
      count={34}
      kind="swiss"
      saved={null}
      theirs={false}
      now={NOW}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const savedGame = (kind: "swiss" | "hill") => ({
  ...newGame(kind, ["a", "b", "c", "d"], EVERYTHING, 1, YESTERDAY),
  history: [[0, 1, 0] as const],
});

describe("the game picker", () => {
  it("says what the game is over, and opens the choice of cards", async () => {
    const { onChooseCards } = show();
    expect(screen.getByRole("dialog", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByText("34 cards from Sci-fi films")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    expect(onChooseCards).toHaveBeenCalled();
  });

  it("offers three games with the design's estimates, the chosen one checked", async () => {
    const { onKind } = show({ kind: "hill" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /King of the hill/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Losers stay/ })).toHaveAccessibleName(
      expect.stringContaining("≈ 136 duels · about 5 min"),
    );
    expect(screen.getByRole("radio", { name: /Bracket/ })).toHaveAccessibleName(
      expect.stringContaining("33 duels · about 1 min"),
    );
    await userEvent.click(screen.getByRole("radio", { name: /Bracket/ }));
    expect(onKind).toHaveBeenCalledWith("bracket");
  });

  it("starts, cancels, and cannot start over too many cards or too few", async () => {
    const { onStart, onCancel } = show();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Once the sheet has gone out.
    expect(onCancel).not.toHaveBeenCalled();
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("shows each game's radio, icon and estimate on a line of its own", () => {
    show({ kind: "bracket" });
    const card = screen.getByRole("radio", { name: /Bracket/ }).closest("label")!;
    expect(card.querySelector(".play-radio")).not.toBeNull();
    expect(card.querySelector(".play-game__icon")).toHaveTextContent("account_tree");
    expect(card.querySelector(".play-game__text > .play-game__estimate")).toHaveTextContent(
      "33 duels · about 1 min",
    );
  });

  it("does not start over more than 64 cards", () => {
    show({ count: 2000 });
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("puts a saved game first, with how far it got and when it started", async () => {
    const saved: Resume = { kind: "ready", game: savedGame("swiss"), joined: 0 };
    const { onResume } = show({ saved });
    expect(screen.getByText(/^Losers stay · 1 of \d+$/)).toBeInTheDocument();
    expect(screen.getByText("Started yesterday")).toBeInTheDocument();
    // The games under it are the other way to go.
    expect(screen.getByText("Or start a new game")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("says when losers stay takes new cards in, and still resumes", () => {
    const saved: Resume = { kind: "ready", game: savedGame("swiss"), joined: 3 };
    show({ saved });
    expect(screen.getByText("3 new cards join from the next round")).toBeInTheDocument();
    expect(screen.queryByText("Started yesterday")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("starts again a hill or a bracket whose board changed under it", async () => {
    const saved: Resume = { kind: "changed", game: savedGame("hill") };
    const { onStartAgain } = show({ saved });
    expect(screen.getByText("The board changed, so this game can’t go on")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Start again" });
    expect(again).toHaveClass("play-outlined");
    await userEvent.click(again);
    expect(onStartAgain).toHaveBeenCalled();
  });

  it("has no new-game line without a saved game", () => {
    show();
    expect(screen.queryByText("Or start a new game")).not.toBeInTheDocument();
  });

  it("says where the result goes on somebody else's list", () => {
    show({ theirs: true });
    expect(
      screen.getByText("The result goes into Mine. Theirs doesn’t change."),
    ).toBeInTheDocument();
  });

  it("closes on Escape, once, after its exit", async () => {
    const { onCancel } = show();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".play-scrim--leaving")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it("comes in as it opens", () => {
    show();
    expect(document.querySelector(".play-scrim--arriving")).not.toBeNull();
  });
});
