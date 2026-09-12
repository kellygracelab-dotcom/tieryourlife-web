import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ListSummary } from "../../api/types";
import { FeedGrid } from "./FeedGrid";
import type { FeedState } from "./useFeed";

const summary = (id: string, title: string): ListSummary => ({
  id,
  title,
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 12,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 3,
});

const lists = [summary("a1", "Every A24 film, ranked"), summary("b2", "Ghibli, ranked")];

const ready = (
  next: string | null = null,
  more: "idle" | "loading" | "failed" = "idle",
  items = lists,
): FeedState => ({ status: "ready", lists: items, next, more });

const show = (state: FeedState, paged?: boolean) => {
  const retry = vi.fn();
  const more = vi.fn();
  render(
    <MemoryRouter>
      <FeedGrid state={state} label="Popular" retry={retry} more={more} paged={paged} />
    </MemoryRouter>,
  );
  return { retry, more };
};

describe("FeedGrid", () => {
  it("holds the place of the cards while loading", () => {
    show({ status: "loading" });
    expect(screen.getByLabelText("Popular")).toHaveAttribute("aria-busy", "true");
  });

  it("names a failure and lets a person try again", async () => {
    const { retry } = show({ status: "error", error: { kind: "offline" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    show({ status: "error", error: { kind: "unavailable" } });
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("Could not load the lists.");
  });

  it("says when there is nothing", () => {
    show(ready(null, "idle", []));
    expect(screen.getByText("No lists here yet.")).toBeInTheDocument();
  });

  it("lists the cards and offers more only while there is more", async () => {
    show(ready());
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Ghibli, ranked/ })).toHaveAttribute("href", "/l/b2");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

    const { more } = show(ready("c1"));
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(more).toHaveBeenCalledTimes(1);
  });

  it("shows the next page coming, names a failure, and stays quiet when not paged", () => {
    show(ready("c1", "loading"));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    show(ready("c1", "failed"));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load more.");

    show(ready("c1"), false);
    expect(screen.getAllByRole("button", { name: "Show more" })).toHaveLength(1);
  });
});
