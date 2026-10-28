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

const renderCard = (overrides: Partial<ListSummary> = {}, reason: string | null = null) =>
  render(
    <MemoryRouter>
      <ListCard list={{ ...list, ...overrides }} reason={reason} />
    </MemoryRouter>,
  );

describe("ListCard", () => {
  it("links to the list, and the author to their page, and says how many ranked it", () => {
    renderCard();
    const link = screen.getByRole("link", { name: /Every A24 film, ranked/ });
    expect(link).toHaveAttribute("href", "/l/abc%20def");
    // The app's card names the author alone, with no "by".
    const author = screen.getByRole("link", { name: "danylo" });
    expect(author).toHaveAttribute("href", "/u/u1");
    expect(screen.queryByText(/by danylo/)).toBeNull();
    expect(screen.getByText("34 cards · 2,140 rankings")).toBeInTheDocument();
  });

  it("stands without an author when the list is editorial", () => {
    renderCard({ authorUid: "85RRieyLyUPCEqHjdYCdxVlWxHx2", authorName: "Danylo Petrov" });
    expect(screen.getByRole("link", { name: /Every A24 film, ranked/ })).toBeInTheDocument();
    expect(screen.queryByText(/Danylo Petrov/)).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("34 cards · 2,140 rankings")).toBeInTheDocument();
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
    expect(screen.getAllByRole("link")[1]).toHaveTextContent("?");
  });

  it("draws the tier colours as bands when the list has no picture, never its title", () => {
    const { container } = renderCard({ tierColors: ["#b03a32", "#c06a25"] });
    expect(container.querySelectorAll(".art--stripes > span")).toHaveLength(2);
    expect(container.querySelector(".art__title")).toBeNull();
  });

  it("names nobody on an anonymous list, and links to nobody", () => {
    renderCard({ anonymous: true, authorUid: "", authorName: "", authorPhotoUrl: null });
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("says why a list is in a Following feed, above its title", () => {
    renderCard({}, "In Anime");
    expect(screen.getByRole("link", { name: /Every A24 film/ })).toHaveTextContent(
      "In AnimeEvery A24 film, ranked",
    );
  });
});
