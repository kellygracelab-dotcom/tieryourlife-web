import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  addToPool,
  arrangeItems,
  itemsIn,
  liveItems,
  newBoard,
  poolTier,
  rankedTiers,
} from "../features/boards/model";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import { memoryStore } from "../lib/storage";
import { BoardPage } from "./BoardPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());
vi.mock("../lib/pictures", async (original) => ({
  ...(await original<typeof import("../lib/pictures")>()),
  uploadPicture: vi.fn(),
}));

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const filmBoard = () => {
  const next = uids();
  const b = addToPool(
    newBoard("films", "Films", 100, next),
    ["Ex Machina", "The Witch", "Climax"].map((title) => ({ title, imageUrl: null })),
    100,
    next,
  );
  const [ia] = liveItems(b).map((item) => item.uid);
  return arrangeItems(b, [[ia!], [], [], [], []], 100);
};

let clock = 1000;
const open = (repository: BoardsRepository, path: string) => {
  const router = createMemoryRouter(
    [
      {
        path: "/b/:uid",
        element: (
          <BoardPage
            repository={repository}
            now={() => ++clock}
            lookup={() => Promise.resolve([])}
            upload={() => Promise.reject(new Error("no uploads here"))}
          />
        ),
      },
      { path: "/boards", element: <h1>boards page</h1> },
      { path: "/trash", element: <h1>trash page</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

const tier = (label: string) => screen.getByRole("list", { name: label });

describe("BoardPage", () => {
  it("shows the board as it is kept, and keeps every move at once", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Films");
    expect(screen.getByText("1 ranked · 2 in pool")).toBeInTheDocument();
    expect(within(tier("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    // No Save and no Discard: the board on screen is the board.
    expect(screen.queryByRole("button", { name: /Publish changes|Save|Discard/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "The Witch" }));
    await userEvent.keyboard("2");
    expect(within(tier("A")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();
    const kept = repository.get("films")!;
    const [s, a] = rankedTiers(kept);
    expect(itemsIn(kept, s!.uid).map((item) => item.title)).toEqual(["Ex Machina"]);
    expect(itemsIn(kept, a!.uid).map((item) => item.title)).toEqual(["The Witch"]);
    expect(itemsIn(kept, poolTier(kept)!.uid).map((item) => item.title)).toEqual(["Climax"]);
    expect(kept.editedAt).toBeGreaterThan(100);
    expect(screen.getByText("2 ranked · 1 in pool")).toBeInTheDocument();

    // Undo on the board is kept too.
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(itemsIn(repository.get("films")!, a!.uid)).toEqual([]);
  });

  it("renames the board where it stands", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByRole("button", { name: "Edit list name" }));
    const field = screen.getByRole("textbox", { name: "Title" });
    await userEvent.clear(field);
    await userEvent.type(field, "Films I make people watch{Enter}");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Films I make people watch",
    );
    expect(repository.get("films")?.title).toBe("Films I make people watch");

    // Escape puts the old name back; an empty name is Untitled list.
    await userEvent.click(screen.getByRole("button", { name: "Edit list name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "x{Escape}");
    expect(repository.get("films")?.title).toBe("Films I make people watch");
    await userEvent.click(screen.getByRole("button", { name: "Edit list name" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
    await userEvent.keyboard("{Enter}");
    expect(repository.get("films")?.title).toBe("Untitled list");
  });

  it("adds a card by name into the pool, and sends one to the trash with Undo", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.type(screen.getByRole("textbox", { name: "Add a card" }), "Heat{Enter}");
    expect(screen.getByRole("button", { name: "Heat" })).toBeInTheDocument();
    const kept = repository.get("films")!;
    expect(itemsIn(kept, poolTier(kept)!.uid).map((item) => item.title)).toEqual([
      "The Witch",
      "Climax",
      "Heat",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Remove Climax" }));
    expect(screen.queryByRole("button", { name: "Climax" })).toBeNull();
    expect(
      repository.get("films")?.items.find((item) => item.title === "Climax")?.deletedAt,
    ).toBeGreaterThan(100);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("“Climax” moved to the trash");
    await userEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Climax" })).toBeInTheDocument();
    expect(
      repository.get("films")?.items.find((item) => item.title === "Climax")?.deletedAt,
    ).toBeNull();
  });

  it("sends the whole board to the trash and goes back to the boards", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const router = open(repository, "/b/films");
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Delete board" }));
    expect(repository.get("films")?.deletedAt).toBe(clock);
    expect(router.state.location.pathname).toBe("/boards");
    expect(router.state.location.state).toEqual({ trashed: ["films"] });
  });

  it("throws a brand-new board away when it is left untouched, and keeps one that was named", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(newBoard("fresh", "Untitled list", 777, uids()));
    const router = open(repository, "/b/fresh?new=777");
    // The name is up for editing from the start.
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("link", { name: "Your boards" }));
    expect(router.state.location.pathname).toBe("/boards");
    expect(repository.get("fresh")).toBeNull();

    repository.save(newBoard("named", "Untitled list", 778, uids()));
    open(repository, "/b/named?new=778");
    // The name is selected whole, so typing replaces it.
    await userEvent.keyboard("Ramen{Enter}");
    await userEvent.click(screen.getByRole("link", { name: "Your boards" }));
    expect(repository.get("named")?.title).toBe("Ramen");
  });

  it("says so when there is no such board", () => {
    open(boardsRepository(memoryStore()), "/b/nowhere");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("List not found.");
    expect(screen.getByRole("link", { name: "Your boards" })).toHaveAttribute("href", "/boards");
  });
});
