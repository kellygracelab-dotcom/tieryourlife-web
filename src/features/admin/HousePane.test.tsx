import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { ListSummary, PublishedList } from "../../api/types";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { houseLinkOf } from "../boards/houseList";
import {
  addToPool,
  itemsIn,
  newBoard,
  rankedTiers,
  setCategory,
  type Board,
} from "../boards/model";
import { publishRequestOf } from "../boards/publish";
import { boardsRepository, type BoardsRepository } from "../boards/repository";
import { HousePane, type HouseDeps } from "./HousePane";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const house = (id: string, title: string, more: Partial<ListSummary> = {}): ListSummary => ({
  id,
  title,
  anonymous: true,
  authorUid: "",
  authorName: "",
  authorPhotoUrl: null,
  category: "food",
  itemCount: 5,
  coverImageUrl: null,
  previewImages: [],
  tierColors: ["#B03A32"],
  updatedAt: Date.UTC(2026, 9, 30),
  takeCount: 0,
  ...more,
});

let n = 0;
const uid = () => `u${++n}`;

/** A board that could be published: a section and a card. */
function readyBoard(id: string, title: string, editedAt = 1): Board {
  const board = setCategory(newBoard(id, title, 1, uid), "film_tv", 1);
  return { ...addToPool(board, [{ title: "Dune", imageUrl: null }], 1, uid), editedAt };
}

/** The feed's own copy of a picture of list `listId`. */
const feedCopy = (listId: string, pictureId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(`published/${listId}/${pictureId}`)}?alt=media`;

/** "Best ramen" in full, as Edit reads it. */
const ramenInFull: PublishedList = {
  ...house("l1", "Best ramen", { topicId: "t1", topicName: "Ramen" }),
  tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
  items: [
    { title: "Tonkotsu", imageUrl: feedCopy("l1", "p1"), tierIndex: 0 },
    { title: "Miso", imageUrl: null, tierIndex: null },
  ],
};

let repository: BoardsRepository;
let links: KeyValueStore;
let deps: HouseDeps;

function open() {
  const router = createMemoryRouter(
    [
      { path: "/admin/house", element: <HousePane deps={deps} /> },
      { path: "/l/:id", element: <h1>List page</h1> },
      { path: "/b/:uid", element: <h1>Board page</h1> },
    ],
    { initialEntries: ["/admin/house"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  window.innerWidth = 1280;
  repository = boardsRepository(memoryStore());
  links = memoryStore();
  deps = {
    load: vi.fn(async () => ({ lists: [house("l1", "Best ramen")], nextCursor: null })),
    publish: vi.fn(async () => ({ id: "new1", topicId: null })),
    replace: vi.fn(async (id: string) => ({ id, topicId: null })),
    takeDown: vi.fn(async () => undefined),
    repository,
    loadList: vi.fn(async () => ramenInFull),
    links,
    now: () => 500,
  };
});

afterEach(() => {
  window.innerWidth = 1024;
});

const row = async (title: string) => (await screen.findByText(title)).closest("li")!;

describe("HousePane", () => {
  it("lists the house's lists with their section and topic, a page at a time", async () => {
    deps.load = vi.fn(async (after: string | null) =>
      after === null
        ? { lists: [house("l1", "Best ramen", { topicName: "Ramen" })], nextCursor: "c1" }
        : { lists: [house("l2", "Comfort rewatches", { category: "film_tv" })], nextCursor: null },
    );
    open();
    expect(await screen.findByRole("heading", { name: "House lists" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Published by nobody: no name, no face, no account. Visitors see an anonymous list.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Edit opens a copy of a house list/)).toBeInTheDocument();
    const ramen = await row("Best ramen");
    expect(within(ramen).getByText(/^Food · Ramen · /)).toBeInTheDocument();
    expect(within(ramen).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/l/l1");
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Comfort rewatches")).toBeInTheDocument();
    expect(deps.load).toHaveBeenLastCalledWith("c1");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says so when there are none, and offers another try when they did not come", async () => {
    deps.load = vi
      .fn<HouseDeps["load"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce({ lists: [], nextCursor: null });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No house lists yet.")).toBeInTheDocument();
  });

  it("publishes a picked board as it would go out itself, and leaves the board private", async () => {
    const board = readyBoard("b1", "Sci-fi films");
    repository.save(board);
    const router = open();
    await row("Best ramen");
    await userEvent.click(screen.getByRole("button", { name: "Publish a board" }));
    const dialog = screen.getByRole("dialog", { name: "Which board goes out as the house?" });
    expect(within(dialog).getByText("1 card")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Sci-fi films/ }));
    expect(deps.publish).toHaveBeenCalledWith(publishRequestOf(board));
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The lists are read again, from the top.
    expect(deps.load).toHaveBeenCalledTimes(2);
    expect(repository.get("b1")).toEqual(board);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(router.state.location.pathname).toBe("/l/new1");
  });

  it("will not pick a board that could not be published, and says why", async () => {
    repository.save(newBoard("b2", "", 1, uid));
    open();
    await row("Best ramen");
    await userEvent.click(screen.getByRole("button", { name: "Publish a board" }));
    const untitled = screen.getByRole("button", { name: /Untitled list/ });
    expect(untitled).toBeDisabled();
    expect(untitled).toHaveTextContent(
      "Pick a category. Add at least one card before you publish this list.",
    );
    await userEvent.click(untitled);
    expect(deps.publish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when there is no board to pick", async () => {
    open();
    await row("Best ramen");
    await userEvent.click(screen.getByRole("button", { name: "Publish a board" }));
    expect(
      screen.getByText("You have no lists yet. Make one in Your lists first."),
    ).toBeInTheDocument();
  });

  it("replaces a house list with a board, under the same link", async () => {
    const board = readyBoard("b1", "Ramen, ranked");
    repository.save(board);
    repository.save(readyBoard("b0", "Older one", 0));
    open();
    await userEvent.click(
      within(await row("Best ramen")).getByRole("button", { name: "Replace from a board" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Replace “Best ramen” with which board?" });
    // The latest edited first.
    const boards = within(dialog)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(boards.slice(0, 2)).toEqual(["Ramen, ranked1 card", "Older one1 card"]);
    await userEvent.click(within(dialog).getByRole("button", { name: /Ramen, ranked/ }));
    expect(deps.replace).toHaveBeenCalledWith("l1", publishRequestOf(board));
    expect(await screen.findByText("Replaced")).toBeInTheDocument();
  });

  it("takes a house list down once asked again, and the row leaves", async () => {
    open();
    await userEvent.click(
      within(await row("Best ramen")).getByRole("button", { name: "Take down" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Take down “Best ramen”?" });
    expect(dialog).toHaveTextContent("its link stops working");
    await userEvent.click(within(dialog).getByRole("button", { name: "Take down" }));
    expect(deps.takeDown).toHaveBeenCalledWith("l1");
    expect(await screen.findByText("“Best ramen” taken down")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("No house lists yet.")).toBeInTheDocument();
  });

  it("keeps the question open when the take-down failed, and says so", async () => {
    deps.takeDown = vi.fn(async () => Promise.reject(new ApiFailure({ kind: "offline" })));
    open();
    await userEvent.click(
      within(await row("Best ramen")).getByRole("button", { name: "Take down" }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Take down" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That didn’t go through.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Best ramen")).toBeInTheDocument();
  });

  it("puts a refusal in plain words, and anything else as a try-again", async () => {
    repository.save(readyBoard("b1", "Sci-fi films"));
    deps.publish = vi
      .fn<HouseDeps["publish"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "pictureRefused", because: "nsfw" }))
      .mockRejectedValueOnce(
        new ApiFailure({ kind: "invalid", detail: "The topic is closed.", code: "INVALID" }),
      )
      .mockRejectedValueOnce(new ApiFailure({ kind: "tooLarge", detail: null }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "notYours" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "unknown", status: 500 }));
    open();
    await row("Best ramen");
    await userEvent.click(screen.getByRole("button", { name: "Publish a board" }));
    const dialog = screen.getByRole("dialog");
    const attempt = async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: /Sci-fi films/ }));
      return (await within(dialog).findByRole("alert")).textContent;
    };
    expect(await attempt()).toBe(
      "One of the board’s pictures was refused. Change it and try again.",
    );
    expect(await attempt()).toBe("The list was refused. The topic is closed.");
    expect(await attempt()).toBe("The list is too big to publish.");
    expect(await attempt()).toBe("Only the owner and moderators can publish as the house.");
    expect(await attempt()).toBe("Couldn’t publish. Try again.");
  });

  it("says when the list to replace is not the house's, or is gone", async () => {
    repository.save(readyBoard("b1", "Sci-fi films"));
    deps.replace = vi
      .fn<HouseDeps["replace"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "notYours" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" }));
    open();
    await userEvent.click(
      within(await row("Best ramen")).getByRole("button", { name: "Replace from a board" }),
    );
    const dialog = screen.getByRole("dialog");
    const attempt = async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: /Sci-fi films/ }));
      return (await within(dialog).findByRole("alert")).textContent;
    };
    expect(await attempt()).toBe("That list isn’t a house list, so it can’t be changed here.");
    expect(await attempt()).toBe("Couldn’t replace. Try again.");
    expect(await attempt()).toBe("This list isn’t published anymore.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Best ramen")).toBeNull();
  });

  it("starts again from the top when the page's last list went, and says when more did not come", async () => {
    deps.load = vi
      .fn<HouseDeps["load"]>()
      .mockResolvedValueOnce({ lists: [house("l1", "Best ramen")], nextCursor: "c1" })
      .mockRejectedValueOnce(new ApiFailure({ kind: "cursorGone" }))
      .mockResolvedValueOnce({ lists: [house("l1", "Best ramen")], nextCursor: "c2" })
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }));
    open();
    await row("Best ramen");
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(deps.load).toHaveBeenNthCalledWith(3, null);
    expect(deps.load).toHaveBeenLastCalledWith("c2");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this.");
  });

  it("folds a row's actions into a menu below 840, and the picker into a sheet", async () => {
    window.innerWidth = 600;
    repository.save(readyBoard("b1", "Sci-fi films"));
    open();
    const ramen = await row("Best ramen");
    expect(ramen.querySelector(".admin-list__actions")).toBeNull();
    await userEvent.click(within(ramen).getByLabelText("More for Best ramen"));
    expect(within(ramen).getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
    await userEvent.click(within(ramen).getByRole("button", { name: "Replace from a board" }));
    expect(screen.getByRole("dialog")).toHaveClass("move-dialog--sheet");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(ramen).getByLabelText("More for Best ramen"));
    await userEvent.click(within(ramen).getByRole("button", { name: "Take down" }));
    expect(screen.getByRole("dialog", { name: "Take down “Best ramen”?" })).toBeInTheDocument();
  });
});

describe("HousePane: made and changed on a board", () => {
  it("opens a new board for the house from New house list", async () => {
    const router = open();
    await row("Best ramen");
    await userEvent.click(screen.getByRole("button", { name: "New house list" }));
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
      "/b/new?house=new",
    );
  });

  it("edits a house list on a copy tied to it: its cards in their tiers, its topic, nobody's name", async () => {
    const router = open();
    await userEvent.click(within(await row("Best ramen")).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Board page" })).toBeInTheDocument();
    expect(deps.loadList).toHaveBeenCalledWith("l1");
    const [board] = repository.all();
    expect(board).toMatchObject({
      title: "Best ramen",
      category: "food",
      topic: { id: "t1", name: "Ramen" },
      authorName: null,
      publishedId: null,
      editedAt: 500,
    });
    const [top] = rankedTiers(board!);
    expect(itemsIn(board!, top!.uid).map((item) => item.title)).toEqual(["Tonkotsu"]);
    expect(houseLinkOf(board!.uid, links)).toEqual({ listId: "l1" });
    expect(router.state.location.pathname).toBe(`/b/${board!.uid}`);
    expect(router.state.location.search).toBe("?house=l1");
  });

  it("says so when the list did not come, and drops a list that is gone", async () => {
    deps.loadList = vi
      .fn<HouseDeps["loadList"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" }));
    open();
    const edit = () =>
      userEvent.click(within(screen.getByText("Best ramen").closest("li")!).getByText("Edit"));
    await row("Best ramen");
    await edit();
    expect(await screen.findByText("Couldn’t open that list. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Best ramen")).toBeInTheDocument();
    await edit();
    expect(await screen.findByText("No house lists yet.")).toBeInTheDocument();
    expect(repository.all()).toEqual([]);
  });

  it("keeps the list's own pictures by id when a board replaces it", async () => {
    const board = readyBoard("b1", "Ramen, ranked");
    const withCopy = addToPool(
      board,
      [{ title: "Tonkotsu", imageUrl: feedCopy("l1", "p1") }],
      1,
      uid,
    );
    repository.save(withCopy);
    open();
    await userEvent.click(
      within(await row("Best ramen")).getByRole("button", { name: "Replace from a board" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Ramen, ranked/ }));
    const [, sent] = vi.mocked(deps.replace).mock.calls[0]!;
    expect(sent.items.find((item) => item.title === "Tonkotsu")).toEqual({
      title: "Tonkotsu",
      imageUrl: null,
      pictureId: "p1",
      tierIndex: null,
    });
  });

  it("offers Edit in a row's menu below 840", async () => {
    window.innerWidth = 600;
    const router = open();
    const ramenRow = await row("Best ramen");
    await userEvent.click(within(ramenRow).getByLabelText("More for Best ramen"));
    await userEvent.click(within(ramenRow).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Board page" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?house=l1");
  });
});
