import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { memoryStore } from "../features/board/draft";
import { HIDDEN_KEY } from "../features/community/hidden";
import type { FollowDeps } from "../features/community/useFollow";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { ProfilePage } from "./ProfilePage";

vi.mock("../lib/api", () => ({
  loadReports: vi.fn(() => new Promise(() => undefined)),
  suggestedAuthors: vi.fn(() => new Promise(() => undefined)),
  loadFeed: vi.fn(),
  followState: vi.fn(),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  report: vi.fn(),
}));

const list = (id: string): ListSummary => ({
  id,
  title: `List ${id}`,
  authorUid: "u2",
  authorName: "someone",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 5,
});

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const load = vi.fn<(query: FeedQuery) => Promise<FeedPage>>();
const follow: FollowDeps = {
  state: vi.fn(),
  follow: vi.fn(),
  unfollow: vi.fn(),
};

const open = (
  account: Session["account"] = member,
  signIn: Session["signIn"] = async () => ({ kind: "cancelled" }),
  state: unknown = { author: { name: "Someone Nice", photoUrl: "https://img/face.jpg" } },
) => {
  const routes: RouteObject[] = [
    { path: "/u/:uid", element: <ProfilePage load={load} follow={follow} /> },
    { path: "/settings", element: <h1>Settings page</h1> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [{ pathname: "/u/u2", state }],
  });
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
};

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue({ lists: [list("a"), list("b")], nextCursor: null });
  vi.mocked(follow.state).mockReset();
  vi.mocked(follow.state).mockResolvedValue({ following: false, followers: 1203 });
  vi.mocked(follow.follow).mockReset();
  vi.mocked(follow.follow).mockResolvedValue(undefined);
  vi.mocked(follow.unfollow).mockReset();
  vi.mocked(follow.unfollow).mockResolvedValue(undefined);
  useHiddenStoreForTests(memoryStore());
});

describe("ProfilePage", () => {
  it("shows the author from the link, their counts and their lists newest first", async () => {
    open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Someone Nice");
    expect(await screen.findByText("1,203 followers · 2 public lists")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ author: "u2", sort: "recent" });
    expect(screen.getByRole("link", { name: /List a/ })).toBeInTheDocument();
  });

  it("follows on press, the count moves at once, and comes back if the backend says no", async () => {
    vi.mocked(follow.follow).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    const button = await screen.findByRole("button", { name: "Follow" });
    await userEvent.click(button);
    expect(follow.follow).toHaveBeenCalledWith("u2");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t follow");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("1,203 followers · 2 public lists")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(screen.getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("1,204 followers · 2 public lists")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Following/ }));
    expect(follow.unfollow).toHaveBeenCalledWith("u2");
    expect(screen.getByText("1,203 followers · 2 public lists")).toBeInTheDocument();
  });

  it("asks a guest to sign in and follows by itself once they have", async () => {
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValue({ kind: "signedIn", switched: false });
    open({ kind: "guest", uid: "g1" }, signIn);
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    const ask = screen.getByRole("dialog", { name: "Sign in to follow" });
    expect(ask).toHaveTextContent("Following keeps new lists");
    await userEvent.click(within(ask).getByRole("button", { name: "Continue with Google" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(follow.follow).toHaveBeenCalledWith("u2");
  });

  it("offers Settings on one's own page, says when nothing is public, and names the author from the lists", async () => {
    load.mockResolvedValue({ lists: [], nextCursor: null });
    open({ ...member, uid: "u2" }, undefined, null);
    expect(await screen.findByText("No public lists yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit in Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Someone");

    load.mockResolvedValue({ lists: [list("a")], nextCursor: null });
    open(member, undefined, null);
    expect(await screen.findAllByRole("heading", { level: 1, name: "someone" })).not.toHaveLength(
      0,
    );
  });

  it("shows a hidden author's page without their lists, with a way back", async () => {
    const store = memoryStore();
    store.write(
      HIDDEN_KEY,
      JSON.stringify({ lists: [], authors: [{ uid: "u2", name: "someone" }] }),
    );
    useHiddenStoreForTests(store);
    open();
    expect(await screen.findByText("You hid everything from this person.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /List a/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Unhide" }));
    expect(await screen.findByRole("link", { name: /List a/ })).toBeInTheDocument();
  });
});
