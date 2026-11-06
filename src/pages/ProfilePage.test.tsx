import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { intentStoreForTests } from "../features/community/afterSignIn";
import { HIDDEN_KEY } from "../features/community/hidden";
import type { FollowDeps } from "../features/community/useFollow";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { report } from "../lib/api";
import { memoryStore } from "../lib/storage";
import { sayOnTheSite, siteNotice } from "../ui/siteNotice";
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
  authorName: "Someone Nice",
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
  return router;
};

/** The menu on one list's card. */
const cardMenu = (title: string) =>
  within(screen.getByLabelText(`More about ${title}`).closest("details")!);

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
  sayOnTheSite(null);
});

describe("ProfilePage", () => {
  it("has no page for an editorial account, and asks nothing about it", () => {
    render(
      <SessionContext.Provider
        value={{
          account: member,
          signIn: async () => ({ kind: "cancelled" }),
          signOut: async () => undefined,
          refresh: () => undefined,
        }}
      >
        <RouterProvider
          router={createMemoryRouter(
            [{ path: "/u/:uid", element: <ProfilePage load={load} follow={follow} /> }],
            { initialEntries: ["/u/85RRieyLyUPCEqHjdYCdxVlWxHx2"] },
          )}
        />
      </SessionContext.Provider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "There is nothing at this address.",
    );
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(follow.state).not.toHaveBeenCalled();
  });

  it("shows the author from the link and their lists newest first, with no counts", async () => {
    open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Someone Nice");
    expect(await screen.findByRole("link", { name: /List a/ })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ author: "u2", sort: "recent" });
    await screen.findByRole("button", { name: "Follow" });
    // A small count makes the place look empty, a big one is noise: neither is said.
    expect(screen.queryByText(/followers?|public lists?/)).toBeNull();
    expect(screen.queryByText(/1,203/)).toBeNull();
  });

  it("follows on press at once, and comes back if the backend says no", async () => {
    vi.mocked(follow.follow).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    const button = await screen.findByRole("button", { name: "Follow" });
    await userEvent.click(button);
    expect(follow.follow).toHaveBeenCalledWith("u2");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t follow");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(screen.getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: /Following/ }));
    expect(follow.unfollow).toHaveBeenCalledWith("u2");
  });

  it("says the ceiling of people followed, which another press would not pass", async () => {
    vi.mocked(follow.follow).mockRejectedValueOnce(new ApiFailure({ kind: "tooManyFollowing" }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You follow as many people as you can. Unfollow someone first.",
    );
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
  });

  it("unfollows on press and keeps an Undo in a snackbar, which follows again", async () => {
    vi.mocked(follow.state).mockResolvedValue({ following: true, followers: 1204 });
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Following/ }));
    expect(follow.unfollow).toHaveBeenCalledWith("u2");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    const notice = screen.getByText("Unfollowed Someone Nice").parentElement!;
    expect(notice.parentElement).toHaveAttribute("role", "status");

    await userEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(follow.follow).toHaveBeenCalledWith("u2");
    expect(screen.queryByText("Unfollowed Someone Nice")).toBeNull();
    expect(screen.getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // An Undo the backend refuses comes back to the unfollowed state it was
    // pressed in, not to the state the snackbar was made in.
    vi.mocked(follow.follow).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    await userEvent.click(screen.getByRole("button", { name: /Following/ }));
    const again = screen.getByText("Unfollowed Someone Nice").parentElement!;
    await userEvent.click(within(again).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t follow");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
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
    // One's own page wears one's own name, not a placeholder.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Danylo");

    load.mockResolvedValue({ lists: [list("a")], nextCursor: null });
    open(member, undefined, null);
    expect(
      await screen.findAllByRole("heading", { level: 1, name: "Someone Nice" }),
    ).not.toHaveLength(0);
  });

  it("prefers the name the author's own lists carry over the one the link brought", async () => {
    open(undefined, undefined, { author: { name: "olena_1999", photoUrl: null } });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("olena_1999");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Someone Nice" }),
    ).toBeInTheDocument();
  });

  it("calls nobody Someone while their lists may still say who they are", async () => {
    let answer!: (page: FeedPage) => void;
    load.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    open(undefined, undefined, null);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAttribute("aria-busy", "true");
    expect(heading).not.toHaveTextContent("Someone");
    expect(screen.queryByLabelText("More options")).toBeNull();
    await act(async () => answer({ lists: [list("a")], nextCursor: null }));
    expect(heading).toHaveTextContent("Someone Nice");
  });

  it("draws somebody with no name as a person, and hides them under no name", async () => {
    const store = memoryStore();
    useHiddenStoreForTests(store);
    load.mockResolvedValue({ lists: [], nextCursor: null });
    open(undefined, undefined, { author: { name: "", photoUrl: null } });
    expect(await screen.findByText("No public lists yet.")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Someone");
    expect(document.querySelector(".profile__face")).toHaveTextContent("person");
    await userEvent.click(screen.getByLabelText("More options"));
    await userEvent.click(screen.getByRole("button", { name: "Hide everything from Someone" }));
    expect(JSON.parse(store.read(HIDDEN_KEY) ?? "{}")).toEqual({
      lists: [],
      authors: [{ uid: "u2", name: "" }],
    });
  });

  it("draws the initial when the face will not load", async () => {
    load.mockResolvedValue({
      lists: [{ ...list("a"), authorPhotoUrl: "https://img/gone.jpg" }],
      nextCursor: null,
    });
    open();
    await screen.findByRole("link", { name: /List a/ });
    const face = document.querySelector("img.profile__face")!;
    fireEvent.error(face);
    expect(document.querySelector("img.profile__face")).toBeNull();
    expect(document.querySelector(".profile__face--initial")).toHaveTextContent("S");
  });

  it("does not name the author on every card of their own page", async () => {
    open();
    await screen.findByRole("link", { name: /List a/ });
    expect(document.querySelector(".list-card__author")).toBeNull();
  });

  it("offers no Follow until the backend has said, nor when it cannot", async () => {
    let answer!: (state: { following: boolean; followers: number }) => void;
    vi.mocked(follow.state).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    open();
    await screen.findByRole("link", { name: /List a/ });
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    await act(async () => answer({ following: true, followers: 3 }));
    expect(screen.getByRole("button", { name: /Following/ })).toBeInTheDocument();
  });

  it("offers no Follow to a member when whether they follow cannot be read", async () => {
    vi.mocked(follow.state).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    await screen.findByRole("link", { name: /List a/ });
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
  });

  it("says a refused unfollow as one, and takes back the snackbar that said it was done", async () => {
    vi.mocked(follow.state).mockResolvedValue({ following: true, followers: 1204 });
    vi.mocked(follow.unfollow).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Following/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t unfollow");
    expect(screen.queryByText("Unfollowed Someone Nice")).toBeNull();
  });

  it("follows after a sign-in that went through a redirect and came back", async () => {
    intentStoreForTests(memoryStore());
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "redirecting" });
    open({ kind: "guest", uid: "g1" }, signIn);
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(follow.follow).not.toHaveBeenCalled();
    cleanup();

    // Back from Google, on the same page, signed in. The question of whether
    // they follow was asked before the follow went, and its answer does not undo it.
    let answer!: (state: { following: boolean; followers: number }) => void;
    vi.mocked(follow.state).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    open();
    await waitFor(() => expect(follow.follow).toHaveBeenCalledWith("u2"));
    expect(follow.follow).toHaveBeenCalledTimes(1);
    await act(async () => answer({ following: false, followers: 3 }));
    expect(screen.getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    cleanup();
    open();
    await screen.findByRole("link", { name: /List a/ });
    expect(follow.follow).toHaveBeenCalledTimes(1);
  });

  it("hides everything from the author from the page's menu, with an Undo, as the app does", async () => {
    open();
    await screen.findByRole("link", { name: /List a/ });
    await userEvent.click(screen.getByLabelText("More options"));
    await userEvent.click(
      screen.getByRole("button", { name: "Hide everything from Someone Nice" }),
    );
    expect(screen.getByText("You hid everything from this person.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /List a/ })).toBeNull();
    // Already hidden: the menu has nothing more to offer.
    expect(screen.queryByLabelText("More options")).toBeNull();
    const notice = screen.getByText(
      "Everything from Someone Nice is hidden for you",
    ).parentElement!;
    // The menu went with the choice; its Undo is where the keyboard lands.
    expect(within(notice).getByRole("button", { name: "Undo" })).toHaveFocus();
    await userEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("link", { name: /List a/ })).toBeInTheDocument();
  });

  it("offers Hide and Report on each card, as the app's long press does", async () => {
    open();
    await screen.findByRole("link", { name: /List a/ });
    await userEvent.click(screen.getByLabelText("More about List a"));
    await userEvent.click(cardMenu("List a").getByRole("button", { name: "Hide this list" }));
    expect(screen.queryByRole("link", { name: /List a/ })).toBeNull();
    // The card keeps its place as a tile with Undo, which has the focus the menu had.
    const tile = screen.getByText("Hidden for you").parentElement!;
    expect(within(tile).getByRole("button", { name: "Undo" })).toHaveFocus();
    expect(screen.getByRole("link", { name: /List b/ })).toBeInTheDocument();
    await userEvent.click(within(tile).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("link", { name: /List a/ })).toBeInTheDocument();
  });

  it("reports a list from its card, and the receipt stays while the card is hidden", async () => {
    vi.mocked(report).mockReset();
    vi.mocked(report).mockResolvedValue(undefined);
    open();
    await screen.findByRole("link", { name: /List b/ });
    await userEvent.click(screen.getByLabelText("More about List b"));
    await userEvent.click(cardMenu("List b").getByRole("button", { name: "Report this list" }));
    const form = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(form).getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(within(form).getByRole("button", { name: "Report" }));
    expect(report).toHaveBeenCalledExactlyOnceWith("b", { reason: "spam", note: null });
    expect(
      await screen.findByRole("dialog", { name: "Reported, and hidden for you" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /List b/ })).toBeNull();
    expect(screen.getByRole("link", { name: /List a/ })).toBeInTheDocument();
  });

  it("takes a guest's report from a card with no sign-in", async () => {
    vi.mocked(report).mockReset();
    vi.mocked(report).mockResolvedValue(undefined);
    open({ kind: "guest", uid: "g1" });
    await screen.findByRole("link", { name: /List a/ });
    await userEvent.click(screen.getByLabelText("More about List a"));
    await userEvent.click(cardMenu("List a").getByRole("button", { name: "Report this list" }));
    expect(screen.queryByRole("dialog", { name: /Sign in/ })).toBeNull();
    const form = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(form).getByRole("radio", { name: "Something else" }));
    await userEvent.click(within(form).getByRole("button", { name: "Report" }));
    expect(report).toHaveBeenCalledExactlyOnceWith("a", { reason: "other", note: null });
  });

  it("brings a card back with a word when its report could not be sent", async () => {
    vi.mocked(report).mockReset();
    vi.mocked(report).mockRejectedValue(new Error("offline"));
    open();
    await screen.findByRole("link", { name: /List b/ });
    await userEvent.click(screen.getByLabelText("More about List b"));
    await userEvent.click(cardMenu("List b").getByRole("button", { name: "Report this list" }));
    const form = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(form).getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(within(form).getByRole("button", { name: "Report" }));
    expect(await screen.findByText(/nothing was sent/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /List b/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // QA W43: only the list page's Done told the site; a card's report was lost silently.
  it("says on the site that a card's report did not go, once the reader has left the page", async () => {
    let refuse: (reason: unknown) => void = () => undefined;
    vi.mocked(report).mockReset();
    vi.mocked(report).mockReturnValue(
      new Promise<void>((_, reject) => {
        refuse = reject;
      }),
    );
    const router = open();
    await screen.findByRole("link", { name: /List b/ });
    await userEvent.click(screen.getByLabelText("More about List b"));
    await userEvent.click(cardMenu("List b").getByRole("button", { name: "Report this list" }));
    const form = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(form).getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(within(form).getByRole("button", { name: "Report" }));
    const receipt = await screen.findByRole("dialog", { name: "Reported, and hidden for you" });
    await userEvent.click(within(receipt).getByRole("button", { name: "Done" }));
    await act(() => router.navigate("/settings"));
    expect(await screen.findByText("Settings page")).toBeInTheDocument();
    await act(async () => refuse(new Error("offline")));
    expect(siteNotice()?.text).toMatch(/nothing was sent/);
    expect(siteNotice()?.action?.text).toBe("Try again");
  });

  it("offers no way to hide oneself", async () => {
    open({ ...member, uid: "u2" });
    await screen.findByRole("link", { name: "Edit in Settings" });
    expect(screen.queryByLabelText("More options")).toBeNull();
    // Nor one's own lists, card by card.
    await screen.findByRole("link", { name: /List a/ });
    expect(screen.queryByLabelText("More about List a")).toBeNull();
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
    // Unhide went as it was pressed; the menu that came back has the focus.
    expect(screen.getByLabelText("More options")).toHaveFocus();
  });
});
