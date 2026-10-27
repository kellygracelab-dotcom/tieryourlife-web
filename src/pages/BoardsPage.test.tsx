import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { addToPool, arrangeItems, liveItems, newBoard, type Board } from "../features/boards/model";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import { memoryStore, type KeyValueStore } from "../lib/storage";
import { BoardsPage, VIEW_KEY } from "./BoardsPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());
vi.mock("../lib/pictures", () => ({ uploadPicture: vi.fn() }));

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const board = (
  uid: string,
  title: string,
  editedAt: number,
  extra: Partial<Board> = {},
): Board => ({
  ...newBoard(uid, title, editedAt, uids()),
  ...extra,
});

/** A board with three cards, two of them ranked. */
const ranked = (uid: string, title: string, editedAt: number): Board => {
  const next = uids();
  const b = addToPool(
    newBoard(uid, title, editedAt, next),
    ["a", "b", "c"].map((name) => ({ title: name, imageUrl: null })),
    editedAt,
    next,
  );
  const [ia, ib] = liveItems(b).map((item) => item.uid);
  return arrangeItems(b, [[ia!], [ib!], [], [], []], editedAt);
};

/** A device that chose one board to a row. */
const rowsStore = (): KeyValueStore => {
  const store = memoryStore();
  store.write(VIEW_KEY, "rows");
  return store;
};

const open = (
  repository: BoardsRepository,
  path = "/boards",
  state?: unknown,
  store: KeyValueStore = memoryStore(),
) => {
  const router = createMemoryRouter(
    [
      {
        path: "/boards",
        element: <BoardsPage repository={repository} now={() => 5000} store={store} />,
      },
      { path: "/b/:uid", element: <h1>board page</h1> },
      { path: "/trash", element: <h1>trash page</h1> },
    ],
    { initialEntries: [{ pathname: path, state }] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

describe("BoardsPage", () => {
  it("starts empty, and New board makes one and opens it", async () => {
    const repository = boardsRepository(memoryStore());
    const router = open(repository);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your boards");
    expect(screen.getByText("Rank anything")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "New board" })[0]!);
    // Nothing is kept until the board is touched; the page it opens on does that.
    expect(repository.all()).toEqual([]);
    expect(router.state.location.pathname).toMatch(/^\/b\/[0-9a-f-]{36}$/);
    expect(router.state.location.search).toBe("?new=5000");
  });

  it("shows the boards as the phone's grid: a picture, the name, how many are ranked", () => {
    const repository = boardsRepository(memoryStore());
    const next = uids();
    const pictured = addToPool(
      newBoard("pics", "Studio Ghibli", 2, next),
      ["a", "b", "c", "a"].map((name) => ({ title: name, imageUrl: `https://img/${name}.jpg` })),
      2,
      next,
    );
    repository.saveAll([ranked("plain", "Films I make people watch", 1), pictured]);
    open(repository);
    const tiles = screen.getAllByRole("link", { name: /^Open / });
    expect(tiles.map((tile) => tile.closest("li")?.className)).toEqual([
      "board-tile",
      "board-tile",
    ]);
    // Pictures from the cards, each once.
    expect(
      [...tiles[0]!.querySelectorAll(".art--mosaic img")].map((img) => img.getAttribute("src")),
    ).toEqual(["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"]);
    expect(within(tiles[0]!).getByText("0 ranked")).toBeInTheDocument();
    // No pictures: the tier colours, as stripes.
    expect(tiles[1]!.querySelectorAll(".art--stripes span")).toHaveLength(5);
    expect(within(tiles[1]!).getByText("2 ranked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Studio Ghibli to favourites" })).toBeVisible();
  });

  it("switches between the grid and rows, and remembers the choice on this device", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1)]);
    const store = memoryStore();
    open(repository, "/boards", undefined, store);
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".boards__grid")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Rows" }));
    expect(screen.getByRole("button", { name: "Rows" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".boards__list .board-card")).not.toBeNull();
    expect(store.read(VIEW_KEY)).toBe("rows");
  });

  it("in rows, lists the boards newest first with how far along each is, and leads to one", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("old", "Ramen in Kyiv", 1),
      ranked("new", "Films I make people watch", 2),
      board("gone", "Thrown away", 3, { deletedAt: 4 }),
    ]);
    const router = open(repository, "/boards", undefined, rowsStore());
    expect(screen.getByText("2 boards · private")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /^Open / });
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Films I make people watch"),
      expect.stringContaining("Ramen in Kyiv"),
    ]);
    expect(screen.getByText("2 ranked · 1 in pool")).toBeInTheDocument();
    expect(screen.getByText("0 in pool · nothing ranked yet")).toBeInTheDocument();
    expect(screen.queryByText("Thrown away")).toBeNull();

    await userEvent.click(screen.getByRole("link", { name: "Open Ramen in Kyiv" }));
    expect(router.state.location.pathname).toBe("/b/old");
  });

  it("stars a board to the top under its own heading, and unstars it", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1), board("b", "Books", 2)]);
    open(repository);
    expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Add Albums to favourites" }));
    expect(repository.get("a")?.favouritedAt).toBe(5000);
    const favourites = screen.getByRole("region", { name: "Favourites" });
    expect(within(favourites).getByText("Albums")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "All boards" })).getByText("Books"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Albums from favourites" }));
    expect(repository.get("a")?.favouritedAt).toBeNull();
    expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();
  });

  it("narrows by a word, a category and whether a board is public; the headings go while it does", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("a", "Pizza in Lisbon", 1, { favouritedAt: 9, category: "food" }),
      board("b", "Games of 2024", 2, { category: "games", publishedId: "p1" }),
      board("c", "Books", 3),
    ]);
    open(repository);
    expect(screen.getByText("3 boards · 1 public")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Favourites" })).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search your boards" }), "piz");
    expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();
    await userEvent.type(screen.getByRole("searchbox"), "zz");
    expect(screen.getByText("No lists match “pizzz”")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(3);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Category" }), "games");
    expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Private" }));
    expect(screen.queryAllByRole("link", { name: /^Open / })).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Public" }));
    expect(screen.getByRole("link", { name: "Open Games of 2024" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Oldest" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    // Starred first whatever the order; then the rest, oldest first.
    expect(screen.getAllByRole("link", { name: /^Open / }).map((l) => l.textContent)).toEqual([
      expect.stringContaining("Pizza in Lisbon"),
      expect.stringContaining("Games of 2024"),
      expect.stringContaining("Books"),
    ]);
  });

  it.each([
    ["grid", memoryStore, "button"],
    ["rows", rowsStore, "checkbox"],
  ] as const)(
    "in the %s, deletes a selection to the trash, with Undo, and leaves the mode with the last deselection",
    async (_view, store, role) => {
      const repository = boardsRepository(memoryStore());
      repository.saveAll([board("a", "Albums", 1), board("b", "Books", 2)]);
      open(repository, "/boards", undefined, store());

      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("toolbar")).toHaveTextContent("0 selected");
      await userEvent.click(screen.getByRole(role, { name: "Select Albums" }));
      expect(screen.getByRole("toolbar")).toHaveTextContent("1 selected");
      await userEvent.click(screen.getByRole(role, { name: "Select Albums" }));
      expect(screen.queryByRole("toolbar")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(screen.getByRole(role, { name: "Select Albums" }));
      await userEvent.click(screen.getByRole(role, { name: "Select Books" }));
      await userEvent.click(
        within(screen.getByRole("toolbar")).getByRole("button", { name: "Delete" }),
      );
      expect(repository.get("a")?.deletedAt).toBe(5000);
      expect(repository.get("b")?.deletedAt).toBe(5000);
      expect(screen.getByRole("status")).toHaveTextContent("2 lists deleted");
      expect(screen.getByText("Rank anything")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(repository.get("a")?.deletedAt).toBeNull();
      expect(repository.get("b")?.deletedAt).toBeNull();
      expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(2);
    },
  );

  it("says so when a board page sent its board to the trash, once", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1, { deletedAt: 3 }), board("b", "Books", 2)]);
    const router = open(repository, "/boards", { trashed: ["a"] });
    expect(screen.getByRole("status")).toHaveTextContent("1 list deleted");
    expect(router.state.location.state).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(repository.get("a")?.deletedAt).toBeNull();
  });
});
