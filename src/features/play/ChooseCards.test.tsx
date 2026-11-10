import { render, screen, waitFor, within } from "@testing-library/react";
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

function show(chosen: Chosen = { kind: "rows", tiers: [], pool: false, keepTier: true }) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<ChooseCards board={board} chosen={chosen} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
}

const continueButton = () => screen.getByRole("button", { name: "Continue" });

describe("choosing cards", () => {
  it("lists the pool, occupied tiers and the exact whole-board count", () => {
    show();
    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "The pool · 22 cards" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /S Masterpieces/ })).toHaveAccessibleName(
      expect.stringContaining("142 cards"),
    );
    expect(screen.getByRole("checkbox", { name: /^Tier A/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Tier B/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Everything · 194 cards" })).toBeEnabled();
    // Nothing chosen yet on a board too big for one game.
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it("counts what is ticked, and goes on with those rows", async () => {
    const { onDone } = show();
    await userEvent.click(screen.getByRole("checkbox", { name: "The pool · 22 cards" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^Tier A/ }));
    expect(screen.getByText("52 selected")).toBeInTheDocument();
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

  it("samples without replacement from the selected tier and previews the fixed members", async () => {
    const { onDone } = show();
    await userEvent.click(screen.getByRole("checkbox", { name: /S Masterpieces/ }));
    expect(screen.getByText("142 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "128" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "64" }));
    await userEvent.click(screen.getByText("64 picked"));
    const names = screen
      .getAllByRole("listitem")
      .filter((el) => el.closest("details"))
      .map((el) => el.textContent);
    expect(new Set(names).size).toBe(64);
    expect(names.every((n) => n?.startsWith("s "))).toBe(true);
    await userEvent.click(continueButton());
    const selection = onDone.mock.lastCall![0];
    expect(selection.ids).toEqual(names.map((n) => n?.replace(" ", "")));
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
    await userEvent.click(
      within(screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!).getByRole(
        "button",
        { name: "Pick cards" },
      ),
    );
    expect(screen.getByRole("dialog", { name: "Pick cards" })).toBeInTheDocument();

    // A search narrows the grid.
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a card" }), "s 14");
    // s 14, s 140 and s 141.
    expect(within(screen.getByRole("list")).getAllByRole("checkbox")).toHaveLength(3);
    await userEvent.click(screen.getByRole("checkbox", { name: "s 140" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "s 141" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(continueButton());

    // Back on the rows: the tier shows its picks, and the cards stay in it by default.
    expect(screen.getByText("2 picked")).toBeInTheDocument();
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Keep them in S, just order them" })).toBeChecked();
    await userEvent.click(continueButton());
    expect(onDone).toHaveBeenCalledWith({
      kind: "picked",
      tier: "S",
      ids: ["s140", "s141"],
      keepTier: true,
    });
  });

  it("accepts an existing manual selection above 64", async () => {
    const ids = s.slice(0, 91).map((c) => c.id);
    const { onDone } = show({ kind: "picked", tier: "S", ids, keepTier: true });
    expect(screen.getByText("91 selected")).toBeInTheDocument();
    await userEvent.click(continueButton());
    expect(onDone.mock.lastCall![0].ids).toEqual(ids);
  });

  it("goes back from the picking without keeping it", async () => {
    show();
    await userEvent.click(
      within(screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!).getByRole(
        "button",
        { name: "Pick cards" },
      ),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "s 0" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("keeps the rows ticked before when nothing is picked", async () => {
    show();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Tier A/ }));
    expect(screen.getByText("30 selected")).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!).getByRole(
        "button",
        { name: "Pick cards" },
      ),
    );
    await userEvent.click(continueButton());
    expect(screen.getByText("30 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Tier A/ })).toBeChecked();
  });

  it("puts the focus in the search when the picking opens", async () => {
    show();
    await userEvent.click(
      within(screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!).getByRole(
        "button",
        { name: "Pick cards" },
      ),
    );
    expect(screen.getByRole("searchbox", { name: "Find a card" })).toHaveFocus();
  });

  it("starts from everything on a board that fits, and goes on with all of it", async () => {
    const small = boardOf(a.slice(0, 5), [tier("A", "A", null, a.slice(0, 2))]);
    const onDone = vi.fn();
    render(<ChooseCards board={small} chosen={EVERYTHING} onDone={onDone} onCancel={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Everything · 5 cards" })).toBeChecked();
    expect(screen.getByText("5 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Everything · 5 cards" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
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
    await userEvent.click(
      within(screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!).getByRole(
        "button",
        { name: "Pick cards" },
      ),
    );
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
    await userEvent.click(
      within(screen.getByRole("checkbox", { name: /Masterpieces/ }).closest("li")!).getByRole(
        "button",
        { name: "Pick cards" },
      ),
    );
    const box = screen.getByRole("checkbox", { name: "s 0" });
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box.closest(".play-pick__card")!.querySelector(".play-pick__check")).not.toBeNull();
  });
});
