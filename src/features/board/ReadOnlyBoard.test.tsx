import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { ReadOnlyBoard } from "./ReadOnlyBoard";

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  tiers: [
    { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: "https://img/ex.jpg", tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: 1 },
    { title: "Climax", imageUrl: null, tierIndex: null },
  ],
};

describe("ReadOnlyBoard", () => {
  it("draws each tier with its colour, label and caption, and the items the author placed", () => {
    render(<ReadOnlyBoard list={list} />);
    const board = screen.getByRole("region", { name: "Author's version" });
    const s = within(board).getByRole("list", { name: "S" });
    expect(within(s).getByRole("img", { name: "Ex Machina" })).toHaveAttribute(
      "src",
      "https://img/ex.jpg",
    );
    expect(within(board).getByRole("list", { name: "A" })).toHaveTextContent("The Witch");
    expect(board).toHaveTextContent("Masterpiece");
    expect(board.querySelector(".tier")).toHaveStyle({ "--band": "#b03a32" });
  });

  it("shows what the author left unranked under the tiers", () => {
    render(<ReadOnlyBoard list={list} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
    expect(screen.getByText("Climax")).toBeInTheDocument();
  });

  it("has no pool when everything is placed", () => {
    render(<ReadOnlyBoard list={{ ...list, items: list.items.slice(0, 2) }} />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});
