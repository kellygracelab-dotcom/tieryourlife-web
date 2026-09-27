import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { MyRankings, RankingSummary } from "../api/rank";
import type { ListSummary } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { MePage } from "./MePage";

vi.mock("../lib/api", () => ({
  loadMyLists: vi.fn(),
  loadMyRankings: vi.fn(),
  removeRanking: vi.fn(),
  unpublish: vi.fn(),
}));

const load = vi.fn<() => Promise<MyRankings>>();
const loadLists = vi.fn<() => Promise<{ lists: ListSummary[] }>>();
const unpublish = vi.fn<(id: string) => Promise<void>>();
const deleteRanking = vi.fn<(code: string) => Promise<void>>();
const copy = vi.fn<(text: string) => Promise<void>>();

const ranking = (
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

const published = (id: string, title: string, extra: Partial<ListSummary> = {}): ListSummary => ({
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
  updatedAt: Date.UTC(2026, 8, 1, 12),
  takeCount: 2140,
  ...extra,
});

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const open = (
  account: Session["account"] = member,
  signIn = vi.fn(async () => ({ kind: "cancelled" as const })),
) => {
  const router = createMemoryRouter(
    [
      {
        path: "/me",
        element: (
          <MePage
            load={load}
            loadLists={loadLists}
            unpublish={unpublish}
            deleteRanking={deleteRanking}
            copy={copy}
          />
        ),
      },
      { path: "*", element: <h1>Elsewhere</h1> },
    ],
    { initialEntries: ["/me"] },
  );
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return signIn;
};

// The rows themselves: a row's menu has list items of its own.
const rows = () => [
  ...screen.getByRole("list", { name: "My lists" }).querySelectorAll<HTMLElement>(":scope > li"),
];
const rowOf = (title: RegExp) =>
  screen.getByRole("link", { name: title }).closest<HTMLElement>("li.mine")!;
const menuOf = async (title: string) => {
  await userEvent.click(screen.getByLabelText(`More about ${title}`));
  return within(screen.getByLabelText(`More about ${title}`).closest("details")!);
};

beforeEach(() => {
  load.mockReset();
  loadLists.mockReset();
  unpublish.mockReset();
  deleteRanking.mockReset();
  copy.mockReset();
  copy.mockResolvedValue(undefined);
});

describe("MePage", () => {
  it("asks a guest to sign in, and asks nothing of the network", async () => {
    const signIn = open({ kind: "guest", uid: "g1" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My lists");
    expect(screen.getByText(/Sign in to see the rankings you keep/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(loadLists).not.toHaveBeenCalled();
  });

  it("holds the published lists and the kept rankings in one list, newest first, and names no author", async () => {
    load.mockResolvedValue({
      rankings: [
        ranking("aaaaaaaa", "Every A24 film, ranked"),
        ranking("bbbbbbbb", "Ghibli, ranked", { createdAt: Date.UTC(2026, 7, 2, 12), placed: 3 }),
      ],
      more: false,
    });
    loadLists.mockResolvedValue({ lists: [published("l1", "Oscar films 2025")] });
    open();

    expect(await screen.findByText("1 published · 2 ranked")).toBeInTheDocument();
    expect(rows().map((row) => row.querySelector(".mine__title")?.textContent)).toEqual([
      "Every A24 film, ranked",
      "Oscar films 2025",
      "Ghibli, ranked",
    ]);

    const kept = rowOf(/Every A24 film, ranked/);
    expect(within(kept).getByRole("link", { name: /Every A24 film/ })).toHaveAttribute(
      "href",
      "/r/aaaaaaaa",
    );
    expect(kept).toHaveTextContent("7 of 10 placed · Sep 12, 2026");
    expect(kept).not.toHaveTextContent("danylo");
    expect(within(kept).getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/r/aaaaaaaa?edit",
    );

    const list = rowOf(/Oscar films 2025/);
    expect(within(list).getByRole("link", { name: /Oscar films 2025/ })).toHaveAttribute(
      "href",
      "/l/l1",
    );
    expect(list).toHaveTextContent("Published · 34 cards · 2,140 rankings");
    expect(within(list).getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/l/l1");
    // Few enough to see at once: no chips to choose between the kinds.
    expect(screen.queryByRole("group", { name: "Which to show" })).toBeNull();
  });

  it("offers a ranking to be published as a list of one's own, and a list only to be unpublished", async () => {
    load.mockResolvedValue({ rankings: [ranking("aaaaaaaa", "Ghibli, ranked")], more: false });
    loadLists.mockResolvedValue({ lists: [published("l1", "Oscar films 2025")] });
    open();
    await screen.findByText("1 published · 1 ranked");

    const kept = await menuOf("Ghibli, ranked");
    expect(kept.getByRole("link", { name: "Publish as my list" })).toHaveAttribute(
      "href",
      "/new?ranking=aaaaaaaa",
    );
    expect(kept.getByRole("button", { name: "Delete ranking" })).toBeInTheDocument();
    await userEvent.click(kept.getByRole("button", { name: "Copy link" }));
    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/r/aaaaaaaa`);
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");

    const list = await menuOf("Oscar films 2025");
    expect(list.queryByRole("link", { name: "Publish as my list" })).toBeNull();
    expect(list.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  });

  it("deletes a ranking after asking in its row, and says so", async () => {
    load.mockResolvedValue({
      rankings: [ranking("aaaaaaaa", "Ghibli, ranked"), ranking("bbbbbbbb", "Pixar, ranked")],
      more: false,
    });
    loadLists.mockResolvedValue({ lists: [] });
    deleteRanking.mockResolvedValue(undefined);
    open();
    expect(await screen.findByText("2 ranked")).toBeInTheDocument();

    await userEvent.click(
      (await menuOf("Ghibli, ranked")).getByRole("button", { name: "Delete ranking" }),
    );
    const ask = screen.getByRole("group", { name: "Delete ranking" });
    expect(ask).toHaveTextContent("Delete this ranking? Its link stops working.");
    await userEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", { name: "Delete ranking" })).toBeNull();
    expect(deleteRanking).not.toHaveBeenCalled();

    await userEvent.click(
      (await menuOf("Ghibli, ranked")).getByRole("button", { name: "Delete ranking" }),
    );
    await userEvent.click(
      within(screen.getByRole("group", { name: "Delete ranking" })).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(deleteRanking).toHaveBeenCalledWith("aaaaaaaa");
    expect(await screen.findByRole("status")).toHaveTextContent("Ranking deleted");
    await waitFor(() => expect(screen.queryByRole("link", { name: /Ghibli/ })).toBeNull());
    expect(screen.getByText("1 ranked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pixar/ })).toBeInTheDocument();
    expect(unpublish).not.toHaveBeenCalled();
  });

  it("unpublishes a list after asking, names a failure and keeps the row; one already gone counts as done", async () => {
    load.mockResolvedValue({ rankings: [], more: false });
    loadLists.mockResolvedValue({ lists: [published("l1", "One"), published("l2", "Two")] });
    unpublish
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" }));
    open();
    await screen.findByText("2 published");

    await userEvent.click((await menuOf("One")).getByRole("button", { name: "Unpublish" }));
    const ask = screen.getByRole("group", { name: "Unpublish" });
    expect(ask).toHaveTextContent("Unpublish “One”?");
    await userEvent.click(within(ask).getByRole("button", { name: "Unpublish" }));
    expect(unpublish).toHaveBeenCalledWith("l1");
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    await userEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("link", { name: /One/ })).toBeInTheDocument();

    await userEvent.click((await menuOf("Two")).getByRole("button", { name: "Unpublish" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Unpublish" })).getByRole("button", {
        name: "Unpublish",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Unpublished");
    await waitFor(() => expect(screen.queryByRole("link", { name: /Two/ })).toBeNull());
    expect(screen.getByText("1 published")).toBeInTheDocument();
  });

  it("gives chips to choose between the kinds once there is a lot of both", async () => {
    load.mockResolvedValue({
      rankings: Array.from({ length: 6 }, (_, i) => ranking(`aaaaaaa${i}`, `Ranking ${i}`)),
      more: true,
    });
    loadLists.mockResolvedValue({
      lists: Array.from({ length: 3 }, (_, i) => published(`l${i}`, `List ${i}`)),
    });
    open();
    await screen.findByText("3 published · 6 ranked");
    const chips = within(screen.getByRole("group", { name: "Which to show" }));
    expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(rows()).toHaveLength(9);

    await userEvent.click(chips.getByRole("button", { name: "Published" }));
    expect(rows()).toHaveLength(3);
    await userEvent.click(chips.getByRole("button", { name: "Rankings" }));
    expect(rows()).toHaveLength(6);
    expect(screen.getByText("Only the newest 6 are shown.")).toBeInTheDocument();
  });

  it("says so when there is nothing yet, and leads to the lists", async () => {
    load.mockResolvedValue({ rankings: [], more: false });
    loadLists.mockResolvedValue({ lists: [] });
    open();
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    expect(
      screen.getByText("Lists you publish and rankings you keep show up here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse lists" })).toHaveAttribute("href", "/");
  });

  it("names a failure to load, and tries again", async () => {
    load.mockResolvedValue({ rankings: [ranking("aaaaaaaa", "Ghibli, ranked")], more: false });
    loadLists.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    loadLists.mockResolvedValueOnce({ lists: [] });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your lists.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1 ranked")).toBeInTheDocument();
  });

  it("stands beside the settings under the account", () => {
    load.mockReturnValue(new Promise(() => undefined));
    loadLists.mockReturnValue(new Promise(() => undefined));
    open();
    const tabs = within(screen.getByRole("navigation", { name: "Your account" }));
    expect(tabs.getAllByRole("link")).toHaveLength(2);
    expect(tabs.getByRole("link", { name: "My lists" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByLabelText("My lists", { selector: "div" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
