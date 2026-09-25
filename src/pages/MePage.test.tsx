import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { MyRankings, RankingSummary } from "../api/rank";
import type { ListSummary } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";

const mocks = vi.hoisted(() => ({
  loadMyRankings: vi.fn<() => Promise<MyRankings>>(),
  loadMyLists: vi.fn<() => Promise<{ lists: ListSummary[] }>>(),
  unpublish: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock("../lib/api", () => ({
  followState: vi.fn(() => new Promise(() => undefined)),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  suggestedAuthors: vi.fn(() => new Promise(() => undefined)),
  loadReports: vi.fn(() => new Promise(() => undefined)),
  report: vi.fn(),
  loadMyLists: mocks.loadMyLists,
  unpublish: mocks.unpublish,
  rearrangeRanking: vi.fn(),
  loadMyRankings: mocks.loadMyRankings,
  loadFeed: vi.fn(),
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  claimKept: vi.fn(),
}));

const summary = (
  code: string,
  title: string,
  extra: Partial<RankingSummary> = {},
): RankingSummary => ({
  code,
  listId: "abc",
  title,
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  placed: 7,
  itemCount: 10,
  imageUrl: null,
  createdAt: Date.UTC(2026, 8, 12, 12),
  ...extra,
});

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const open = (
  account: Session["account"],
  signIn = vi.fn(async () => ({ kind: "cancelled" as const })),
  path = "/me",
) => {
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </SessionContext.Provider>,
  );
  return signIn;
};

const published = (id: string, title: string): ListSummary => ({
  id,
  title,
  authorUid: "u1",
  authorName: "Danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 34,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 2140,
});

beforeEach(() => {
  mocks.loadMyRankings.mockReset();
  mocks.loadMyLists.mockReset();
  mocks.unpublish.mockReset();
});

describe("MePage", () => {
  it("asks a guest to sign in, and asks nothing of the network", async () => {
    const signIn = open({ kind: "guest", uid: "g1" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your rankings");
    expect(screen.getByText(/Sign in to see the rankings you keep/)).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("main")).getByRole("button", { name: "Sign in" }),
    );
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(mocks.loadMyRankings).not.toHaveBeenCalled();
  });

  it("waits until Firebase has said who is here", () => {
    open(null);
    expect(within(screen.getByRole("main")).queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(mocks.loadMyRankings).not.toHaveBeenCalled();
  });

  it("lists a member's rankings newest first with a picture, the author and the count", async () => {
    mocks.loadMyRankings.mockResolvedValue({
      rankings: [
        summary("aaaaaaaa", "Oscar films 2025", { imageUrl: "https://img/1.jpg" }),
        summary("bbbbbbbb", "Ghibli, ranked", { placed: 3, itemCount: 12 }),
      ],
      more: false,
    });
    open(member);
    expect(screen.getByLabelText("Your rankings")).toHaveAttribute("aria-busy", "true");
    const first = await screen.findByRole("link", { name: /Oscar films 2025/ });
    expect(first).toHaveAttribute("href", "/r/aaaaaaaa");
    expect(first.querySelector("img")).toHaveAttribute("src", "https://img/1.jpg");
    expect(first).toHaveTextContent("by danylo · 7 of 10 placed");
    expect(first).toHaveTextContent("Sep 12, 2026");
    expect(screen.getByRole("link", { name: /Ghibli, ranked/ })).toHaveTextContent(
      "3 of 12 placed",
    );
    expect(screen.getAllByRole("link", { name: "Edit" })[0]).toHaveAttribute(
      "href",
      "/r/aaaaaaaa?edit",
    );
    expect(screen.queryByText(/Only the newest/)).toBeNull();
  });

  it("says when there is nothing yet, and when there is more than it shows", async () => {
    mocks.loadMyRankings.mockResolvedValueOnce({ rankings: [], more: false });
    open(member);
    expect(await screen.findByText("Rankings you keep will show up here.")).toBeInTheDocument();
    expect(screen.getByText(/live in My lists/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse lists" })).toHaveAttribute("href", "/");

    mocks.loadMyRankings.mockResolvedValueOnce({
      rankings: [summary("cccccccc", "Capped")],
      more: true,
    });
    open(member);
    expect(await screen.findByText("Only the newest 1 is shown.")).toBeInTheDocument();
  });

  it("counts what is kept and leads to the lists tab", async () => {
    mocks.loadMyRankings.mockResolvedValue({
      rankings: [summary("aaaaaaaa", "One")],
      more: false,
    });
    open(member);
    expect(await screen.findByText("1 kept on this account")).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Your account" });
    expect(within(tabs).getByRole("link", { name: "Your rankings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "My lists" })).toHaveAttribute(
      "href",
      "/me/lists",
    );
  });

  it("lists what the account published from the app, with the feed's cards", async () => {
    mocks.loadMyLists.mockResolvedValue({
      lists: [published("l1", "Every A24 film, ranked"), published("l2", "Ghibli, ranked")],
    });
    open(member, undefined, "/me/lists");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My lists");
    expect(await screen.findByText("2 published from the app")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Every A24 film, ranked/ })).toHaveAttribute(
      "href",
      "/l/l1",
    );
    expect(screen.getAllByText("34 cards · 2,140 rankings")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Edit" })[0]).toHaveAttribute(
      "href",
      "/new?list=l1",
    );
    expect(mocks.loadMyRankings).not.toHaveBeenCalled();
  });

  it("says how to publish when nothing is published, and names a failure", async () => {
    mocks.loadMyLists.mockResolvedValueOnce({ lists: [] });
    open(member, undefined, "/me/lists");
    expect(await screen.findByText("Nothing published yet.")).toBeInTheDocument();
    expect(screen.getByText(/tap Publish/)).toBeInTheDocument();

    mocks.loadMyLists.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open(member, undefined, "/me/lists");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your lists.");
  });

  it("deletes a list after asking, and takes the card away", async () => {
    mocks.loadMyLists.mockResolvedValue({
      lists: [published("l1", "Every A24 film, ranked"), published("l2", "Ghibli, ranked")],
    });
    mocks.unpublish.mockResolvedValue(undefined);
    open(member, undefined, "/me/lists");
    expect(await screen.findByText("2 published from the app")).toBeInTheDocument();

    const [first] = screen.getAllByRole("button", { name: "Unpublish" });
    await userEvent.click(first!);
    const ask = screen.getByRole("group", { name: "Unpublish" });
    expect(ask).toHaveTextContent("Unpublish “Every A24 film, ranked”?");
    await userEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", { name: "Unpublish" })).toBeNull();
    expect(mocks.unpublish).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole("button", { name: "Unpublish" })[0]!);
    await userEvent.click(
      within(screen.getByRole("group", { name: "Unpublish" })).getByRole("button", {
        name: "Unpublish",
      }),
    );
    expect(mocks.unpublish).toHaveBeenCalledWith("l1");
    expect(await screen.findByText("1 published from the app")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Every A24 film/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Ghibli/ })).toBeInTheDocument();
  });

  it("names a failed delete and keeps the card; a list already gone counts as done", async () => {
    mocks.loadMyLists.mockResolvedValue({
      lists: [published("l1", "One"), published("l2", "Two")],
    });
    mocks.unpublish
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" }));
    open(member, undefined, "/me/lists");
    await screen.findByText("2 published from the app");

    const cards = within(screen.getByRole("list", { name: "My lists" })).getAllByRole("listitem");
    await userEvent.click(within(cards[0]!).getByRole("button", { name: "Unpublish" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Unpublish" })).getByRole("button", {
        name: "Unpublish",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    expect(screen.getByRole("link", { name: /One/ })).toBeInTheDocument();

    await userEvent.click(within(cards[1]!).getByRole("button", { name: "Unpublish" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Unpublish" })).getByRole("button", {
        name: "Unpublish",
      }),
    );
    expect(await screen.findByText("1 published from the app")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Two/ })).toBeNull();
  });

  it("asks a guest to sign in for their lists too", () => {
    open({ kind: "guest", uid: "g1" }, undefined, "/me/lists");
    expect(screen.getByText(/Sign in to see the lists/)).toBeInTheDocument();
    expect(mocks.loadMyLists).not.toHaveBeenCalled();
  });

  it("names a failure and tries again", async () => {
    mocks.loadMyRankings
      .mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }))
      .mockResolvedValueOnce({ rankings: [summary("dddddddd", "Back")], more: false });
    open(member);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your rankings.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Back/ })).toBeInTheDocument();
  });
});
