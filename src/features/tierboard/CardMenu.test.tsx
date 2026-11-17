import { render, screen, within } from "@testing-library/react";
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
});
