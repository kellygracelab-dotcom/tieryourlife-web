import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    onDiscard: vi.fn(),
    onStart: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <GamePicker
      from="Sci-fi films"
      count={34}
      kind="swiss"
      saved={null}
      theirs={false}
      now={NOW}
      canStartAgain
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
    expect(
      screen.getByText("Losers stay · 34 cards from Sci-fi films · about 136 duels · 9 min"),
    ).toBeInTheDocument();
    expect(screen.getByText("Leave any time — the game is kept.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Choose cards" }));
    expect(onChooseCards).toHaveBeenCalled();
  });

  it("offers four games, smart first, with the design's estimates, the chosen one checked", async () => {
    const { onKind } = show({ kind: "hill" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios[0]).toHaveAccessibleName(expect.stringContaining("Smart"));
    expect(screen.getByRole("radio", { name: /Smart/ })).toHaveAccessibleName(
      expect.stringContaining("about 85 duels · 6 min"),
    );
    expect(screen.getByRole("radio", { name: /King of the hill/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Losers stay/ })).toHaveAccessibleName(
      expect.stringContaining("about 136 duels · 9 min"),
    );
    expect(screen.getByRole("radio", { name: /Bracket/ })).toHaveAccessibleName(
      expect.stringContaining("33 duels · 2 min"),
    );
    await userEvent.click(screen.getByRole("radio", { name: /Bracket/ }));
    expect(onKind).toHaveBeenCalledWith("bracket");
  });

  it("opens on Smart with one big Start, the other games folded away (audit B4)", async () => {
    const { onStart, onKind } = show({ kind: "smart", from: null });
    expect(screen.getByText("34 cards · about 85 duels · 6 min")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Other ways to play" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toHaveClass("play-start");
    expect(start).toHaveAccessibleDescription("34 cards · about 85 duels · 6 min");
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    expect(onKind).toHaveBeenCalledWith("hill");
    await userEvent.click(start);
    expect(onStart).toHaveBeenCalled();
  });

  it("warns over Start that the game moves cards placed by hand (artboards 15, 24)", () => {
    show({ kind: "smart", from: null, placed: 4 });
    const warning = "You’ve placed 4 cards. The game rearranges them; Undo brings them back.";
    expect(screen.getByText(warning)).toHaveClass("play-placed");
    expect(screen.getByRole("button", { name: "Start" })).toHaveAccessibleDescription(
      `34 cards · about 85 duels · 6 min ${warning}`,
    );
  });

  // QA 19.11: a visitor on somebody's list placed nothing; the author did.
  it("says the author placed the cards on a visitor's game", () => {
    show({ kind: "smart", from: null, placed: 3, theirs: true, placedByAuthor: true });
    expect(
      screen.getByText(
        "The author placed 3 cards. The game rearranges them in Mine; Undo brings them back.",
      ),
    ).toHaveClass("play-placed");
    expect(screen.queryByText(/You’ve placed/)).not.toBeInTheDocument();
  });

  it("says nothing of placed cards when none are", () => {
    show({ placed: 0 });
    expect(screen.queryByText(/You’ve placed/)).not.toBeInTheDocument();
  });

  it("says a game needs more cards instead of a summary", () => {
    show({ count: 1 });
    expect(screen.getByText("Play needs at least 3 cards.")).toBeInTheDocument();
    expect(screen.queryByText("Leave any time — the game is kept.")).not.toBeInTheDocument();
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
      "33 duels · 2 min",
    );
  });

  it("offers all games and their estimates on a board of 91", () => {
    show({ count: 91 });
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(document.querySelectorAll(".play-game__estimate")).toHaveLength(4);
  });

  it("goes when its handle is pulled down far enough, and comes back up otherwise", async () => {
    const { onCancel } = show();
    const handle = document.querySelector<HTMLElement>(".play-sheet__handle")!;
    const sheet = document.querySelector<HTMLElement>(".play-sheet")!;
    const pull = (by: number) => {
      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 100 + by, pointerId: 1 });
      expect(sheet.style.transform).toBe(`translateY(${by}px)`);
      fireEvent.pointerUp(handle, { clientY: 100 + by, pointerId: 1 });
    };
    pull(30);
    expect(sheet.style.transform).toBe("");
    expect(document.querySelector(".play-scrim--leaving")).toBeNull();
    pull(120);
    expect(document.querySelector(".play-scrim--leaving")).not.toBeNull();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it("puts a saved game first, with how far it got and when it started", async () => {
    const saved: Resume = { kind: "ready", game: savedGame("swiss") };
    const { onResume } = show({ saved });
    expect(screen.getByText(/^Losers stay · 1 of \d+$/)).toBeInTheDocument();
    expect(screen.getByText("Started yesterday")).toBeInTheDocument();
    // The games under it are the other way to go.
    expect(screen.getByText("Or start a new game")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("starts again a hill or a bracket whose board changed under it", async () => {
    const saved: Resume = { kind: "changed", game: savedGame("hill") };
    const { onStartAgain } = show({ saved });
    expect(screen.getByText("The list changed, so this game can’t go on")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Start again" });
    expect(again).toHaveClass("play-outlined");
    await userEvent.click(again);
    expect(onStartAgain).toHaveBeenCalled();
  });

  it("only lets go of a game a tier of whose area is gone, as the app does", async () => {
    const saved: Resume = { kind: "changed", game: savedGame("hill") };
    const { onStartAgain, onDiscard } = show({ saved, canStartAgain: false });
    expect(screen.getByText("The list changed, so this game can’t go on")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start again" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalled();
    expect(onStartAgain).not.toHaveBeenCalled();
  });

  it("has no new-game line without a saved game", () => {
    show();
    expect(screen.queryByText("Or start a new game")).not.toBeInTheDocument();
  });

  it("says where the result goes on somebody else's list", () => {
    show({ theirs: true });
    expect(
      screen.getByText("The result goes into Mine. The author’s ranking doesn’t change."),
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
