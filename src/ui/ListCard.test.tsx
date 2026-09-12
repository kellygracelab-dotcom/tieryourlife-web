import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { ListSummary } from "../api/types";
import { ListCard } from "./ListCard";

const list: ListSummary = {
  id: "abc def",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 34,
  coverImageUrl: null,
  previewImages: [],
  tierColors: ["#b03a32"],
  updatedAt: 0,
  takeCount: 2140,
};

const renderCard = (overrides: Partial<ListSummary> = {}) =>
  render(
    <MemoryRouter>
      <ListCard list={{ ...list, ...overrides }} />
    </MemoryRouter>,
  );

describe("ListCard", () => {
  it("links to the list and says who made it and how many ranked it", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/l/abc%20def");
    expect(link).toHaveTextContent("Every A24 film, ranked");
    expect(link).toHaveTextContent("by danylo");
    expect(link).toHaveTextContent("34 items · 2,140 rankings");
    expect(link).toHaveTextContent("D");
  });

  it("shows the author's face when there is one", () => {
    const { container } = renderCard({ authorPhotoUrl: "https://lh3/face.jpg" });
    expect(container.querySelector(".list-card__face")).toHaveAttribute(
      "src",
      "https://lh3/face.jpg",
    );
    expect(container.querySelector(".list-card__face--initial")).toBeNull();
  });

  it("uses a question mark when the author has no name", () => {
    renderCard({ authorName: "  " });
    expect(screen.getByRole("link")).toHaveTextContent("?");
  });
});
