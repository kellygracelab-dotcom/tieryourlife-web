import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { ListSummary } from "../api/types";
import { ListCard, type Yours } from "./ListCard";

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

const renderCard = (
  overrides: Partial<ListSummary> = {},
  reason: string | null = null,
  yours: Yours | null = null,
) =>
  render(
    <MemoryRouter>
      <ListCard list={{ ...list, ...overrides }} reason={reason} yours={yours} />
    </MemoryRouter>,
  );

const me: Yours = { uid: "u1", name: "Danylo", photoUrl: "https://lh3/me.jpg" };

describe("ListCard", () => {
  it("links to the list, and the author to their page, and says how many cards but not how many ranked it", () => {
    renderCard();
    const link = screen.getByRole("link", { name: /Every A24 film, ranked/ });
    expect(link).toHaveAttribute("href", "/l/abc%20def");
    // Named by its title alone: the tile without pictures says nothing of its own.
    expect(link).toHaveAccessibleName("Every A24 film, ranked");
    expect(screen.queryByRole("img", { name: "No picture" })).toBeNull();
    // The app's card names the author alone, with no "by".
    const author = screen.getByRole("link", { name: "danylo" });
    expect(author).toHaveAttribute("href", "/u/u1");
    expect(screen.queryByText(/by danylo/)).toBeNull();
    // A small count makes the place look empty, a big one is noise: only the cards are counted.
    expect(screen.getByText("34 cards")).toBeInTheDocument();
    expect(screen.queryByText(/rankings|2,140/)).toBeNull();
  });

  it("stands without an author when the list is editorial", () => {
    renderCard({ authorUid: "85RRieyLyUPCEqHjdYCdxVlWxHx2", authorName: "Danylo Petrov" });
    expect(screen.getByRole("link", { name: /Every A24 film, ranked/ })).toBeInTheDocument();
    expect(screen.queryByText(/Danylo Petrov/)).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("34 cards")).toBeInTheDocument();
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

  it("shows no author at all on somebody else's anonymous list: no name, no empty face", () => {
    const { container } = renderCard({
      anonymous: true,
      authorUid: "",
      authorName: "",
      authorPhotoUrl: null,
    });
    expect(screen.queryByText(/Anonymous/)).toBeNull();
    expect(container.querySelector(".list-card__author, .list-card__face")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("34 cards")).toBeInTheDocument();
  });

  it("wears one's own face on one's own lists, and says when one went out anonymously", () => {
    const { container, unmount } = renderCard({ authorPhotoUrl: "https://lh3/old.jpg" }, null, me);
    const yours = screen.getByRole("link", { name: "Your list" });
    expect(yours).toHaveAttribute("href", "/u/u1");
    expect(container.querySelector(".list-card__face")).toHaveAttribute(
      "src",
      "https://lh3/me.jpg",
    );
    expect(screen.queryByText("danylo")).toBeNull();
    unmount();

    // The backend names nobody on an anonymous list, but tells its author it is theirs.
    const anonymous = renderCard(
      { anonymous: true, mine: true, authorUid: "", authorName: "", authorPhotoUrl: null },
      null,
      { ...me, photoUrl: null },
    );
    // A closed eye says it on the card; a screen reader hears it in words.
    expect(screen.getByText("Your list, published anonymously")).toHaveClass("visually-hidden");
    expect(anonymous.container.querySelector(".list-card__hidden")).toHaveTextContent(
      "visibility_off",
    );
    expect(screen.queryByText(/·/)).toBeNull();
    expect(anonymous.container.querySelector(".list-card__face--initial")).toHaveTextContent("D");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("says why a list is in a Following feed, above its title", () => {
    renderCard({}, "In Anime");
    expect(screen.getByRole("link", { name: /Every A24 film/ })).toHaveTextContent(
      "In AnimeEvery A24 film, ranked",
    );
  });

  it("names a house list in the reader's language when it has one", () => {
    renderCard({ names: { en: "Ramen, everywhere", ru: "Рамен" } });
    expect(screen.getByText("Ramen, everywhere")).toBeInTheDocument();
  });
});
