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

/** A board with `count` cards, none ranked. */
const waiting = (uid: string, title: string, editedAt: number, count: number): Board => {
  const next = uids();
  return addToPool(
    newBoard(uid, title, editedAt, next),
    Array.from({ length: count }, (_, i) => ({ title: `c${i}`, imageUrl: null })),
    editedAt,
    next,
  );
};

/** A device that chose one board to a row. */
const rowsStore = (): KeyValueStore => {
  const store = memoryStore();
  store.write(VIEW_KEY, "rows");
  return store;
};

const open = (
  repository: BoardsRepository,
  path = "/b",
  state?: unknown,
  store: KeyValueStore = memoryStore(),
) => {
  const router = createMemoryRouter(
    [
      {
        path: "/b",
        element: <BoardsPage repository={repository} now={() => 5000} store={store} />,
      },
      { path: "/b/new", element: <h1>new board</h1> },
      { path: "/b/:uid", element: <h1>board page</h1> },
      { path: "/trash", element: <h1>trash page</h1> },
    ],
    { initialEntries: [{ pathname: path, state }] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

const opened = () => screen.getAllByRole("link", { name: /^Open / });

describe("BoardsPage", () => {
  it("starts empty with the phone's suggestions, each a new list in its section", async () => {
    const repository = boardsRepository(memoryStore());
    const router = open(repository);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your lists");
    expect(screen.getByText("No lists yet")).toBeInTheDocument();
    expect(screen.getByText("Start with")).toBeInTheDocument();
    const starts = ["Films", "Games", "Restaurants", "Albums", "Books"].map((name) =>
      screen.getByRole("link", { name }).getAttribute("href"),
    );
    expect(starts).toEqual([
      "/b/new?category=film_tv",
      "/b/new?category=games",
      "/b/new?category=food",
      "/b/new?category=music",
      "/b/new?category=books",
    ]);
    // Nothing to filter, order or summarise yet.
    expect(screen.queryByRole("group", { name: "Which lists to show" })).toBeNull();

    await userEvent.click(screen.getByRole("link", { name: "New list" }));
    expect(router.state.location.pathname).toBe("/b/new");
    expect(router.state.location.search).toBe("");
    // Nothing is kept until the board is touched; the page it opens on does that.
    expect(repository.all()).toEqual([]);
  });

  it("makes a list in the section of a suggestion", async () => {
    const router = open(boardsRepository(memoryStore()));
    await userEvent.click(screen.getByRole("link", { name: "Restaurants" }));
    expect(router.state.location.pathname).toBe("/b/new");
    expect(router.state.location.search).toBe("?category=food");
  });

  it("shows the boards as the phone's grid: a picture, the name, how far along, whether public", () => {
    const repository = boardsRepository(memoryStore());
    const next = uids();
    const pictured = addToPool(
      newBoard("pics", "Studio Ghibli", 2, next),
      ["a", "b", "c", "a"].map((name) => ({ title: name, imageUrl: `https://img/${name}.jpg` })),
      2,
      next,
    );
    repository.saveAll([
      { ...ranked("plain", "Films I make people watch", 1), publishedId: "L1" },
      pictured,
    ]);
    open(repository);
    expect(screen.getByRole("link", { name: "New list" })).toHaveAttribute("href", "/b/new");
    const tiles = opened();
    expect(tiles.map((tile) => tile.closest("li")?.className)).toEqual([
      "board-tile",
      "board-tile",
    ]);
    // Pictures from the cards, each once.
    expect(
      [...tiles[0]!.querySelectorAll(".art--mosaic img")].map((img) => img.getAttribute("src")),
    ).toEqual(["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"]);
    expect(within(tiles[0]!).getByText("4 in pool · nothing ranked yet")).toBeInTheDocument();
    expect(within(tiles[0]!).queryByText("Public")).toBeNull();
    // No pictures: the tier colours, as stripes.
    expect(tiles[1]!.querySelectorAll(".art--stripes span")).toHaveLength(5);
    expect(within(tiles[1]!).getByText("2 ranked · 1 in pool")).toBeInTheDocument();
    expect(within(tiles[1]!).getByText("Public")).toHaveClass("board-tile__public");
    expect(screen.getByRole("button", { name: "Add Studio Ghibli to favourites" })).toBeVisible();
  });

  it("switches between the grid and rows, and remembers the choice on this device", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1)]);
    const store = memoryStore();
    open(repository, "/b", undefined, store);
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".boards__grid")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Rows" }));
    expect(screen.getByRole("button", { name: "Rows" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".boards__list .board-card")).not.toBeNull();
    expect(store.read(VIEW_KEY)).toBe("rows");
  });

  it("in rows, sums the lists up and draws each with its ribbon of tiers, and leads to one", async () => {
    const repository = boardsRepository(memoryStore());
    const done = ranked("done", "All ranked", 0);
    repository.saveAll([
      waiting("old", "Ramen in Kyiv", 1, 3),
      ranked("new", "Films I make people watch", 2),
      board("gone", "Thrown away", 3, { deletedAt: 4 }),
      arrangeItems(done, [liveItems(done).map((item) => item.uid), [], [], [], []], 0),
    ]);
    const router = open(repository, "/b", undefined, rowsStore());
    expect(screen.getByText("3 lists · 5 rankings")).toBeInTheDocument();
    const links = opened();
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Films I make people watch"),
      expect.stringContaining("Ramen in Kyiv"),
      expect.stringContaining("All ranked"),
    ]);
    expect(screen.queryByText("Thrown away")).toBeNull();

    // Two ranked, one waiting: a segment for each tier with cards, the unranked last.
    const [films, ramen, all] = links;
    expect(within(films!).getByText("2 ranked · 1 in pool")).toBeInTheDocument();
    const segments = [...films!.querySelectorAll(".board-card__ribbon > span")] as HTMLElement[];
    expect(segments.map((segment) => [segment.className, segment.style.flexGrow])).toEqual([
      ["band", "1"],
      ["band", "1"],
      ["board-card__unranked", "1"],
    ]);
    // Nothing ranked: the hint instead of the ribbon.
    expect(within(ramen!).getByText("3 in pool · nothing ranked yet")).toBeInTheDocument();
    expect(within(ramen!).getByText("Start dragging to rank these")).toBeInTheDocument();
    expect(ramen!.querySelector(".board-card__ribbon")).toBeNull();
    expect(within(all!).getByText("3 ranked · nothing in pool")).toBeInTheDocument();
    expect(all!.querySelectorAll(".board-card__ribbon > span")).toHaveLength(1);

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

  it("shows all, the ones in progress, the public ones and those saved from others; the headings go while it does", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      waiting("a", "Pizza in Lisbon", 1, 2),
      { ...ranked("b", "Games of 2024", 2), publishedId: "p1", authorName: "Danylo" },
      { ...ranked("c", "Ghibli films", 3), authorName: "someone", favouritedAt: 9 },
    ]);
    open(repository);
    expect(screen.getByText("3 lists · 4 rankings · 1 public")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Favourites" })).toBeInTheDocument();
    const shows = within(screen.getByRole("group", { name: "Which lists to show" }));
    expect(shows.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "All",
      "In progress",
      "Public",
      "Saved from others",
    ]);
    expect(shows.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    const titles = () => opened().map((link) => link.getAttribute("aria-label"));

    await userEvent.click(shows.getByRole("button", { name: "In progress" }));
    expect(titles()).toEqual(["Open Ghibli films", "Open Games of 2024", "Open Pizza in Lisbon"]);
    expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();
    await userEvent.click(shows.getByRole("button", { name: "Public" }));
    expect(titles()).toEqual(["Open Games of 2024"]);
    await userEvent.click(shows.getByRole("button", { name: "Saved from others" }));
    expect(titles()).toEqual(["Open Ghibli films"]);

    await userEvent.type(screen.getByRole("searchbox", { name: "Search your lists" }), "piz");
    expect(screen.getByRole("status")).toHaveTextContent("No lists match “piz”");
    await userEvent.click(shows.getByRole("button", { name: "All" }));
    expect(titles()).toEqual(["Open Pizza in Lisbon"]);
    await userEvent.type(screen.getByRole("searchbox"), "zz");
    expect(screen.getByText("No lists match “pizzz”")).toBeInTheDocument();
  });

  it("orders the rest by the chip at the end: recent, name, most ranked, most in pool", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      waiting("a", "Albums", 1, 5),
      ranked("b", "Books", 2),
      waiting("c", "Cheeses", 3, 1),
    ]);
    open(repository);
    const titles = () => opened().map((link) => link.getAttribute("aria-label"));
    expect(titles()).toEqual(["Open Cheeses", "Open Books", "Open Albums"]);
    const order = (name: string) => screen.getByLabelText(`Order: ${name}`);
    expect(order("Recent")).toHaveTextContent("Recent");

    const pick = async (from: string, to: string) => {
      await userEvent.click(order(from));
      await userEvent.click(screen.getByRole("button", { name: to }));
    };
    await pick("Recent", "Name");
    expect(titles()).toEqual(["Open Albums", "Open Books", "Open Cheeses"]);
    await pick("Name", "Most ranked");
    expect(titles()).toEqual(["Open Books", "Open Cheeses", "Open Albums"]);
    await pick("Most ranked", "Most in pool");
    expect(titles()).toEqual(["Open Albums", "Open Cheeses", "Open Books"]);
    expect(order("Most in pool")).toBeInTheDocument();
  });

  it.each([
    ["grid", memoryStore, "button"],
    ["rows", rowsStore, "checkbox"],
  ] as const)(
    "in the %s, deletes a selection to the trash, with Undo, and leaves the mode with the last deselection",
    async (_view, store, role) => {
      const repository = boardsRepository(memoryStore());
      repository.saveAll([board("a", "Albums", 1), board("b", "Books", 2)]);
      open(repository, "/b", undefined, store());

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
      expect(screen.getByText("No lists yet")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(repository.get("a")?.deletedAt).toBeNull();
      expect(repository.get("b")?.deletedAt).toBeNull();
      expect(opened()).toHaveLength(2);
    },
  );

  it("says so when a board page sent its board to the trash, once", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1, { deletedAt: 3 }), board("b", "Books", 2)]);
    const router = open(repository, "/b", { trashed: ["a"] });
    expect(screen.getByRole("status")).toHaveTextContent("1 list deleted");
    expect(router.state.location.state).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(repository.get("a")?.deletedAt).toBeNull();
  });
});
