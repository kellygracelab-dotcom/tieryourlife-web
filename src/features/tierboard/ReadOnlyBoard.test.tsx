import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublishedItem, PublishedTier } from "../../api/types";
import { ReadOnlyBoard } from "./ReadOnlyBoard";

const tiers: PublishedTier[] = [
  { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
  { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
];

const items: PublishedItem[] = [
  { title: "Ex Machina", imageUrl: "https://img/ex.jpg", tierIndex: 0 },
  { title: "The Witch", imageUrl: null, tierIndex: 1 },
  { title: "Climax", imageUrl: null, tierIndex: null },
];

describe("ReadOnlyBoard", () => {
  it("draws each tier with its colour, label and caption, and the items in its rows", () => {
    render(
      <ReadOnlyBoard
        label="Author's version"
        tiers={tiers}
        items={items}
        rows={[[0], [1]]}
        pool={[2]}
      />,
    );
    const board = screen.getByRole("region", { name: "Author's version" });
    const s = within(board).getByRole("list", { name: "S" });
    expect(within(s).getByRole("img", { name: "Ex Machina" })).toHaveAttribute(
      "src",
      "https://img/ex.jpg",
    );
    expect(within(board).getByRole("list", { name: "A" })).toHaveTextContent("The Witch");
    expect(board).toHaveTextContent("Masterpiece");
    expect(board.querySelector(".tier")).toHaveStyle({ "--band-light": "#b03a32" });
  });

  it("shows what was left unranked under the tiers", () => {
    render(
      <ReadOnlyBoard label="Yours" tiers={tiers} items={items} rows={[[0], [1]]} pool={[2]} />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
    expect(screen.getByText("Climax")).toBeInTheDocument();
  });

  it("has no pool when everything is placed, and skips positions the list lacks", () => {
    render(
      <ReadOnlyBoard
        label="Yours"
        tiers={tiers}
        items={items}
        rows={[
          [0, 9],
          [1, 2],
        ]}
        pool={[]}
      />,
    );
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("a card one only looks at, and its picture", () => {
  const credited: PublishedItem[] = [
    {
      title: "Ex Machina",
      imageUrl: "https://img/ex.jpg",
      tierIndex: 0,
      attribution: { source: "tmdb", link: "https://www.themoviedb.org/movie/264660" },
    },
    { title: "The Witch", imageUrl: "https://img/witch.jpg", tierIndex: 0 },
  ];
  const show = () =>
    render(
      <ReadOnlyBoard label="Board" tiers={tiers} items={credited} rows={[[0, 1]]} pool={[]} />,
    );

  it("has no «i» on its cards, and Enter on a card tells about its picture", () => {
    show();
    expect(screen.queryByRole("button", { name: /^About the picture/ })).toBeNull();
    // Enter clicks with no count of clicks, as a keyboard does.
    fireEvent.click(screen.getByRole("button", { name: "Ex Machina" }), { detail: 0 });
    expect(screen.getByRole("dialog", { name: "Ex Machina" })).toHaveTextContent(
      "This product uses the TMDB API",
    );
  });

  it("offers About the picture and Open its page on a right click, and leaves Shift to the browser", () => {
    show();
    const card = screen.getByRole("button", { name: "Ex Machina" });
    const shifted = createEvent.contextMenu(card, { shiftKey: true });
    fireEvent(card, shifted);
    expect(shifted.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(card, { clientX: 5, clientY: 5 });
    const menu = screen.getByRole("menu", { name: "Ex Machina" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["About the picture", "Open its page"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "About the picture" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Ex Machina" })).toBeInTheDocument();
  });

  it("shows a card with nothing to say large on a right click, as before", () => {
    show();
    fireEvent.contextMenu(screen.getByRole("button", { name: "The Witch" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "The Witch" }).querySelector(".card-detail__picture"),
    ).toHaveAttribute("src", "https://img/witch.jpg");
  });
});

describe("a card whose picture is gone", () => {
  it("shows its name instead of an empty tile", () => {
    const tiers: PublishedTier[] = [
      { label: "S", caption: null, colorLight: "#f00", colorDark: "#f00" },
    ];
    const items: PublishedItem[] = [
      { title: "Lost poster", imageUrl: "https://img.test/gone.jpg", tierIndex: 0 },
    ];
    const { container } = render(
      <ReadOnlyBoard label="Board" tiers={tiers} items={items} rows={[[0]]} pool={[]} />,
    );
    const picture = container.querySelector("img")!;
    fireEvent.error(picture);
    const tile = screen.getByRole("button", { name: "Lost poster" });
    expect(tile.querySelector("img")).toBeNull();
    expect(tile).toHaveClass("tile--name");
    expect(tile).toHaveTextContent("Lost poster");
  });
});
