import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { addToPool, arrangeItems, liveItems, newBoard, type Board } from "../features/boards/model";
import { DEFAULT_TIERS, NEW_DRAFT_KEY, saveEditorDraft } from "../features/editor/model";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import { ApiFailure } from "../api/errors";
import { memoryStore, type KeyValueStore } from "../lib/storage";
import { BoardsPage, VIEW_KEY, type LoadReadyList } from "./BoardsPage";
import { startedChanged } from "../features/started/started";
import type { ListSummary } from "../api/types";

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
  unpublish: (id: string) => Promise<void> = async () => undefined,
  shelfStore: KeyValueStore = memoryStore(),
  // The tools are under test: they show from the first list. Few lists' page has tests of its own.
  fewLists = 0,
  loadReady: LoadReadyList = async () => null,
) => {
  const router = createMemoryRouter(
    [
      {
        path: "/b",
        element: (
          <BoardsPage
            repository={repository}
            now={() => 5000}
            store={store}
            shelfStore={shelfStore}
            unpublish={unpublish}
            fewLists={fewLists}
            loadReady={loadReady}
          />
        ),
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

/** A list's "4 cards · nothing placed yet", drawn in two pieces that keep together. */
const caption = (text: string) => (_: string, node: Element | null) =>
  node !== null && node.id.endsWith("-meta") && node.textContent === text;

describe("New here? on an empty Your lists", () => {
  const eurovision = {
    id: "euro",
    title: "Eurovision winners since 2000",
    authorUid: "h",
    authorName: "TierYourLife",
    authorPhotoUrl: null,
    category: "music",
    itemCount: 25,
    coverImageUrl: null,
    previewImages: [],
    tierColors: [],
    updatedAt: 0,
    takeCount: 900,
  } as ListSummary;

  it("offers a popular list to try at once, by its name and its cards", async () => {
    const repository = boardsRepository(memoryStore());
    open(
      repository,
      "/b",
      undefined,
      memoryStore(),
      undefined,
      memoryStore(),
      0,
      async () => eurovision,
    );
    expect(await screen.findByText("New here?")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Eurovision winners since 2000" }),
    ).toBeInTheDocument();
    expect(screen.getByText("A ready list · 25 cards")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try it" })).toHaveAttribute("href", "/l/euro");
    expect(screen.getByText("No lists yet")).toBeInTheDocument();
  });

  // Continue above shows the list begun: "No lists yet" under it said the
  // page had nothing (walkthrough item 8, Danylo, 25.11).
  it("is not there once one has a list begun, and nor is No lists yet under Continue", async () => {
    const begun = memoryStore();
    begun.write(
      "tyl:draft:other",
      JSON.stringify({ listId: "other", title: "Pizza", rows: [[0]], itemCount: 5 }),
    );
    const load = vi.fn(async () => eurovision);
    open(
      boardsRepository(memoryStore()),
      "/b",
      undefined,
      begun,
      undefined,
      memoryStore(),
      0,
      load,
    );
    expect(await screen.findByRole("heading", { name: "Continue · 1" })).toBeInTheDocument();
    expect(screen.queryByText("No lists yet")).toBeNull();
    expect(screen.getByText("Start with")).toBeInTheDocument();
    expect(screen.queryByText("New here?")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("says No lists yet again once the list begun is discarded", async () => {
    const begun = memoryStore();
    begun.write(
      "tyl:draft:other",
      JSON.stringify({ listId: "other", title: "Pizza", rows: [[0]], itemCount: 5 }),
    );
    open(boardsRepository(memoryStore()), "/b", undefined, begun);
    expect(await screen.findByRole("heading", { name: "Continue · 1" })).toBeInTheDocument();
    expect(screen.queryByText("No lists yet")).toBeNull();
    act(() => {
      begun.remove("tyl:draft:other");
      startedChanged(true);
    });
    expect(await screen.findByText("No lists yet")).toBeInTheDocument();
  });
});

// On a phone New list is the round button at the corner alone, and the line
// promising tools to come is gone (walkthrough items 8 and 10, Danylo, 25.11).
describe("Your lists on a phone", () => {
  const phone = (query: string) =>
    ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;

  it("has no New list tile and no line about the tools with a few lists", () => {
    vi.stubGlobal("matchMedia", phone);
    try {
      const repository = boardsRepository(memoryStore());
      repository.saveAll([ranked("a", "Albums", 1)]);
      open(repository, "/b", undefined, memoryStore(), undefined, memoryStore(), 6);
      expect(opened()).toHaveLength(1);
      expect(screen.queryByRole("link", { name: "New list" })).toBeNull();
      expect(screen.queryByText(/appear here when you have more than six lists/)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("starts empty with the suggestions and no New list of its own", () => {
    vi.stubGlobal("matchMedia", phone);
    try {
      open(boardsRepository(memoryStore()));
      expect(screen.getByText("No lists yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Films" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "New list" })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("BoardsPage", () => {
  it("is the lists and a new one's tile while there are six or fewer, the tools from the seventh (artboard 33)", async () => {
    const repository = boardsRepository(memoryStore());
    const lists = Array.from({ length: 6 }, (_, at) => ranked(`b${at}`, `List ${at}`, 1));
    repository.saveAll(lists);
    const router = createMemoryRouter(
      [
        {
          path: "/b",
          element: (
            <BoardsPage
              repository={repository}
              now={() => 5000}
              store={memoryStore()}
              shelfStore={memoryStore()}
            />
          ),
        },
        { path: "/b/new", element: <h1>new board</h1> },
      ],
      { initialEntries: ["/b"] },
    );
    render(<RouterProvider router={router} />);
    expect(opened()).toHaveLength(6);
    expect(screen.queryByRole("searchbox", { name: "Search your lists" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Which lists to show" })).toBeNull();
    expect(
      screen.getByText(
        "Search, filters and sorting appear here when you have more than six lists.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New list" })).toHaveAttribute("href", "/b/new");

    act(() => repository.save(ranked("b6", "List 6", 1)));
    expect(await screen.findByRole("searchbox", { name: "Search your lists" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New list" })).toBeNull();
    expect(screen.queryByText(/appear here when you have more than six lists/)).toBeNull();
  });

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
      "/b/new?title=Films&category=film_tv",
      "/b/new?title=Games&category=games",
      "/b/new?title=Restaurants&category=food",
      "/b/new?title=Albums&category=music",
      "/b/new?title=Books&category=books",
    ]);
    // Nothing to filter, order or summarise yet.
    expect(screen.queryByRole("group", { name: "Which lists to show" })).toBeNull();

    await userEvent.click(screen.getByRole("link", { name: "New list" }));
    expect(router.state.location.pathname).toBe("/b/new");
    expect(router.state.location.search).toBe("");
    // Nothing is kept until the board is touched; the page it opens on does that.
    expect(repository.all()).toEqual([]);
  });

  it("makes a list of a suggestion's name in its section", async () => {
    const router = open(boardsRepository(memoryStore()));
    await userEvent.click(screen.getByRole("link", { name: "Restaurants" }));
    expect(router.state.location.pathname).toBe("/b/new");
    expect(router.state.location.search).toBe("?title=Restaurants&category=food");
  });

  it("puts a list begun in the old editor on the shelf, with the others", () => {
    const store = memoryStore();
    saveEditorDraft(store, {
      title: "My old draft",
      category: null,
      tiers: DEFAULT_TIERS.map((tier, index) => ({ ...tier, key: `t${index}` })),
      items: [{ key: "p0", title: "Ex Machina", imageUrl: null, pictureId: null }],
      rows: [[], [], [], [], []],
      serial: DEFAULT_TIERS.length + 1,
    });
    const repository = boardsRepository(memoryStore());
    open(repository, "/b", undefined, store);
    expect(opened().map((link) => link.getAttribute("aria-label"))).toEqual(["Open My old draft"]);
    expect(store.read(NEW_DRAFT_KEY)).toBeNull();
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
    // A new list is the site header's, and the tile's on a page of few lists.
    expect(screen.queryByRole("link", { name: "New list" })).toBeNull();
    const tiles = opened();
    expect(tiles.map((tile) => tile.closest("li")?.className)).toEqual([
      "board-tile",
      "board-tile",
    ]);
    // Pictures from the cards, each once.
    expect(
      [...tiles[0]!.querySelectorAll(".art--mosaic img")].map((img) => img.getAttribute("src")),
    ).toEqual(["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"]);
    expect(
      within(tiles[0]!).getByText(caption("4 cards · nothing placed yet")),
    ).toBeInTheDocument();
    expect(within(tiles[0]!).queryByText("Public")).toBeNull();
    // No pictures: the tier colours, as stripes.
    expect(tiles[1]!.querySelectorAll(".art--stripes span")).toHaveLength(5);
    expect(within(tiles[1]!).getByText(caption("3 cards · 2 placed"))).toBeInTheDocument();
    // Artboard 42: Public as a label before the count, read after the name.
    expect(within(tiles[1]!).getByText("Public")).toHaveClass("list-label", "board-tile__label");
    expect(tiles[1]).toHaveAccessibleDescription("Public 3 cards · 2 placed");
    expect(tiles[0]).toHaveAccessibleDescription("4 cards · nothing placed yet");
    // The star of a list that is no favourite waits for a pointer or the keyboard.
    const star = screen.getByRole("button", { name: "Add Studio Ghibli to favourites" });
    expect(star).toHaveClass("board-tile__star");
    expect(star).not.toHaveClass("board-tile__star--on");
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
    expect(document.querySelector(".boards__count")).toHaveTextContent(/^3 lists$/);
    const links = opened();
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Films I make people watch"),
      expect.stringContaining("Ramen in Kyiv"),
      expect.stringContaining("All ranked"),
    ]);
    expect(screen.queryByText("Thrown away")).toBeNull();

    // Two ranked, one waiting: a segment for each tier with cards, the unranked last.
    const [films, ramen, all] = links;
    expect(within(films!).getByText(caption("3 cards · 2 placed"))).toBeInTheDocument();
    const segments = [...films!.querySelectorAll(".board-card__ribbon > span")] as HTMLElement[];
    expect(segments.map((segment) => [segment.className, segment.style.flexGrow])).toEqual([
      ["band", "1"],
      ["band", "1"],
      ["board-card__unranked", "1"],
    ]);
    // Nothing ranked: the hint instead of the ribbon.
    expect(within(ramen!).getByText(caption("3 cards · nothing placed yet"))).toBeInTheDocument();
    expect(within(ramen!).getByText("Start dragging to rank these")).toBeInTheDocument();
    expect(ramen!.querySelector(".board-card__ribbon")).toBeNull();
    expect(within(all!).getByText(caption("3 cards · 3 placed"))).toBeInTheDocument();
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
      within(screen.getByRole("region", { name: "All lists" })).getByText("Books"),
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
    // Only how many lists under the title (artboard 42); Public and Saved are on the lists.
    expect(document.querySelector(".boards__count")).toHaveTextContent(/^3 lists$/);
    const label = (name: string) =>
      screen.getByRole("link", { name: `Open ${name}` }).querySelector(".list-label")?.textContent;
    expect(label("Pizza in Lisbon")).toBeUndefined();
    expect(label("Games of 2024")).toBe("Public");
    expect(label("Ghibli films")).toBe("Saved");
    expect(screen.getByRole("button", { name: "Remove Ghibli films from favourites" })).toHaveClass(
      "board-tile__star--on",
    );
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
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("No lists match “piz”");
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
    await pick("Name", "Most placed");
    expect(titles()).toEqual(["Open Books", "Open Cheeses", "Open Albums"]);
    await pick("Most placed", "Most left to place");
    expect(titles()).toEqual(["Open Albums", "Open Cheeses", "Open Books"]);
    expect(order("Most left to place")).toBeInTheDocument();
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

      await userEvent.click(screen.getByRole("button", { name: "Select" }));
      expect(screen.getByRole("group", { name: "Choose the lists to delete" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole(role, { name: "Select Albums" }));
      expect(screen.getByRole("group", { name: "1 selected" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole(role, { name: "Select Albums" }));
      expect(screen.queryByRole("group", { name: "1 selected" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Select" }));
      await userEvent.click(screen.getByRole(role, { name: "Select Albums" }));
      await userEvent.click(screen.getByRole(role, { name: "Select Books" }));
      await userEvent.click(
        within(screen.getByRole("group", { name: /selected$/ })).getByRole("button", {
          name: "Delete",
        }),
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

  it("keeps the keyboard's place as choosing starts, ends, and deletes", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1), board("b", "Books", 2)]);
    open(repository, "/b");

    // The chip goes as it is pressed: the first list to choose takes the focus.
    screen.getByRole("button", { name: "Select" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Select Books" })).toHaveFocus();

    // Leaving gives the focus back to the chip that came back.
    await userEvent.click(screen.getByRole("button", { name: "Exit selection" }));
    expect(screen.getByRole("button", { name: "Select" })).toHaveFocus();

    // Deleting takes the bar away; its Undo is where the keyboard lands.
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      within(screen.getByRole("group", { name: /selected$/ })).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByRole("button", { name: "Undo" })).toHaveFocus();
  });

  it("takes the public copies down before the trash, and keeps a board whose copy stays up", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("a", "Albums", 1, { publishedId: "up", authorName: "Danylo" }),
      board("b", "Books", 2, { publishedId: "stuck", authorName: "Danylo" }),
      board("c", "Cheeses", 3),
    ]);
    const unpublish = vi.fn(async (id: string) => {
      if (id === "stuck") throw new Error("offline");
    });
    open(repository, "/b", undefined, memoryStore(), unpublish);

    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    for (const name of ["Albums", "Books", "Cheeses"]) {
      await userEvent.click(screen.getByRole("button", { name: `Select ${name}` }));
    }
    await userEvent.click(
      within(screen.getByRole("group", { name: /selected$/ })).getByRole("button", {
        name: "Delete",
      }),
    );
    // The two that went are said first, with their Undo; then why the third stayed.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 lists deleted and their public copies taken down",
    );
    expect(unpublish.mock.calls.map(([id]) => id).sort()).toEqual(["stuck", "up"]);
    expect(repository.get("a")).toMatchObject({ deletedAt: 5000, publishedId: null });
    expect(repository.get("b")).toMatchObject({ deletedAt: null, publishedId: "stuck" });
    expect(repository.get("c")?.deletedAt).toBe(5000);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(repository.get("c")?.deletedAt).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Kept, not deleted");
  });

  it("tells a conflict's copy from its original in the grid, to the eye and to a screen reader", () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("a", "Albums", 2),
      board("b", "Albums", 1, { arrivedFrom: "Pixel 7" }),
    ]);
    open(repository);
    expect(opened().map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Albums",
      "Open Albums, from Pixel 7",
    ]);
    expect(opened()[1]).toHaveTextContent("from Pixel 7");
    expect(
      screen.getByRole("button", { name: "Add Albums, from Pixel 7 to favourites" }),
    ).toBeInTheDocument();
  });

  it("lets a list go whose public copy another account published, and leaves that copy alone", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1, { publishedId: "theirs", authorName: "Danylo" })]);
    const unpublish = vi.fn(async () => {
      throw new ApiFailure({ kind: "notYours" });
    });
    open(repository, "/b", undefined, memoryStore(), unpublish);

    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Albums" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: /selected$/ })).getByRole("button", {
        name: "Delete",
      }),
    );
    // Nothing of this account's came down, so nothing is said about a copy.
    const said = within(await screen.findByRole("status")).getByText(/list deleted/);
    expect(said).toHaveTextContent(/^1 list deleted$/);
    expect(repository.get("a")).toMatchObject({ deletedAt: 5000, publishedId: null });
  });

  it("deletes only the chosen lists still on screen, and says so in the bar", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("a", "Alpha", 3),
      board("b", "Bravo", 2, { publishedId: "L1", authorName: "Danylo" }),
    ]);
    open(repository);
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Alpha" }));
    await userEvent.click(screen.getByRole("button", { name: "Public" }));
    expect(screen.getByRole("group", { name: "Choose the lists to delete" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Select Bravo" }));
    expect(screen.getByRole("group", { name: "1 selected" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("group", { name: /selected$|^Choose the lists/ })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );
    await screen.findByRole("button", { name: "Undo" });
    expect(repository.get("a")?.deletedAt).toBeNull();
    expect(repository.get("b")?.deletedAt).toBe(5000);
  });

  it("leaves choosing on Escape", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1)]);
    open(repository);
    const chip = screen.getByRole("button", { name: "Select" });
    expect(chip).not.toHaveAttribute("aria-pressed");
    await userEvent.click(chip);
    expect(screen.getByRole("group", { name: /selected$|^Choose the lists/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /selected$|^Choose the lists/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Select" })).toHaveFocus();
  });

  it("takes a list off the shelf while its public copy comes down, so it cannot go twice", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("a", "Albums", 1, { publishedId: "L1", authorName: "Danylo" }),
      board("b", "Books", 2),
    ]);
    let done = () => undefined as void;
    const unpublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    open(repository, "/b", undefined, memoryStore(), unpublish);
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Albums" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: /selected$|^Choose the lists/ })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );
    expect(screen.queryByRole("link", { name: "Open Albums" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Books" })).toBeInTheDocument();
    done();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 list deleted and its public copy taken down",
    );
    expect(unpublish).toHaveBeenCalledTimes(1);
    expect(repository.get("a")?.deletedAt).toBe(5000);
  });

  it("names the filter that shows nothing, rather than saying there are no lists", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1)]);
    open(repository);
    await userEvent.click(screen.getByRole("button", { name: "Public" }));
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("No lists under “Public”");
    expect(screen.queryByText("No lists yet")).toBeNull();
  });

  it("says in rows too that a list is public, and reads how far along it is after its name", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([{ ...ranked("a", "Albums", 1), publishedId: "L1" }]);
    open(repository, "/b", undefined, rowsStore());
    const link = screen.getByRole("link", { name: "Open Albums" });
    expect(within(link).getByText("Public")).toHaveClass("list-label", "board-card__label");
    expect(link).toHaveAccessibleDescription("Public 3 cards · 2 placed");
  });

  it("says in rows that a list was saved from somebody else, before its count", () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([{ ...ranked("a", "Albums", 1), authorName: "someone" }]);
    open(repository, "/b", undefined, rowsStore());
    const link = screen.getByRole("link", { name: "Open Albums" });
    expect(within(link).getByText("Saved")).toHaveClass("list-label", "board-card__label");
    expect(link).toHaveAccessibleDescription("Saved 3 cards · 2 placed");
    const star = screen.getByRole("button", { name: "Add Albums to favourites" });
    expect(star).not.toHaveClass("board-card__star--on");
  });

  it("offers a guest the sign-in that keeps lists living only in this browser", () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([board("a", "Albums", 1)]);
    open(repository);
    expect(screen.getByText("1 list, on this device only")).toBeInTheDocument();
    expect(screen.getByText(/An account keeps them/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("puts lists back where they were in Recent after Undo", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      board("a", "Alpha", 3),
      board("b", "Bravo", 2),
      board("c", "Charlie", 1, { publishedId: "L1", authorName: "Danylo" }),
    ]);
    open(repository);
    const titles = () => opened().map((link) => link.getAttribute("aria-label"));
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    for (const name of ["Alpha", "Bravo", "Charlie"]) {
      await userEvent.click(screen.getByRole("button", { name: `Select ${name}` }));
    }
    await userEvent.click(
      within(screen.getByRole("group", { name: /selected$/ })).getByRole("button", {
        name: "Delete",
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(titles()).toEqual(["Open Alpha", "Open Bravo", "Open Charlie"]);
  });

  it("finds the search, the filter and the order again on the way back from a list", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      waiting("a", "Pizza place", 1, 2),
      ranked("b", "Pizza ranked", 2),
      waiting("c", "Ramen place", 3, 1),
    ]);
    const shelf = memoryStore();
    const router = open(repository, "/b", undefined, memoryStore(), undefined, shelf);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search your lists" }), "pizza");
    await userEvent.click(screen.getByRole("button", { name: "In progress" }));
    await userEvent.click(screen.getByLabelText("Order: Recent"));
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    await userEvent.click(screen.getByRole("link", { name: "Open Pizza place" }));
    expect(router.state.location.pathname).toBe("/b/a");

    await router.navigate(-1);
    expect(await screen.findByRole("searchbox", { name: "Search your lists" })).toHaveValue(
      "pizza",
    );
    expect(screen.getByRole("button", { name: "In progress" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Order: Name")).toBeInTheDocument();
    expect(opened().map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Pizza place",
      "Open Pizza ranked",
    ]);
  });

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
