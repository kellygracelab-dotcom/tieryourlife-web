import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { boardOf, type PlayCard, type PlayTier } from "./board";
import { ChooseCards } from "./ChooseCards";
import { EVERYTHING, type Chosen } from "./chosen";

const many = (prefix: string, n: number): PlayCard[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix} ${i}`,
    imageUrl: null,
  }));

const tier = (id: string, label: string, caption: string | null, cards: PlayCard[]): PlayTier => ({
  id,
  label,
  caption,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds: cards.map((card) => card.id),
});

// The pool 22, S 142 (too many for a game), A 30, B empty: 194 cards.
const pool = many("p", 22);
const s = many("s", 142);
const a = many("a", 30);
const board = boardOf(
  [...pool, ...s, ...a],
  [tier("S", "S", "Masterpieces", s), tier("A", "A", null, a), tier("B", "B", null, [])],
);

function show(chosen: Chosen = EVERYTHING) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<ChooseCards board={board} chosen={chosen} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
}

const continueButton = () => screen.getByRole("button", { name: "Continue" });

describe("choosing cards", () => {
  it("lists the pool and the tiers with cards, and everything only below 64", () => {
    show();
    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "The pool · 22 cards" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /S Masterpieces/ })).toHaveAccessibleName(
      expect.stringContaining("142 cards"),
    );
    expect(screen.getByRole("checkbox", { name: /^Tier A/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Tier B/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Everything · 194 cards" })).toBeDisabled();
    // Nothing chosen yet on a board too big for one game.
    expect(screen.getByText("0 of 64 selected")).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it("counts what is ticked, and goes on with those rows", async () => {
    const { onDone } = show();
    await userEvent.click(screen.getByRole("checkbox", { name: "The pool · 22 cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^Tier A/ }));
    expect(screen.getByText("52 of 64 selected")).toBeInTheDocument();
    // Two rows: no keeping them in a tier.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await userEvent.click(continueButton());
    expect(onDone).toHaveBeenCalledWith({
      kind: "rows",
      tiers: ["A"],
      pool: true,
      keepTier: false,
    });
  });

  it("says when there are too many, and does not go on", async () => {
    show();
    await userEvent.click(screen.getByRole("checkbox", { name: /S Masterpieces/ }));
    expect(screen.getByText("142 selected, pick up to 64")).toHaveClass("play-counter--over");
    expect(continueButton()).toBeDisabled();
  });

  it("keeps one tier's cards in it unless told otherwise", async () => {
    const { onDone } = show();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Tier A/ }));
    const keep = screen.getByRole("switch", { name: "Keep them in A, just order them" });
    expect(keep).toBeChecked();
    await userEvent.click(continueButton());
    expect(onDone).toHaveBeenLastCalledWith({
      kind: "rows",
      tiers: ["A"],
      pool: false,
      keepTier: true,
    });
    await userEvent.click(keep);
    await userEvent.click(continueButton());
    expect(onDone).toHaveBeenLastCalledWith({
      kind: "rows",
      tiers: ["A"],
      pool: false,
      keepTier: false,
    });
  });

  it("picks cards one by one in a tier too big for a game, up to 64", async () => {
    const { onDone } = show();
    expect(screen.getByText("Too many for one game. Use search to pick some.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pick cards" }));
    expect(screen.getByRole("dialog", { name: "Pick cards" })).toBeInTheDocument();

    // A search narrows the grid.
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a card" }), "s 14");
    // s 14, s 140 and s 141.
    expect(within(screen.getByRole("list")).getAllByRole("checkbox")).toHaveLength(3);
    await userEvent.click(screen.getByRole("checkbox", { name: "s 140" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "s 141" }));
    expect(screen.getByText("2 of 64 selected")).toBeInTheDocument();
    await userEvent.click(continueButton());

    // Back on the rows: the tier shows its picks, and the cards stay in it by default.
    expect(screen.getByText("2 picked")).toBeInTheDocument();
    expect(screen.getByText("2 of 64 selected")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Keep them in S, just order them" })).toBeChecked();
    await userEvent.click(continueButton());
    expect(onDone).toHaveBeenCalledWith({
      kind: "picked",
      tier: "S",
      ids: ["s140", "s141"],
      keepTier: true,
    });
  });

  it("stops picking at 64", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Pick cards" }));
    const grid = screen.getByRole("list");
    const boxes = within(grid).getAllByRole("checkbox");
    // Sixty-four clicks, as plain events: a user-event each would take seconds.
    for (const box of boxes.slice(0, 64)) fireEvent.click(box);
    expect(screen.getByText("64 of 64 selected")).toBeInTheDocument();
    expect(boxes[64]).toBeDisabled();
    expect(boxes[0]).toBeEnabled();
  });

  it("goes back from the picking without keeping it", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Pick cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "s 0" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("0 of 64 selected")).toBeInTheDocument();
  });

  it("starts from everything on a board that fits, and goes on with all of it", async () => {
    const small = boardOf(a.slice(0, 5), [tier("A", "A", null, a.slice(0, 2))]);
    const onDone = vi.fn();
    render(<ChooseCards board={small} chosen={EVERYTHING} onDone={onDone} onCancel={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Everything · 5 cards" })).toBeChecked();
    expect(screen.getByText("5 of 64 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Everything · 5 cards" }));
    expect(screen.getByText("0 of 64 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Everything · 5 cards" }));
    await userEvent.click(continueButton());
    expect(onDone).toHaveBeenCalledWith({ kind: "all" });
  });

  it("cancels, once the sheet has gone out", async () => {
    const { onCancel } = show();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("cancels the whole sheet from the picking too, not just the picking", async () => {
    const { onCancel } = show();
    await userEvent.click(screen.getByRole("button", { name: "Pick cards" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("has a back arrow only when the picker opened it", async () => {
    show();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    const onBack = vi.fn();
    render(
      <ChooseCards
        board={board}
        chosen={EVERYTHING}
        onDone={vi.fn()}
        onBack={onBack}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("names a tier by its caption, or as Tier and its letter, beside its band", () => {
    show();
    const named = screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!;
    expect(named.querySelector(".play-row__swatch")).toHaveTextContent("S");
    expect(screen.getByRole("checkbox", { name: /^Tier A/ })).toHaveAccessibleName(
      expect.stringContaining("30 cards"),
    );
  });

  it("marks a picked card with a check", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Pick cards" }));
    const box = screen.getByRole("checkbox", { name: "s 0" });
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box.closest(".play-pick__card")!.querySelector(".play-pick__check")).not.toBeNull();
  });
});
