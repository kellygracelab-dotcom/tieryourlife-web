import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { addToPool, arrangeItems, liveItems, newBoard, type Board } from "../features/boards/model";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import { LONG_PRESS_MS } from "../features/boards/listMenuTriggers";
import type { Share } from "../features/ranking/share";
import { memoryStore } from "../lib/storage";
import { usage } from "../lib/usage";
import { BoardsPage } from "./BoardsPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());
vi.mock("../lib/pictures", () => ({ uploadPicture: vi.fn() }));

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

/** A board with `count` cards, the first two ranked. */
const list = (uid: string, title: string, count = 3, extra: Partial<Board> = {}): Board => {
  const next = uids();
  const b = addToPool(
    newBoard(uid, title, 1, next),
    Array.from({ length: count }, (_, i) => ({ title: `c${i}`, imageUrl: null })),
    1,
    next,
  );
  const [ia, ib] = liveItems(b).map((item) => item.uid);
  const placed = count >= 2 ? arrangeItems(b, [[ia!], [ib!], [], [], []], 1) : b;
  return { ...placed, ...extra };
};

function BoardStub() {
  const location = useLocation();
  return <h1>board page {JSON.stringify(location.state)}</h1>;
}

const open = (
  repository: BoardsRepository,
  { share = vi.fn<Share>(async () => "saved"), copy = vi.fn(async () => undefined) } = {},
) => {
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
            share={share}
            copy={copy}
          />
        ),
      },
      { path: "/b/:uid", element: <BoardStub /> },
    ],
    { initialEntries: ["/b"] },
  );
  render(<RouterProvider router={router} />);
  return { router, share, copy };
};

const listLink = (name: string) => screen.getByRole("link", { name: `Open ${name}` });
const menuItems = () =>
  within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    // The words and the key, without the icon's ligature.
    .map((item) =>
      [...item.childNodes]
        .slice(1)
        .map((part) => part.textContent)
        .join(""),
    );

describe("a list's menu in Your lists (artboard 39)", () => {
  it("opens on a right click with the list's name, what it holds and the items in order", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films")]);
    open(repository);
    fireEvent.contextMenu(listLink("Films"), { clientX: 40, clientY: 50 });
    const menu = screen.getByRole("menu", { name: "More for Films" });
    expect(menu).toHaveTextContent("3 cards · 2 placed · private");
    expect(menuItems()).toEqual([
      "OpenEnter",
      "Play",
      "RenameF2",
      "Add to favourites",
      "Publish…",
      "Share as image",
      "DeleteDel",
    ]);
    // The first item has the focus; the separator stands before Delete.
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
  });

  it("opens from ⋮ and from Shift+F10, and Escape gives the focus back", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films")]);
    open(repository);
    await user.click(screen.getByRole("button", { name: "More for Films" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    listLink("Films").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(listLink("Films")).toHaveFocus();
  });

  it("keeps Play with fewer than three cards, says why and does nothing", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Pair", 2)]);
    open(repository);
    fireEvent.contextMenu(listLink("Pair"));
    const play = screen.getByRole("menuitem", { name: /Play/ });
    expect(play).toHaveAttribute("aria-disabled", "true");
    expect(play).toHaveTextContent("Play needs at least 3 cards.");
    await user.click(play);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("opens the board for Play and for Publish…", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films")]);
    open(repository);
    fireEvent.contextMenu(listLink("Films"));
    await user.click(screen.getByRole("menuitem", { name: "Play" }));
    expect(
      await screen.findByRole("heading", { name: 'board page {"open":"play"}' }),
    ).toBeVisible();
  });

  it("gives a published list Copy link instead of Publish…", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films", 3, { publishedId: "L1" })]);
    const count = vi.spyOn(usage, "count");
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const { copy } = open(repository);
    fireEvent.contextMenu(listLink("Films"));
    expect(screen.getByRole("menu")).toHaveTextContent("public");
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/l/L1`);
    expect(await screen.findByText("Link copied")).toBeVisible();
    // On the clipboard: a link shared.
    expect(count.mock.calls).toEqual([["share.link"]]);
  });

  it("stars, renames on the card and shares the picture", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films")]);
    const { share } = open(repository);
    fireEvent.contextMenu(listLink("Films"));
    await user.click(screen.getByRole("menuitem", { name: "Add to favourites" }));
    expect(repository.get("a")?.favouritedAt).toBe(5000);

    fireEvent.contextMenu(listLink("Films"));
    await user.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const field = screen.getByRole("textbox", { name: "List name" });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "Best films{Enter}");
    expect(repository.get("a")?.title).toBe("Best films");
    expect(screen.queryByRole("textbox", { name: "List name" })).toBeNull();

    fireEvent.contextMenu(listLink("Best films"));
    await user.click(screen.getByRole("menuitem", { name: "Share as image" }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Picture saved to your downloads")).toBeVisible();
  });

  it("F2 renames, Escape keeps the old name, Delete sends the list to the trash and the focus to the next", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films"), list("b", "Games")]);
    open(repository);
    const first = screen.getAllByRole("link", { name: /^Open / })[0]!;
    const firstName = first.getAttribute("aria-label")!.replace("Open ", "");
    const otherName = firstName === "Films" ? "Games" : "Films";
    first.focus();
    await user.keyboard("{F2}");
    await user.type(screen.getByRole("textbox", { name: "List name" }), "x{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(listLink(firstName)).toBeInTheDocument();

    listLink(firstName).focus();
    await user.keyboard("{Delete}");
    expect(await screen.findByText("1 list deleted")).toBeVisible();
    expect(screen.queryByRole("link", { name: `Open ${firstName}` })).toBeNull();
    expect(listLink(otherName)).toHaveFocus();
  });

  it("deletes from the menu with Undo", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([list("a", "Films")]);
    open(repository);
    fireEvent.contextMenu(listLink("Films"));
    await user.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(await screen.findByText("1 list deleted")).toBeVisible();
    expect(repository.get("a")?.deletedAt).toBe(5000);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(repository.get("a")?.deletedAt).toBeNull();
  });

  it("opens on a long press on a touch screen, and the press does not open the list", () => {
    vi.useFakeTimers();
    try {
      const repository = boardsRepository(memoryStore());
      repository.saveAll([list("a", "Films")]);
      open(repository);
      const link = listLink("Films");
      fireEvent.pointerDown(link, { pointerType: "touch", clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      fireEvent.pointerUp(link, { pointerType: "touch" });
      expect(screen.getByRole("menu", { name: "More for Films" })).toBeInTheDocument();
      fireEvent.click(link);
      expect(screen.queryByRole("heading", { name: /board page/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("while choosing, a right click on a chosen list deletes all the chosen", async () => {
    const user = userEvent.setup();
    const repository = boardsRepository(memoryStore());
    repository.saveAll(Array.from({ length: 7 }, (_, at) => list(`b${at}`, `List ${at}`)));
    open(repository);
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select List 1" }));
    await user.click(screen.getByRole("button", { name: "Select List 2" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Select List 2" }));
    expect(menuItems()).toEqual(["Delete 2 lists"]);
    await user.click(screen.getByRole("menuitem", { name: "Delete 2 lists" }));
    expect(await screen.findByText("2 lists deleted")).toBeVisible();
    expect(repository.get("b1")?.deletedAt).toBe(5000);
    expect(repository.get("b2")?.deletedAt).toBe(5000);
    expect(repository.get("b3")?.deletedAt).toBeNull();
  });
});
