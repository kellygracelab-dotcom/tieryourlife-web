import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { MyRankings, RankingSummary } from "../api/rank";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";

const mocks = vi.hoisted(() => ({ loadMyRankings: vi.fn<() => Promise<MyRankings>>() }));
vi.mock("../lib/api", () => ({
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
) => {
  render(
    <SessionContext.Provider value={{ account, signIn, signOut: async () => undefined }}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/me"] })} />
    </SessionContext.Provider>,
  );
  return signIn;
};

beforeEach(() => {
  mocks.loadMyRankings.mockReset();
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
    expect(screen.queryByText(/Only the newest/)).toBeNull();
  });

  it("says when there is nothing yet, and when there is more than it shows", async () => {
    mocks.loadMyRankings.mockResolvedValueOnce({ rankings: [], more: false });
    open(member);
    expect(await screen.findByText("Rankings you keep will show up here.")).toBeInTheDocument();

    mocks.loadMyRankings.mockResolvedValueOnce({
      rankings: [summary("cccccccc", "Capped")],
      more: true,
    });
    open(member);
    expect(await screen.findByText("Only the newest 1 are shown.")).toBeInTheDocument();
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
