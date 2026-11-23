import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ListSummary } from "../../api/types";
import { FreshRow } from "./FreshRow";

const summary = (id: string, title: string, authorName = "olena"): ListSummary => ({
  id,
  title,
  authorUid: `u-${id}`,
  authorName,
  authorPhotoUrl: null,
  category: "games",
  itemCount: 20,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

const show = (lists: ListSummary[] | Error) => {
  const load = vi.fn(() =>
    lists instanceof Error ? Promise.reject(lists) : Promise.resolve(lists),
  );
  render(
    <MemoryRouter>
      <FreshRow load={load} />
    </MemoryRouter>,
  );
  return load;
};

describe("FreshRow", () => {
  it("shows people's newest lists in a row, each naming its author", async () => {
    show([summary("a", "Games I played", "Danylo Petrov"), summary("b", "Anime", "olena")]);
    expect(
      await screen.findByRole("heading", { level: 2, name: "New from the community" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("list", { name: "New from the community" });
    expect(row.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Danylo Petrov" })).toHaveAttribute("href", "/u/u-a");
  });

  it("is not there with fewer than two lists, nor when they could not be read", async () => {
    const one = show([summary("a", "Games I played")]);
    await vi.waitFor(() => expect(one).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "New from the community" })).toBeNull();

    const failed = show(new Error("offline"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "New from the community" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
