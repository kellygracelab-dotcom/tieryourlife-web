import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type InitialEntry } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Following } from "../api/community";
import { ApiFailure } from "../api/errors";
import type { SectionStats } from "../api/sections";
import { SessionContext, type Session } from "../app/session";
import { createSectionsStore, type SectionsDeps } from "../features/sections/useSections";
import { FollowingManagePage, type ManageDeps } from "./FollowingManagePage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());

const stats = (id: string, following: boolean): SectionStats => ({
  id,
  listCount: 1,
  followerCount: 4120,
  newThisWeek: 0,
  collage: [],
  following,
});

const following: Following = {
  authors: [{ uid: "u7", name: "kenji", photoUrl: null }],
  topics: [
    {
      id: "t1",
      name: "Pokémon",
      section: "games",
      status: "approved",
      listCount: 3,
      followerCount: 210,
      following: true,
      createdBy: "u9",
      mergedInto: null,
      pictureUrl: "https://pictures.test/pokemon.webp",
    },
    {
      id: "t2",
      name: "Speedruns",
      section: "games",
      status: "pending",
      listCount: 0,
      followerCount: 0,
      following: true,
      createdBy: "u1",
      mergedInto: null,
    },
  ],
  sections: [{ id: "food", followerCount: 4120 }],
};

const deps: ManageDeps = {
  load: vi.fn(async () => following),
  followTopic: vi.fn(async () => undefined),
  unfollowTopic: vi.fn(async () => undefined),
  followAuthor: vi.fn(async () => undefined),
  unfollowAuthor: vi.fn(async () => undefined),
};
const sectionsDeps = {
  load: vi.fn<SectionsDeps["load"]>(),
  follow: vi.fn<SectionsDeps["follow"]>(async () => ({ following: true })),
  unfollow: vi.fn<SectionsDeps["unfollow"]>(async () => ({ following: false })),
  loadOne: vi.fn<NonNullable<SectionsDeps["loadOne"]>>(),
};

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "D",
  photoUrl: null,
};

function open(
  account: Session["account"] = member,
  entries: InitialEntry[] = ["/following/manage"],
) {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const router = createMemoryRouter(
    [
      { path: "/following/manage", element: <FollowingManagePage deps={deps} store={store} /> },
      { path: "/following", element: <h1>Following tab</h1> },
      { path: "/", element: <h1>Home</h1> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  sectionsDeps.load.mockResolvedValue({
    sections: [stats("games", false), stats("food", true), stats("other", false)],
  });
});

describe("FollowingManagePage", () => {
  it("groups sections, topics and people, each with what it is and no follower counts", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Sections · 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Topics · 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People · 1" })).toBeInTheDocument();
    // A small count makes the place look empty, a big one is noise: neither is said.
    expect(screen.getByRole("link", { name: /Food/ })).toHaveTextContent(/Food$/);
    expect(
      screen.getByRole("link", { name: /Food/ }).querySelector(".manage-row__supporting"),
    ).toBeNull();
    expect(screen.getByRole("link", { name: /Pokémon/ })).toHaveTextContent(/In Games$/);
    expect(screen.queryByText(/followers?|4,120|210/)).toBeNull();
    expect(screen.getByRole("link", { name: /Speedruns/ })).toHaveTextContent("In Games · Waiting");
    // A topic with a picture of its own wears it; a waiting one shows it waits.
    expect(screen.getByRole("link", { name: /Pokémon/ }).querySelector("img")).toHaveAttribute(
      "src",
      "https://pictures.test/pokemon.webp",
    );
    expect(screen.getByRole("link", { name: /Speedruns/ }).querySelector("img")).toBeNull();
    // A waiting topic has nothing to unfollow yet.
    expect(screen.getAllByRole("button", { name: /Following/ })).toHaveLength(3);
  });

  it("unfollows at once, keeps the row with Follow, and undoes from the snackbar", async () => {
    open();
    const row = (await screen.findByRole("link", { name: /Pokémon/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    expect(deps.unfollowTopic).toHaveBeenCalledWith("t1");
    expect(within(row).getByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Unfollowed Pokémon");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(deps.followTopic).toHaveBeenCalledWith("t1");
    expect(within(row).getByRole("button", { name: /Following/ })).toBeInTheDocument();
  });

  it("says a refused unfollow is one, and keeps the row followed", async () => {
    vi.mocked(deps.unfollowAuthor).mockRejectedValueOnce(new ApiFailure({ kind: "offline" }));
    open();
    const row = (await screen.findByRole("link", { name: /kenji/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    expect(await screen.findByText("Couldn't unfollow. Try again.")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Following/ })).toBeInTheDocument();
  });

  it("keeps an unfollowed section on the page until it is left", async () => {
    open();
    const row = (await screen.findByRole("link", { name: /Food/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    expect(sectionsDeps.unfollow).toHaveBeenCalledWith("food");
    expect(screen.getByRole("link", { name: /Food/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("says when what one follows could not be read, never that it is nothing, and tries again", async () => {
    vi.mocked(deps.load).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load what you follow.");
    expect(screen.queryByText("You aren't following anything yet")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "People · 1" })).toBeInTheDocument();
  });

  it("lists a followed section the sections leave out, and unfollows it", async () => {
    sectionsDeps.loadOne.mockResolvedValue({
      ...stats("retro", true),
      name: "Retro",
      hidden: true,
    });
    vi.mocked(deps.load).mockResolvedValueOnce({
      ...following,
      sections: [
        { id: "food", followerCount: 1 },
        { id: "retro", followerCount: 1 },
      ],
    });
    open();
    expect(await screen.findByRole("heading", { name: "Sections · 2" })).toBeInTheDocument();
    const row = (await screen.findByRole("link", { name: /Retro/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    expect(sectionsDeps.unfollow).toHaveBeenCalledWith("retro");
    expect(within(row).getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("lists the sections followed from the backend's word while the sections would not load", async () => {
    sectionsDeps.load.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    open();
    expect(await screen.findByRole("heading", { name: "Sections · 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Food/ })).toHaveAttribute("href", "/s/food");
  });

  it("says a refused unfollow as one, and a refused Undo too", async () => {
    vi.mocked(deps.unfollowAuthor).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    const row = (await screen.findByRole("link", { name: /kenji/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    expect(await screen.findByText("Couldn't unfollow. Try again.")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Following/ })).toBeInTheDocument();

    vi.mocked(deps.followAuthor).mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't follow. Try again.")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("says when the ceiling of follows is reached, rather than to try again", async () => {
    sectionsDeps.follow.mockRejectedValueOnce(new ApiFailure({ kind: "tooManyFollowing" }));
    open();
    const row = (await screen.findByRole("link", { name: /Food/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    await userEvent.click(within(row).getByRole("button", { name: "Follow" }));
    expect(
      await screen.findByText(
        "You follow as many sections and topics as you can. Unfollow some first.",
      ),
    ).toBeInTheDocument();
  });

  it("goes back with its arrow when it came from the Following tab, pointing the reader's way", async () => {
    const router = open(member, [
      "/following",
      { pathname: "/following/manage", state: { fromFollowing: true } },
    ]);
    const back = await screen.findByRole("link", { name: "Navigate back" });
    expect(back.querySelector(".ms")).toHaveClass("ms--mirrored");
    await userEvent.click(back);
    expect(router.state.location.pathname).toBe("/following");
    expect(router.state.historyAction).toBe("POP");
  });

  it("is a signed-in person's only", () => {
    const router = open({ kind: "guest", uid: null });
    expect(router.state.location.pathname).toBe("/");
  });
});
