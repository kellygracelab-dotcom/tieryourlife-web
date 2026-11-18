import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { CardMenu } from "./CardMenu";

const tiers = [
  { label: "S", caption: null, colorLight: "#f00", colorDark: "#f88" },
  { label: "A", caption: null, colorLight: "#fa0", colorDark: "#fc8" },
];

describe("a card's menu", () => {
  it("puts Remove from list last, under a line, after the picture's three (QA 37)", () => {
    render(
      <CardMenu
        name="Dune"
        onAbout={vi.fn()}
        onOpenPage={vi.fn()}
        onAdjust={vi.fn()}
        tiers={tiers}
        current={0}
        at={{ x: 10, y: 10 }}
        opener={createRef<HTMLElement>()}
        onPlace={vi.fn()}
        onUnplace={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const menu = within(screen.getByRole("menu", { name: "Dune" }));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Move to a tierchevron_right",
      "Back to the deck",
      "Adjust picture",
      "About the picture",
      "Open its page",
      "Remove from list",
    ]);
    const line = menu.getByRole("separator");
    expect(line.nextElementSibling).toHaveTextContent("Remove from list");
  });

  it("offers Rename on one's own card, after Back to the deck, and closes as it opens the field (W22)", async () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(
      <CardMenu
        name="Untitled card"
        onAdjust={vi.fn()}
        onRename={onRename}
        tiers={tiers}
        current={0}
        at={{ x: 10, y: 10 }}
        opener={createRef<HTMLElement>()}
        onPlace={vi.fn()}
        onUnplace={vi.fn()}
        onRemove={vi.fn()}
        onClose={onClose}
      />,
    );
    const menu = within(screen.getByRole("menu", { name: "Untitled card" }));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Move to a tierchevron_right",
      "Back to the deck",
      "Rename",
      "Adjust picture",
      "Remove from list",
    ]);
    await userEvent.click(menu.getByRole("menuitem", { name: "Rename" }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("has no Rename where the card is not one's own to name", () => {
    render(
      <CardMenu
        name="Dune"
        tiers={tiers}
        current={null}
        at={{ x: 10, y: 10 }}
        opener={createRef<HTMLElement>()}
        onPlace={vi.fn()}
        onUnplace={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });
});
