import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Following } from "../api/community";
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
};

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "D",
  photoUrl: null,
};

function open(account: Session["account"] = member) {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const router = createMemoryRouter(
    [
      { path: "/following/manage", element: <FollowingManagePage deps={deps} store={store} /> },
      { path: "/", element: <h1>Home</h1> },
    ],
    { initialEntries: ["/following/manage"] },
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

  it("keeps an unfollowed section on the page until it is left", async () => {
    open();
    const row = (await screen.findByRole("link", { name: /Food/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /Following/ }));
    expect(sectionsDeps.unfollow).toHaveBeenCalledWith("food");
    expect(screen.getByRole("link", { name: /Food/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("is a signed-in person's only", () => {
    const router = open({ kind: "guest", uid: null });
    expect(router.state.location.pathname).toBe("/");
  });
});
