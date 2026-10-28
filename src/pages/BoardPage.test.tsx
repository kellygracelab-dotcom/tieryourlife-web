import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, onTestFinished, vi } from "vitest";
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
import type { PublishingDeps } from "../features/boards/BoardSettings";
import type { Share } from "../features/ranking/share";
import { TIER_PRESETS } from "../features/editor/model";
import { TIER_HOLD_MS } from "../features/tierboard/useTierMove";
import { SessionContext, type Session } from "../app/session";
import type { Upload } from "../features/editor/AddCardBox";
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
const noPublishing: PublishingDeps = {
  publish: () => Promise.reject(new Error("no publishing here")),
  republish: () => Promise.reject(new Error("no publishing here")),
  unpublish: () => Promise.reject(new Error("no publishing here")),
};
const member: Session["account"] = {
  kind: "signedIn",
  uid: "me",
  displayName: "Danylo",
  photoUrl: null,
};
const open = (
  repository: BoardsRepository,
  path: string,
  extra: {
    share?: Share;
    publishing?: PublishingDeps;
    account?: Session["account"];
    upload?: Upload;
    signIn?: Session["signIn"];
  } = {},
) => {
  const router = createMemoryRouter(
    [
      {
        path: "/b/:uid",
        element: (
          <BoardPage
            repository={repository}
            now={() => ++clock}
            lookup={() => Promise.resolve([])}
            upload={extra.upload ?? (() => Promise.reject(new Error("no uploads here")))}
            publishing={extra.publishing ?? noPublishing}
            share={extra.share ?? (() => Promise.resolve())}
          />
        ),
      },
      { path: "/b", element: <h1>boards page</h1> },
      { path: "/trash", element: <h1>trash page</h1> },
    ],
    { initialEntries: [path] },
  );
  const page = <RouterProvider router={router} />;
  render(
    extra.account === undefined ? (
      page
    ) : (
      <SessionContext.Provider
        value={{
          account: extra.account,
          signIn: extra.signIn ?? (() => Promise.resolve({ kind: "cancelled" })),
          signOut: () => Promise.resolve(),
          refresh: () => undefined,
        }}
      >
        {page}
      </SessionContext.Provider>
    ),
  );
  return router;
};

const tier = (label: string) => screen.getByRole("list", { name: label });
const bandOf = (label: string) => tier(label).closest(".tier")!.querySelector(".tier__band")!;

// jsdom has no PointerEvent and no layout: a pointer is a mouse event that
// says what made it, and the tier rows are laid out by hand, 100 px apart and
// 92 tall, top to bottom.
const pointer = (type: string, target: Element | Window, y: number, kind = "mouse") => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerType", { value: kind });
  fireEvent(target, event);
};
const layOutTiers = () =>
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const row = /^tier:(\d+)$/.exec(this.dataset.drop ?? "");
    const top = row === null ? 0 : Number(row[1]) * 100;
    const height = row === null ? 0 : 92;
    return { top, bottom: top + height, height, left: 0, right: 0, width: 0 } as DOMRect;
  });

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

  it("draws the same cards after a move along a row, and keeps them in that order", async () => {
    const repository = boardsRepository(memoryStore());
    const next = uids();
    const b = addToPool(
      newBoard("films", "Films", 100, next),
      ["Ex Machina", "The Witch", "Climax"].map((title) => ({ title, imageUrl: null })),
      100,
      next,
    );
    repository.save(arrangeItems(b, [liveItems(b).map((item) => item.uid), [], [], [], []], 100));
    open(repository, "/b/films");
    const order = () =>
      within(tier("S"))
        .getAllByRole("button")
        .flatMap((tile) =>
          tile.dataset.item === undefined ? [] : [tile.getAttribute("aria-label")],
        );
    expect(order()).toEqual(["Ex Machina", "The Witch", "Climax"]);
    // Climax picked and moved twice to the left by its keys.
    await userEvent.click(within(tier("S")).getByRole("button", { name: "Climax" }));
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(order()).toEqual(["Climax", "Ex Machina", "The Witch"]);
    const kept = repository.get("films")!;
    expect(itemsIn(kept, rankedTiers(kept)[0]!.uid).map((item) => item.title)).toEqual([
      "Climax",
      "Ex Machina",
      "The Witch",
    ]);
  });

  it("starts a new board with the name a search brought along", async () => {
    const repository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100&title=Cheeses");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Cheeses");
  });

  it("asks a guest to sign in at the first picture, and sends none when they do not", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const upload = vi.fn<Upload>();
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    open(repository, "/b/films", { account: { kind: "guest", uid: "g1" }, upload, signIn });
    await userEvent.upload(screen.getByLabelText("Upload images"), [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to add your own pictures");
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
    expect(router.state.location.pathname).toBe("/b");
    expect(router.state.location.state).toEqual({ trashed: ["films"] });
  });

  it("makes a new board with the phone's five tiers, and keeps it only once it is touched", async () => {
    const repository = boardsRepository(memoryStore());
    const router = open(repository, "/b/fresh?new=777");
    // The name is up for editing from the start.
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
    expect(screen.getByRole("list", { name: "S" })).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Untitled list");
    await userEvent.click(screen.getByRole("link", { name: "Your lists" }));
    expect(router.state.location.pathname).toBe("/b");
    expect(repository.get("fresh")).toBeNull();

    open(repository, "/b/named?new=778");
    // The name is selected whole, so typing replaces it.
    await userEvent.keyboard("Ramen{Enter}");
    const kept = repository.get("named");
    expect(kept?.title).toBe("Ramen");
    expect(kept?.editedAt).toBeGreaterThan(778);
    expect(rankedTiers(kept!).map((t) => t.label)).toEqual(["S", "A", "B", "C", "D"]);
  });

  it("says so when there is no such board", () => {
    open(boardsRepository(memoryStore()), "/b/nowhere");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("List not found.");
    expect(screen.getByRole("link", { name: "Your lists" })).toHaveAttribute("href", "/b");
  });
});

describe("BoardPage: tiers and settings", () => {
  it("changes a tier on the board itself: a double tap or the pencil opens it, Save keeps it", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    const kept = () => rankedTiers(repository.get("films")!)[0]!;

    // Two quick taps on the band, the phone's gesture.
    const band = bandOf("S");
    for (let i = 0; i < 2; i++) {
      pointer("pointerdown", band, 50);
      pointer("pointerup", window, 50);
    }
    const dialog = screen.getByRole("dialog", { name: "Edit tier" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    // A tier needs a name; the board keeps the old one meanwhile.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(name, "Top");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Caption" }), "the best");
    await userEvent.click(within(dialog).getByRole("button", { name: TIER_PRESETS[4]!.light }));
    // Nothing changes until Save.
    expect(kept().label).toBe("S");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(kept()).toMatchObject({
      label: "Top",
      caption: "the best",
      colorLight: TIER_PRESETS[4]!.light,
      colorDark: TIER_PRESETS[4]!.dark,
    });
    expect(screen.getByRole("list", { name: "Top" })).toBeInTheDocument();

    // The pencil, for a keyboard; Cancel leaves the tier as it was.
    await userEvent.click(screen.getByRole("button", { name: "Edit tier Top" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "!!");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(kept().label).toBe("Top");

    // And a tier taken away from its own editor comes back with Undo, cards and all.
    await userEvent.click(screen.getByRole("button", { name: "Edit tier Top" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Top" }));
    expect(rankedTiers(repository.get("films")!).map((t) => t.label)).toEqual(["A", "B", "C", "D"]);
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(kept().label).toBe("Top");
  });

  it("adds a tier under the last one, from the board", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByRole("button", { name: "Add tier" }));
    expect(rankedTiers(repository.get("films")!).map((t) => t.label)).toEqual([
      "S",
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(screen.getByRole("list", { name: "E" })).toBeInTheDocument();
  });

  it("carries a tier by its band with a mouse, the others standing aside, and moves it on release", () => {
    const layout = layOutTiers();
    onTestFinished(() => layout.mockRestore());
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    const row = bandOf("S").closest(".tier")!;
    pointer("pointerdown", bandOf("S"), 50);
    // Less than the slop is still a press.
    pointer("pointermove", window, 53);
    expect(row).not.toHaveClass("tier--lifted");
    pointer("pointermove", window, 260);
    expect(row).toHaveClass("tier--lifted");
    expect(row).toHaveStyle({ transform: "translateY(210px)" });
    // A and B make room above it; nothing is kept yet.
    expect(bandOf("A").closest(".tier")).toHaveStyle({ transform: "translateY(-92px)" });
    expect(bandOf("C").closest(".tier")).not.toHaveStyle({ transform: "translateY(-92px)" });
    expect(rankedTiers(repository.get("films")!)[0]?.label).toBe("S");

    pointer("pointerup", window, 260);
    const after = repository.get("films")!;
    expect(rankedTiers(after).map((t) => t.label)).toEqual(["A", "B", "S", "C", "D"]);
    // Its card went with it.
    expect(itemsIn(after, rankedTiers(after)[2]!.uid).map((i) => i.title)).toEqual(["Ex Machina"]);
  });

  it("lifts a tier under a finger only after a long press; a finger that moves sooner scrolls", () => {
    vi.useFakeTimers();
    const layout = layOutTiers();
    onTestFinished(() => layout.mockRestore());
    try {
      const repository = boardsRepository(memoryStore());
      repository.save(filmBoard());
      open(repository, "/b/films");
      pointer("pointerdown", bandOf("S"), 50, "touch");
      pointer("pointermove", window, 80, "touch");
      act(() => vi.advanceTimersByTime(TIER_HOLD_MS));
      expect(bandOf("S").closest(".tier")).not.toHaveClass("tier--lifted");
      pointer("pointerup", window, 80, "touch");

      pointer("pointerdown", bandOf("S"), 50, "touch");
      act(() => vi.advanceTimersByTime(TIER_HOLD_MS));
      expect(bandOf("S").closest(".tier")).toHaveClass("tier--lifted");
      pointer("pointermove", window, 160, "touch");
      pointer("pointerup", window, 160, "touch");
      expect(rankedTiers(repository.get("films")!).map((t) => t.label)).toEqual([
        "A",
        "S",
        "B",
        "C",
        "D",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the category and the display mode from the settings, and shows the ranked list", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    const settings = within(screen.getByRole("dialog", { name: "List settings" }));
    await userEvent.click(settings.getByRole("button", { name: /Category/ }));
    await userEvent.click(settings.getByRole("radio", { name: "Film & TV" }));
    expect(repository.get("films")?.category).toBe("film_tv");
    expect(screen.getByText("1 ranked · 2 in pool · Film & TV")).toBeInTheDocument();

    await userEvent.click(settings.getByRole("radio", { name: "Ranking" }));
    expect(repository.get("films")?.displayMode).toBe("FLAT_RANKED");
    const column = screen.getByRole("list", { name: "Ranked list" });
    expect(
      within(column)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["1Ex MachinaS"]);
    expect(screen.queryByRole("list", { name: "S" })).toBeNull();
    // Cards can still come in.
    expect(screen.getByRole("textbox", { name: "Add a card" })).toBeInTheDocument();

    // The single strip: the rows, each one line of cards that scrolls sideways.
    await userEvent.click(settings.getByRole("radio", { name: "Single strip" }));
    expect(repository.get("films")?.displayMode).toBe("HORIZONTAL_SCROLL");
    expect(screen.getByRole("list", { name: "S" }).closest(".board")).toHaveClass("board--strip");

    await userEvent.click(settings.getByRole("radio", { name: "Rows" }));
    expect(screen.getByRole("list", { name: "S" }).closest(".board")).not.toHaveClass(
      "board--strip",
    );
    await userEvent.click(settings.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "List settings" })).toBeNull();
  });

  it("adds a tier from the settings and opens it in the tier editor, the sheet out of the way", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    await userEvent.click(screen.getByRole("button", { name: /New tier/ }));
    expect(screen.queryByRole("dialog", { name: "List settings" })).toBeNull();
    expect(rankedTiers(repository.get("films")!).map((t) => t.label)).toEqual([
      "S",
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    const dialog = screen.getByRole("dialog", { name: "Edit tier" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("E");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Meh");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(rankedTiers(repository.get("films")!).at(-1)?.label).toBe("Meh");
  });
});

describe("BoardPage: a new board", () => {
  it("files a new board under the section it was asked for", async () => {
    const repository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100&category=games&title=Co-op");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Co-op");
    await userEvent.keyboard("Co-op nights{Enter}");
    expect(repository.get("fresh")).toMatchObject({ title: "Co-op nights", category: "games" });

    open(repository, "/b/odd?new=100&category=nonsense");
    await userEvent.keyboard("Odd{Enter}");
    expect(repository.get("odd")?.category).toBeNull();
  });

  it("says the empty pool is empty, and + Add opens the catalogue with the cursor in it", async () => {
    const repository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Pool · 0 unranked" })).toBeInTheDocument();
    expect(screen.queryByText(/All \d+ placed/)).toBeNull();
    // jsdom's window is wide: there the catalogue waits behind the chip while the pool is empty.
    expect(screen.queryByRole("textbox", { name: "Add a card" })).toBeNull();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toHaveClass("pool__add-chip");
    expect(add).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(add);
    const field = screen.getByRole("textbox", { name: "Add a card" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "Heat{Enter}");
    expect(screen.getByRole("heading", { name: "Pool · 1 unranked" })).toBeInTheDocument();
    // With a card waiting the catalogue stays where it is.
    expect(screen.getByRole("textbox", { name: "Add a card" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("on a phone, puts the same + Add in the tray's head and opens the catalogue from it", async () => {
    const width = window.innerWidth;
    onTestFinished(() => {
      window.innerWidth = width;
    });
    window.innerWidth = 390;
    const repository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Pool · 0 unranked" })).toBeInTheDocument();
    expect(screen.queryByText(/All \d+ placed/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("textbox", { name: "Add a card" })).toHaveFocus();
    // The names drawn without pictures are the phone's size.
    await userEvent.type(screen.getByRole("textbox", { name: "Add a card" }), "Heat{Enter}");
    expect(screen.getByText("Heat", { selector: ".tile__name" })).toHaveStyle({ fontSize: "9px" });
  });
});

describe("BoardPage: share and publish", () => {
  it("draws the board as a picture from the menu, with the site's address under it", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const share = vi.fn<Share>(() => Promise.resolve());
    open(repository, "/b/films", { share });
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Share as image" }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Films" }),
      [[0], [], [], [], []],
      window.location.origin,
    );
  });

  it("publishes from the settings and says so, then shares the published address", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "film_tv" });
    const share = vi.fn<Share>(() => Promise.resolve());
    const publishing: PublishingDeps = {
      ...noPublishing,
      publish: vi.fn(() => Promise.resolve({ id: "L1" })),
    };
    open(repository, "/b/films", { share, publishing, account: member });
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    await userEvent.click(screen.getByRole("switch", { name: "Public" }));
    expect(await screen.findByText("Published. Anyone with the link can rank it.")).toBeVisible();
    expect(publishing.publish).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Films", category: "film_tv" }),
    );
    expect(repository.get("films")).toMatchObject({ publishedId: "L1", authorName: "Danylo" });
    expect(screen.getByRole("link", { name: "Open the list" })).toHaveAttribute("href", "/l/L1");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Share as image" }));
    expect(share).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      `${window.location.origin}/l/L1`,
    );
  });
});
