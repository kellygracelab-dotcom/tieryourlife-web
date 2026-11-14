import { actionAuth } from "../test/actionAccount";

vi.mock("../lib/firebase", async (original) => ({
  ...(await original<typeof import("../lib/firebase")>()),
  getFirebaseAuth: () => actionAuth,
}));
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  addToPool,
  arrangeItems,
  itemsIn,
  liveItems,
  moveItem,
  newBoard,
  poolTier,
  rankedTiers,
  setDisplayMode,
} from "../features/boards/model";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import type { PublishingDeps } from "../features/boards/BoardSettings";
import type { Share } from "../features/ranking/share";
import { TIER_PRESETS } from "../features/editor/model";
import { MENU_COUNT_KEY } from "../features/tierboard/RankingBoard";
import { TIER_HOLD_MS } from "../features/tierboard/useTierMove";
import { SessionContext, type Session } from "../app/session";
import type { SectionStats } from "../api/sections";
import type { PublishedList } from "../api/types";
import type { LinkKeep, Upload } from "../features/editor/AddCardBox";
import { createSectionsStore, type SectionsStore } from "../features/sections/useSections";
import { memoryStore, type KeyValueStore } from "../lib/storage";
import { ApiFailure } from "../api/errors";
import type { HouseSending } from "../features/admin/HouseBar";
import {
  hasUnsentEdits,
  houseLinkOf,
  linkToHouse,
  houseRevisionOf,
  listChangedSince,
  markHouseRevision,
} from "../features/boards/houseList";
import { publishRequestOf } from "../features/boards/publish";
import { resetModeratorForTests, type LoadReports } from "../features/moderation/useModerator";
import { loadPlayScreens } from "../features/play/usePlay";
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
    linkWeb?: LinkKeep;
    signIn?: Session["signIn"];
    store?: SectionsStore;
    house?: HouseSending;
    houseStore?: KeyValueStore;
    houseRepository?: BoardsRepository;
    loadReports?: LoadReports;
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
            find={() => Promise.resolve({ items: [], hasMore: false, notices: [], rest: false })}
            upload={extra.upload ?? (() => Promise.reject(new Error("no uploads here")))}
            linkWeb={extra.linkWeb ?? (() => Promise.reject(new Error("no links here")))}
            publishing={extra.publishing ?? noPublishing}
            share={extra.share ?? (() => Promise.resolve())}
            store={extra.store}
            house={extra.house}
            houseStore={extra.houseStore ?? memoryStore()}
            houseRepository={extra.houseRepository ?? boardsRepository(memoryStore())}
            loadReports={extra.loadReports}
          />
        ),
      },
      { path: "/b", element: <h1>boards page</h1> },
      { path: "/admin/house", element: <h1>house lists pane</h1> },
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

  it("draws a move made in another tab, and the next move here keeps it", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    expect(within(tier("S")).queryByRole("button", { name: "The Witch" })).toBeNull();
    // Another tab puts The Witch in S.
    const there = repository.get("films")!;
    const [s, a] = rankedTiers(there);
    const witch = liveItems(there).find((item) => item.title === "The Witch")!;
    act(() => {
      repository.save(moveItem(there, witch.uid, s!.uid, 1, 500));
    });
    expect(within(tier("S")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();

    // This tab's move lands on top of it, not over it.
    await userEvent.click(screen.getByRole("button", { name: "Climax" }));
    await userEvent.keyboard("2");
    const kept = repository.get("films")!;
    expect(itemsIn(kept, s!.uid).map((item) => item.title)).toEqual(["Ex Machina", "The Witch"]);
    expect(itemsIn(kept, a!.uid).map((item) => item.title)).toEqual(["Climax"]);
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
    // The field goes, and the keyboard carries on from the pencil rather than the page's top.
    expect(screen.getByRole("button", { name: "Edit list name" })).toHaveFocus();

    // Escape puts the old name back, and so does an emptied one, as on the phone.
    await userEvent.click(screen.getByRole("button", { name: "Edit list name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "x{Escape}");
    expect(repository.get("films")?.title).toBe("Films I make people watch");
    expect(screen.getByRole("button", { name: "Edit list name" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Edit list name" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
    await userEvent.keyboard("{Enter}");
    expect(repository.get("films")?.title).toBe("Films I make people watch");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Films I make people watch",
    );
  });

  it("adds a card by name into the pool, and removes one for good, with Undo", async () => {
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

    // Off the list from the card's menu, a double click away: nothing on the card itself.
    await userEvent.dblClick(screen.getByRole("button", { name: "Climax" }));
    const menu = within(screen.getByRole("menu", { name: "Climax" }));
    await userEvent.click(menu.getByRole("menuitem", { name: "Remove from list" }));
    expect(screen.queryByRole("button", { name: "Climax" })).toBeNull();
    // The focus went with the card's menu; it lands on the next card or on Undo, not the page.
    expect(document.activeElement).not.toBe(document.body);
    // Gone from the board, not to the trash: only lists go there.
    expect(repository.get("films")?.items.some((item) => item.title === "Climax")).toBe(false);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Removed Climax");
    await userEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Climax" })).toBeInTheDocument();
    expect(
      repository.get("films")?.items.find((item) => item.title === "Climax")?.deletedAt,
    ).toBeNull();
  });

  it("remembers on this device that a card's menu was opened, past the page", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.dblClick(screen.getByRole("button", { name: "Climax" }));
    expect(screen.getByRole("menu", { name: "Climax" })).toBeInTheDocument();
    expect(localStorage.getItem(MENU_COUNT_KEY)).toBe("1");
  });

  it("starts the line under the title with the pool while nothing is ranked", () => {
    const repository = boardsRepository(memoryStore());
    const next = uids();
    repository.save(
      addToPool(
        newBoard("films", "Films", 100, next),
        [{ title: "Heat", imageUrl: null }],
        100,
        next,
      ),
    );
    open(repository, "/b/films");
    expect(screen.getByText("1 in pool · nothing ranked yet")).toBeInTheDocument();
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
    // In the board's place: Back does not open it again.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("opens a list in the trash as that, with Restore, and no board to edit", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), deletedAt: 500 });
    open(repository, "/b/films");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("“Films” is in the trash.");
    expect(screen.queryByRole("list", { name: "S" })).toBeNull();
    expect(screen.queryByLabelText("More about this board")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(repository.get("films")?.deletedAt).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Films");
    expect(within(tier("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
  });

  it("takes a published board's copy down before the trash, and keeps the board while it cannot", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), publishedId: "out", authorName: "Danylo" });
    const unpublish = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const router = open(repository, "/b/films", {
      publishing: { ...noPublishing, unpublish },
    });
    const del = async () => {
      await userEvent.click(screen.getByLabelText("More about this board"));
      await userEvent.click(screen.getByRole("button", { name: "Delete board" }));
    };

    await del();
    expect(unpublish).toHaveBeenCalledWith("out");
    expect(await screen.findByRole("status")).toHaveTextContent("Kept, not deleted");
    expect(repository.get("films")?.deletedAt).toBeNull();
    expect(router.state.location.pathname).toBe("/b/films");

    await del();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/b"));
    expect(repository.get("films")).toMatchObject({
      deletedAt: clock,
      publishedId: null,
      authorName: null,
    });
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
  it("changes a tier on the board itself: a double click or the pencil opens it, Save keeps it", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    const kept = () => rankedTiers(repository.get("films")!)[0]!;

    // Two quick clicks on the band with a mouse.
    const band = bandOf("S");
    for (let i = 0; i < 2; i++) {
      pointer("pointerdown", band, 50);
      pointer("pointerup", window, 50);
    }
    const dialog = screen.getByRole("dialog", { name: "Edit tier" });
    const name = within(dialog).getByRole("textbox", { name: "Label" });
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
    await userEvent.type(screen.getByRole("textbox", { name: "Label" }), "!!");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(kept().label).toBe("Top");

    // And a tier taken away from its own editor comes back with Undo, cards and all.
    await userEvent.click(screen.getByRole("button", { name: "Edit tier Top" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove tier" }));
    expect(rankedTiers(repository.get("films")!).map((t) => t.label)).toEqual(["A", "B", "C", "D"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tier Top removed · 1 card back in the pool",
    );
    // The tier's pencil went with it: the keyboard is handed the way back.
    expect(within(screen.getByRole("status")).getByRole("button", { name: "Undo" })).toHaveFocus();
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(kept().label).toBe("Top");
  });

  it("names a tier in words, as the phone does, and counts the characters near the limit", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByRole("button", { name: "Edit tier S" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit tier" }));
    const label = dialog.getByRole("textbox", { name: "Label" });
    const caption = dialog.getByRole("textbox", { name: "Caption" });
    // The backend's limits, not three letters and sixteen.
    expect(label).toHaveAttribute("maxLength", "80");
    expect(caption).toHaveAttribute("maxLength", "60");
    await userEvent.clear(label);
    await userEvent.type(label, "Good stuff");
    await userEvent.type(caption, "A caption that is quite a bit longer");
    // Far from either limit, no counter.
    expect(dialog.queryByText(/\/80$|\/60$/)).toBeNull();
    // Fifteen characters left: the counter says how many are used.
    await userEvent.type(caption, " and more");
    expect(dialog.getByText("45/60")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(rankedTiers(repository.get("films")!)[0]).toMatchObject({
      label: "Good stuff",
      caption: "A caption that is quite a bit longer and more",
    });
    expect(screen.getByRole("list", { name: "Good stuff" })).toBeInTheDocument();
  });

  it("opens a card's menu on a double click on the card, not its tier's", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.dblClick(within(tier("S")).getByRole("button", { name: "Ex Machina" }));
    const menu = within(screen.getByRole("menu", { name: "Ex Machina" }));
    expect(screen.queryByRole("dialog", { name: "Edit tier" })).toBeNull();
    await userEvent.click(menu.getByRole("menuitem", { name: "Back to the pool" }));
    expect(within(tier("S")).queryByRole("button", { name: "Ex Machina" })).toBeNull();
    const kept = repository.get("films")!;
    expect(itemsIn(kept, poolTier(kept)!.uid).map((item) => item.title)).toContain("Ex Machina");
  });

  it("opens a tier with one tap of a finger, but not while a card waits to be placed", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByRole("button", { name: "Climax" }));
    pointer("pointerdown", bandOf("A"), 150, "touch");
    pointer("pointerup", window, 150, "touch");
    expect(screen.queryByRole("dialog", { name: "Edit tier" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    pointer("pointerdown", bandOf("A"), 150, "touch");
    pointer("pointerup", window, 150, "touch");
    const dialog = screen.getByRole("dialog", { name: "Edit tier" });
    expect(within(dialog).getByRole("textbox", { name: "Label" })).toHaveValue("A");
  });

  it("lets the second tap of a finger's double tap fall on nothing in the tier's editor", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    const before = rankedTiers(repository.get("films")!)[1]!;
    pointer("pointerdown", bandOf("A"), 150, "touch");
    pointer("pointerup", window, 150, "touch");
    const dialog = screen.getByRole("dialog", { name: "Edit tier" });

    // The second tap lands on the first swatch, where the band was.
    const swatch = within(dialog).getByRole("button", { name: TIER_PRESETS[0]!.light });
    pointer("pointerdown", swatch, 150, "touch");
    pointer("pointerup", swatch, 150, "touch");
    fireEvent.click(swatch);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(rankedTiers(repository.get("films")!)[1]).toMatchObject({
      colorLight: before.colorLight,
      colorDark: before.colorDark,
    });
  });

  it("moves a tier from its own editor, and by Alt and an arrow on its band, the keyboard staying with it", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    const labels = () => rankedTiers(repository.get("films")!).map((t) => t.label);
    await userEvent.click(screen.getByRole("button", { name: "Edit tier S" }));
    const editor = () => within(screen.getByRole("dialog", { name: "Edit tier" }));
    expect(editor().getByRole("button", { name: "Move S up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(editor().getByRole("button", { name: "Move S down" }));
    expect(labels()).toEqual(["A", "S", "B", "C", "D"]);
    // The editor stays open on the same tier, now second.
    await userEvent.click(editor().getByRole("button", { name: "Move S up" }));
    expect(labels()).toEqual(["S", "A", "B", "C", "D"]);
    // At the top it is greyed out, not taken from the keyboard, and does nothing.
    const up = editor().getByRole("button", { name: "Move S up" });
    expect(up).toHaveFocus();
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).toBeEnabled();
    await userEvent.click(up);
    expect(labels()).toEqual(["S", "A", "B", "C", "D"]);
    await userEvent.click(editor().getByRole("button", { name: "Cancel" }));

    screen.getByRole("button", { name: "Edit tier B" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(labels()).toEqual(["S", "B", "A", "C", "D"]);
    expect(screen.getByRole("button", { name: "Edit tier B" })).toHaveFocus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{ArrowDown}{/Alt}");
    expect(labels()).toEqual(["S", "A", "C", "B", "D"]);
    expect(screen.getByRole("button", { name: "Edit tier B" })).toHaveFocus();
    // An arrow alone, or a move off the end, changes nothing.
    await userEvent.keyboard("{ArrowDown}");
    screen.getByRole("button", { name: "Edit tier S" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(labels()).toEqual(["S", "A", "C", "B", "D"]);
  });

  it("adds a tier under the last one, from the board, only once its editor says Add tier", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    const labels = () => rankedTiers(repository.get("films")!).map((t) => t.label);
    await userEvent.click(screen.getByRole("button", { name: "Add tier" }));
    let dialog = within(screen.getByRole("dialog", { name: "New tier" }));
    // The next letter offered; Cancel makes nothing.
    expect(dialog.getByRole("textbox", { name: "Label" })).toHaveValue("E");
    expect(dialog.queryByRole("button", { name: "Remove tier" })).toBeNull();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(labels()).toEqual(["S", "A", "B", "C", "D"]);

    await userEvent.click(screen.getByRole("button", { name: "Add tier" }));
    dialog = within(screen.getByRole("dialog", { name: "New tier" }));
    await userEvent.type(dialog.getByRole("textbox", { name: "Caption" }), "meh");
    await userEvent.click(dialog.getByRole("button", { name: "Add tier" }));
    expect(screen.queryByRole("dialog", { name: "New tier" })).toBeNull();
    expect(rankedTiers(repository.get("films")!).at(-1)).toMatchObject({
      label: "E",
      caption: "meh",
    });
    expect(labels()).toEqual(["S", "A", "B", "C", "D", "E"]);
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

  describe("the ranked list", () => {
    const ranked = () => {
      const repository = boardsRepository(memoryStore());
      repository.save(setDisplayMode(filmBoard(), "FLAT_RANKED", 100));
      open(repository, "/b/films");
      return repository;
    };
    const titlesIn = (repository: BoardsRepository, where: number | "pool") => {
      const board = repository.get("films")!;
      const uid = where === "pool" ? poolTier(board)!.uid : rankedTiers(board)[where]!.uid;
      return itemsIn(board, uid).map((item) => item.title);
    };

    it("opens the move sheet from a row, as the phone does, and moves the card", async () => {
      const repository = ranked();
      const row = screen.getByRole("button", { name: "1. Ex Machina in S" });
      expect(row).toHaveAttribute("aria-haspopup", "dialog");
      await userEvent.click(row);
      const sheet = within(screen.getByRole("dialog", { name: "Ex Machina" }));
      expect(sheet.getByRole("button", { name: /^S/ })).toBeDisabled();
      await userEvent.click(sheet.getByRole("button", { name: "B" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(titlesIn(repository, 2)).toEqual(["Ex Machina"]);
      // The keyboard stays on the card, now in B.
      expect(screen.getByRole("button", { name: "1. Ex Machina in B" })).toHaveFocus();

      // Enter on a row opens it too; back to the pool, which opens on it.
      await userEvent.keyboard("{Enter}");
      const again = within(screen.getByRole("dialog", { name: "Ex Machina" }));
      await userEvent.click(again.getByRole("button", { name: "Back to the pool" }));
      expect(titlesIn(repository, "pool")).toEqual(["The Witch", "Climax", "Ex Machina"]);
      expect(screen.getByText("Nothing ranked yet")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pool · 3 unranked" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByRole("button", { name: "Ex Machina" })).toHaveFocus();
    });

    it("folds the pool to its count, and opens it to move or remove its cards", async () => {
      const repository = ranked();
      const head = screen.getByRole("button", { name: "Pool · 2 unranked" });
      expect(head).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "The Witch" })).toBeNull();
      await userEvent.click(head);
      expect(head).toHaveAttribute("aria-expanded", "true");
      const pool = within(screen.getByRole("region", { name: "Pool · 2 unranked" }));
      expect(pool.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "The Witch",
        "Climax",
      ]);

      await userEvent.click(pool.getByRole("button", { name: "The Witch" }));
      let sheet = within(screen.getByRole("dialog", { name: "The Witch" }));
      // Already in the pool: no way back to it.
      expect(sheet.queryByRole("button", { name: "Back to the pool" })).toBeNull();
      await userEvent.click(sheet.getByRole("button", { name: "A" }));
      expect(titlesIn(repository, 1)).toEqual(["The Witch"]);
      expect(screen.getByRole("button", { name: "2. The Witch in A" })).toHaveFocus();

      await userEvent.click(screen.getByRole("button", { name: "Climax" }));
      sheet = within(screen.getByRole("dialog", { name: "Climax" }));
      await userEvent.click(sheet.getByRole("button", { name: "Remove from list" }));
      expect(liveItems(repository.get("films")!).map((item) => item.title)).not.toContain("Climax");
      expect(screen.getByRole("status")).toHaveTextContent("Removed Climax");
      // The last card gone from the pool, so is the pool.
      expect(screen.queryByRole("region", { name: /^Pool/ })).toBeNull();
    });

    it("shows a card just added, in the pool it opens", async () => {
      ranked();
      await userEvent.type(screen.getByRole("textbox", { name: "Add a card" }), "Brand new{Enter}");
      expect(screen.getByRole("button", { name: "Pool · 3 unranked" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByRole("button", { name: "Brand new" })).toBeVisible();
    });
  });

  it("opens the tier editor on a new tier from the settings, the sheet out of the way", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    await userEvent.click(screen.getByRole("button", { name: /New tier/ }));
    expect(screen.queryByRole("dialog", { name: "List settings" })).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "New tier" });
    expect(within(dialog).getByRole("textbox", { name: "Label" })).toHaveValue("E");
    // Nothing is made until its Add tier.
    expect(rankedTiers(repository.get("films")!)).toHaveLength(5);
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Label" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Label" }), "Meh");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add tier" }));
    expect(rankedTiers(repository.get("films")!).map((t) => t.label)).toEqual([
      "S",
      "A",
      "B",
      "C",
      "D",
      "Meh",
    ]);
  });
});

describe("BoardPage: sections of one's own", () => {
  const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
    id,
    listCount: 0,
    followerCount: 0,
    newThisWeek: 0,
    collage: [],
    following: false,
    ...more,
  });
  const waiting = (id: string, name: string) =>
    stats(id, { name, status: "pending", proposerUid: "me", fileUnder: "food" });
  const storeOf = (sections: SectionStats[]) =>
    createSectionsStore({
      load: async () => ({ sections }),
      follow: vi.fn(),
      unfollow: vi.fn(),
      now: () => 0,
    });
  const openSettings = async () => {
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    return within(screen.getByRole("dialog", { name: "List settings" }));
  };

  it("says where a board in one's own waiting section goes, and names a section it does not know as Other", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "night-markets" });
    const store = storeOf([
      stats("food"),
      waiting("night-markets", "Night markets"),
      stats("other"),
    ]);
    open(repository, "/b/films", { account: member, store });
    expect(
      await screen.findByText("1 ranked · 2 in pool · Moves to Night markets once it’s approved"),
    ).toBeInTheDocument();

    repository.save({ ...filmBoard(), category: "k-dramas" });
    expect(await screen.findByText("1 ranked · 2 in pool · Other")).toBeInTheDocument();
  });

  it("opens Propose a section in the sheet's place, filing under the board's section, and gives the sheet back", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "food" });
    const store = storeOf([stats("food"), stats("games"), stats("other")]);
    open(repository, "/b/films", { account: member, store });
    let settings = await openSettings();
    await userEvent.click(settings.getByRole("button", { name: /Category/ }));
    await userEvent.click(settings.getByRole("button", { name: "Propose a section" }));

    expect(screen.queryByRole("dialog", { name: "List settings" })).toBeNull();
    const form = within(screen.getByRole("dialog", { name: "Propose a section" }));
    expect(form.getByRole("combobox", { name: "File my lists under" })).toHaveValue("food");
    await userEvent.click(form.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Propose a section" })).toBeNull();
    settings = within(screen.getByRole("dialog", { name: "List settings" }));
    expect(settings.getByRole("button", { name: /Category/ })).toHaveTextContent("Food");
  });

  it("shows the three already waiting instead of the form, and gives the sheet back after", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "food" });
    const store = storeOf([
      stats("food"),
      waiting("a-1", "Stalls"),
      waiting("b-2", "Kiosks"),
      waiting("c-3", "Food trucks"),
      stats("other"),
    ]);
    open(repository, "/b/films", { account: member, store });
    const settings = await openSettings();
    await userEvent.click(settings.getByRole("button", { name: /Category/ }));
    expect(await settings.findByRole("radio", { name: /Food trucks/ })).toBeInTheDocument();
    await userEvent.click(settings.getByRole("button", { name: "Propose a section" }));
    const tooMany = within(screen.getByRole("dialog", { name: "3 proposals are waiting" }));
    expect(tooMany.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Stalls",
      "Kiosks",
      "Food trucks",
    ]);
    await userEvent.click(tooMany.getByRole("button", { name: "OK" }));
    expect(screen.getByRole("dialog", { name: "List settings" })).toBeInTheDocument();
  });

  it("asks a guest to sign in before the form, and opens it once they have", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "food" });
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValueOnce({ kind: "cancelled" })
      .mockResolvedValueOnce({ kind: "signedIn", switched: false });
    const store = storeOf([stats("food"), stats("other")]);
    open(repository, "/b/films", { account: { kind: "guest", uid: null }, signIn, store });
    const settings = await openSettings();
    await userEvent.click(settings.getByRole("button", { name: /Category/ }));
    await userEvent.click(settings.getByRole("button", { name: "Propose a section" }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Propose a section" })).toBeNull();

    await userEvent.click(settings.getByRole("button", { name: /Category/ }));
    await userEvent.click(settings.getByRole("button", { name: "Propose a section" }));
    expect(await screen.findByRole("dialog", { name: "Propose a section" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "List settings" })).toBeNull();
  });
});

describe("BoardPage: a new board", () => {
  it("files a new board under the section it was asked for", async () => {
    const repository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100&category=games&title=Co-op");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Co-op");
    await userEvent.keyboard("Co-op nights{Enter}");
    expect(repository.get("fresh")).toMatchObject({ title: "Co-op nights", category: "games" });

    // Any section's id, also one the site has no words for: a section's page leads here too.
    open(repository, "/b/stalls?new=100&category=street-food");
    await userEvent.keyboard("Stalls{Enter}");
    expect(repository.get("stalls")?.category).toBe("street-food");

    open(repository, "/b/odd?new=100&category=Not%20a%20section!");
    await userEvent.keyboard("Odd{Enter}");
    expect(repository.get("odd")?.category).toBeNull();
  });

  it("says the empty pool is empty, with the catalogue's box open and the cursor in it", async () => {
    const repository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100");
    // The name first; the box waits for it.
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Pool · 0" })).toBeInTheDocument();
    expect(screen.getByText("Add cards by name, or search the catalogue.")).toBeInTheDocument();
    expect(screen.queryByText(/All \d+ placed/)).toBeNull();
    // jsdom's window is wide: there the box stands in the pool, with nothing behind a chip.
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    const field = screen.getByRole("textbox", { name: "Add a card" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "Heat{Enter}");
    expect(screen.getByRole("heading", { name: "Pool · 1 unranked" })).toBeInTheDocument();
    expect(screen.queryByText("Add cards by name, or search the catalogue.")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Add a card" })).toBeInTheDocument();
  });

  it("puts the cursor in the box of a kept board with no cards, the name not asked", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(newBoard("bare", "Bare", 100, uids()));
    open(repository, "/b/bare");
    await vi.waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Add a card" })).toHaveFocus(),
    );
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
    expect(screen.getByRole("heading", { name: "Pool · 0" })).toBeInTheDocument();
    expect(screen.getByText("Add cards by name, or search the catalogue.")).toBeInTheDocument();
    expect(screen.queryByText(/All \d+ placed/)).toBeNull();
    // A phone's tray keeps the box behind + Add, and asks nothing of the keyboard.
    expect(screen.queryByRole("textbox", { name: "Add a card" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("textbox", { name: "Add a card" })).toHaveFocus();
    // The names drawn without pictures are the phone's size, on the board's wider name tile.
    await userEvent.type(screen.getByRole("textbox", { name: "Add a card" }), "Heat{Enter}");
    const heat = screen.getByText("Heat", { selector: ".tile__name" });
    expect(heat).toHaveStyle({ fontSize: "13px" });
    expect(heat.closest(".tile")).toHaveClass("tile--name");
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
      expect.objectContaining({ uid: "me" }),
    );
    expect(repository.get("films")).toMatchObject({ publishedId: "L1", authorName: "Danylo" });
    expect(screen.getByRole("link", { name: "See it in Community" })).toHaveAttribute(
      "href",
      "/l/L1",
    );

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Share as image" }));
    expect(share).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      `${window.location.origin}/l/L1`,
    );
  });

  it("says a publish held for a moderator waits, keeps it after a reload, and shares the site's address, not the dead link", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save({ ...filmBoard(), category: "film_tv" });
    const share = vi.fn<Share>(() => Promise.resolve());
    const publishing: PublishingDeps = {
      ...noPublishing,
      publish: vi.fn(() => Promise.resolve({ id: "L1", topicId: null, underReview: true })),
    };
    open(repository, "/b/films", { share, publishing, account: member });
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    await userEvent.click(screen.getByRole("switch", { name: "Public" }));
    expect(
      await screen.findByText("Saved. It waits for a moderator before others can see it."),
    ).toBeVisible();
    expect(screen.queryByText("Published. Anyone with the link can rank it.")).toBeNull();
    // Read back as the browser keeps it: the hold is still known.
    expect(boardsRepository(store).get("films")).toMatchObject({
      publishedId: "L1",
      heldForReview: true,
    });

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Share as image" }));
    expect(share).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      window.location.origin,
    );
  });
});

describe("BoardPage: one's own list from its ⋮ menu", () => {
  it("publishes an own list, then updates it or takes it down, from the menu", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "film_tv" });
    const publishing: PublishingDeps = {
      ...noPublishing,
      publish: vi.fn(() => Promise.resolve({ id: "L1", topicId: null })),
      unpublish: vi.fn(() => Promise.resolve()),
    };
    open(repository, "/b/films", { publishing, account: member });
    await userEvent.click(screen.getByLabelText("More about this board"));
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Take it down" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    // The sheet opens on it and sends it, as its Public switch does.
    expect(await screen.findByText("Published. Anyone with the link can rank it.")).toBeVisible();
    expect(publishing.publish).toHaveBeenCalledTimes(1);
    expect(repository.get("films")).toMatchObject({ publishedId: "L1" });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByLabelText("More about this board"));
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    // Asked first, in the sheet, with the cursor on the way back.
    const ask = screen.getByRole("group", { name: /Take .* down\?/ });
    expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(ask).getByRole("button", { name: "Take it down" }));
    await waitFor(() => expect(repository.get("films")?.publishedId).toBeNull());
    expect(publishing.unpublish).toHaveBeenCalledWith("L1");
  });

  it("offers no Publish on a list saved from somebody else's, nor on a house list's menu", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), takenFrom: "theirs" });
    open(repository, "/b/films", { account: member });
    await userEvent.click(screen.getByLabelText("More about this board"));
    expect(screen.getByRole("button", { name: "List settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish (a separate|as my)/ })).toBeNull();
  });
});

describe("BoardPage: Play", () => {
  // The screens come as a chunk of their own; fetched here, Play opens in the frame it is pressed.
  beforeAll(() => loadPlayScreens());

  it("plays the board's cards in duels onto the board, one step of its Undo that turns over", async () => {
    localStorage.clear();
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    open(repository, "/b/films");
    await userEvent.click(screen.getByRole("button", { name: /^Play/ }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));

    // Two duels for three cards; the left card wins each, once the pair has landed.
    for (const duel of ["Duel 1 of 2", "Duel 2 of 2"]) {
      await screen.findByText(duel, { selector: "[aria-live] *, [aria-live]" });
      const [left] = await screen.findAllByRole("button", { name: /^Pick / });
      await userEvent.click(left!);
    }
    // The game ends on the board itself: no result screen, nothing to apply.
    const receipt = (
      await screen.findByText("Board arranged from 2 duels", undefined, { timeout: 3000 })
    ).closest(".snackbar")!;
    expect(screen.queryByRole("heading", { name: "Your result" })).toBeNull();
    expect(within(receipt as HTMLElement).queryByRole("button", { name: "Undo" })).toBeNull();
    const played = repository.get("films")!;
    expect(poolTier(played) === null ? 0 : itemsIn(played, poolTier(played)!.uid).length).toBe(0);
    expect(await screen.findByText("3 of 3 placed")).toBeInTheDocument();

    // The board's Undo puts the board from before the game back…
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    const back = repository.get("films")!;
    const [first] = rankedTiers(back);
    expect(itemsIn(back, first!.uid).map((item) => item.title)).toEqual(["Ex Machina"]);
    expect(itemsIn(back, poolTier(back)!.uid)).toHaveLength(2);
    expect(await screen.findByText("1 of 3 placed")).toBeInTheDocument();
    // …and again, the game's arrangement.
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("3 of 3 placed")).toBeInTheDocument();
    const again = repository.get("films")!;
    expect(itemsIn(again, poolTier(again)!.uid)).toHaveLength(0);
  });

  it("keeps Play off a board of fewer than three cards", () => {
    const repository = boardsRepository(memoryStore());
    const next = uids();
    repository.save(
      addToPool(
        newBoard("two", "Two", 100, next),
        [
          { title: "A", imageUrl: null },
          { title: "B", imageUrl: null },
        ],
        100,
        next,
      ),
    );
    open(repository, "/b/two");
    // Unavailable but still focusable, so its reason can be read.
    expect(screen.getByRole("button", { name: /^Play/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("BoardPage: a house list", () => {
  // Other pages asked about this account already, and the stub never answered them.
  beforeEach(resetModeratorForTests);
  afterEach(resetModeratorForTests);
  // The owner and the moderators read the reports; anyone else is refused them.
  const staff: LoadReports = () => Promise.resolve({ reports: [] });
  const notStaff: LoadReports = () => Promise.reject(new ApiFailure({ kind: "notYours" }));
  const sending = (): HouseSending => ({
    publish: vi.fn(() => Promise.resolve({ id: "H1", topicId: null, revision: 1 })),
    // The list read back after the send, by the server's clock.
    replace: vi.fn((id: string) =>
      Promise.resolve({ id, topicId: null, updatedAt: 7_000, revision: 2 }),
    ),
    load: vi.fn(() => Promise.reject(new ApiFailure({ kind: "offline" }))),
  });

  it("says a new board is the house's, leads back to House lists, and offers no Public switch", async () => {
    const repository = boardsRepository(memoryStore());
    const houseRepository = boardsRepository(memoryStore());
    const houseStore = memoryStore();
    const router = open(repository, "/b/fresh?new=100&house=new", {
      house: sending(),
      houseStore,
      houseRepository,
      account: member,
      loadReports: staff,
    });
    const bar = await screen.findByRole("region", { name: "House list" });
    expect(bar).toHaveTextContent("Goes out as the site: no name, no face, no account.");
    expect(bar).toHaveTextContent(
      "Pick a category. Add at least one card before you publish this list.",
    );
    expect(within(bar).getByRole("button", { name: "Publish to House lists" })).toBeDisabled();
    // Remembered as the house's once it is kept, not before.
    expect(houseLinkOf("fresh", houseStore)).toBeNull();
    await userEvent.keyboard("Ramen{Enter}");
    // Kept for the house on this device, never among one's own boards that the account syncs.
    expect(houseRepository.get("fresh")?.title).toBe("Ramen");
    expect(repository.all()).toEqual([]);
    expect(houseLinkOf("fresh", houseStore)).toEqual({ listId: null });

    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    const settings = screen.getByRole("dialog", { name: "List settings" });
    expect(within(settings).queryByRole("switch")).toBeNull();
    await userEvent.click(within(settings).getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("link", { name: "House lists" }));
    expect(router.state.location.pathname).toBe("/admin/house");
  });

  it("makes an ordinary list of one's own for anyone else who follows a link for a new house list", async () => {
    const repository = boardsRepository(memoryStore());
    const houseRepository = boardsRepository(memoryStore());
    open(repository, "/b/fresh?new=100&house=new", {
      house: sending(),
      houseRepository,
      account: member,
      loadReports: notStaff,
    });
    const title = await screen.findByRole("textbox", { name: "Title" });
    expect(screen.queryByRole("region", { name: "House list" })).toBeNull();
    expect(title).toHaveFocus();
    await userEvent.keyboard("Ramen{Enter}");
    expect(repository.get("fresh")?.title).toBe("Ramen");
    expect(houseRepository.all()).toEqual([]);
  });

  it("publishes as the house and only so, then updates the same list", async () => {
    const repository = boardsRepository(memoryStore());
    const houseRepository = boardsRepository(memoryStore());
    const board = { ...filmBoard(), category: "film_tv" };
    houseRepository.save(board);
    const houseStore = memoryStore();
    linkToHouse("films", null, houseStore);
    const house = sending();
    const publishing: PublishingDeps = { ...noPublishing, publish: vi.fn() };
    // Opened without the address saying so: this device remembers it is the house's.
    const router = open(repository, "/b/films", {
      house,
      houseStore,
      houseRepository,
      publishing,
      account: member,
    });
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(house.publish).toHaveBeenCalledWith(publishRequestOf(board));
    expect(publishing.publish).not.toHaveBeenCalled();
    expect(houseRepository.get("films")?.publishedId).toBeNull();
    expect(houseLinkOf("films", houseStore)).toEqual({ listId: "H1" });
    expect(router.state.location.search).toBe("?house=H1");
    expect(await screen.findByRole("link", { name: "Open" })).toHaveAttribute("href", "/l/H1");
    expect(screen.getByRole("region", { name: "House list" })).toHaveTextContent(
      "Your changes reach the list only when you update it.",
    );

    // The revision the list went out at is the board's from now on.
    expect(houseRevisionOf("films", houseStore)).toBe(1);

    await userEvent.click(await screen.findByRole("button", { name: "Update house list" }));
    expect(await screen.findByText("House list updated")).toBeInTheDocument();
    expect(house.replace).toHaveBeenCalledWith("H1", {
      ...publishRequestOf(board),
      baseRevision: 1,
    });
    expect(houseRevisionOf("films", houseStore)).toBe(2);
    // What went out is no edit the list lacks: a later Edit need not ask about it.
    expect(hasUnsentEdits(houseRepository.get("films")!, houseStore)).toBe(false);
    // The list as read back after it is the one the board matches, by the server's time.
    expect(listChangedSince(houseRepository.get("films")!, 7_000, houseStore)).toBe(false);
    expect(listChangedSince(houseRepository.get("films")!, 7_001, houseStore)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "House lists" }));
    expect(router.state.location.pathname).toBe("/admin/house");
  });

  it("takes the list from the address when this device does not know it yet", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save({ ...filmBoard(), category: "film_tv" });
    const houseStore = memoryStore();
    const house = sending();
    open(boardsRepository(memoryStore()), "/b/films?house=H2", {
      house,
      houseStore,
      houseRepository,
    });
    expect(houseLinkOf("films", houseStore)).toEqual({ listId: "H2" });
    await userEvent.click(screen.getByRole("button", { name: "Update house list" }));
    expect(house.replace).toHaveBeenCalledWith("H2", expect.objectContaining({ title: "Films" }));
    // Its revision is not known here: nothing is checked against one.
    expect(vi.mocked(house.replace).mock.calls[0]![1]).not.toHaveProperty("baseRevision");
  });

  // Content, 13.11.2026: a fix made on the server to the house list Fruit left
  // its updatedAt alone, Edit opened the board this browser kept from before,
  // and Update from it would have put the old list back over the fix.
  it("is refused once the list moved on, and becomes the list as it stands when asked", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save({ ...filmBoard(), category: "film_tv" });
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    markHouseRevision("films", 3, houseStore);
    const asItStands: PublishedList = {
      id: "H1",
      title: "Fruit",
      anonymous: true,
      authorUid: "",
      authorName: "",
      authorPhotoUrl: null,
      category: "food",
      itemCount: 1,
      coverImageUrl: null,
      previewImages: [],
      tierColors: [],
      updatedAt: 9_000,
      takeCount: 0,
      tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
      items: [{ title: "Mango", imageUrl: null, tierIndex: 0 }],
      revision: 5,
    };
    const house: HouseSending = {
      publish: vi.fn(),
      replace: vi.fn(() => Promise.reject(new ApiFailure({ kind: "sourceChanged", revision: 5 }))),
      load: vi.fn(() => Promise.resolve(asItStands)),
    };
    const router = open(boardsRepository(memoryStore()), "/b/films?house=H1", {
      house,
      houseStore,
      houseRepository,
    });
    await userEvent.click(screen.getByRole("button", { name: "Update house list" }));
    expect(house.replace).toHaveBeenCalledWith("H1", expect.objectContaining({ baseRevision: 3 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("List changed on the server.");
    // Never sent again over it, by itself or by the editor, until the list is loaded.
    expect(screen.getByRole("button", { name: "Update house list" })).toBeDisabled();
    expect(house.replace).toHaveBeenCalledTimes(1);
    expect(houseRepository.get("films")?.title).toBe("Films");

    await userEvent.click(screen.getByRole("button", { name: "Load the current version" }));
    expect(house.load).toHaveBeenCalledWith("H1");
    await waitFor(() => expect(houseRepository.get("films")?.title).toBe("Fruit"));
    expect(houseRepository.get("films")?.items.map((item) => item.title)).toEqual(["Mango"]);
    expect(houseRevisionOf("films", houseStore)).toBe(5);
    expect(hasUnsentEdits(houseRepository.get("films")!, houseStore)).toBe(false);
    expect(houseLinkOf("films", houseStore)).toEqual({ listId: "H1" });
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
      "/b/films?house=H1",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Update house list" })).toBeEnabled();
  });

  it("puts the house list's address under its picture", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save({ ...filmBoard(), category: "film_tv" });
    const houseStore = memoryStore();
    linkToHouse("films", "H2", houseStore);
    const share = vi.fn<Share>(() => Promise.resolve());
    open(boardsRepository(memoryStore()), "/b/films", {
      house: sending(),
      houseStore,
      houseRepository,
      share,
    });
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Share as image" }));
    expect(share).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      `${window.location.origin}/l/H2`,
    );
  });
  it("says why it did not go out, and goes out as a new list when the old one is gone", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save({ ...filmBoard(), category: "film_tv" });
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    const house: HouseSending = {
      publish: vi.fn(() => Promise.reject(new ApiFailure({ kind: "notYours" }))),
      replace: vi.fn(() => Promise.reject(new ApiFailure({ kind: "notFound" }))),
      load: vi.fn(() => Promise.reject(new ApiFailure({ kind: "notFound" }))),
    };
    const router = open(boardsRepository(memoryStore()), "/b/films?house=H1", {
      house,
      houseStore,
      houseRepository,
    });
    await userEvent.click(screen.getByRole("button", { name: "Update house list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This list isn’t published anymore.",
    );
    expect(houseLinkOf("films", houseStore)).toEqual({ listId: null });
    expect(router.state.location.search).toBe("?house=new");
    await userEvent.click(await screen.findByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner and moderators can publish as the house.",
    );
  });

  it("lets a board of one's own stay one's own, whatever an older house link says", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save({ ...filmBoard(), category: "film_tv" });
    const houseStore = memoryStore();
    // Before house boards were kept apart, they were ordinary boards linked here.
    linkToHouse("films", "H1", houseStore);
    open(repository, "/b/films?house=H1", { house: sending(), houseStore, account: member });
    expect(screen.queryByRole("region", { name: "House list" })).toBeNull();
  });

  it("drops a house board from this device on Delete, and leaves the list to the House pane", async () => {
    const repository = boardsRepository(memoryStore());
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save({ ...filmBoard(), category: "film_tv" });
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    const unpublish = vi.fn<(id: string) => Promise<void>>();
    const router = open(repository, "/b/films", {
      house: sending(),
      houseStore,
      houseRepository,
      publishing: { ...noPublishing, unpublish },
    });
    await userEvent.click(screen.getByLabelText("More about this board"));
    await userEvent.click(screen.getByRole("button", { name: "Delete board" }));
    expect(houseRepository.all()).toEqual([]);
    expect(houseLinkOf("films", houseStore)).toBeNull();
    expect(unpublish).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/admin/house");
  });
});

describe("BoardPage: pictures from links", () => {
  const linked = (imageUrl: string) => ({
    imageUrl,
    pictureId: "p1",
    attribution: { source: "web" },
    credit: null,
    quota: null,
  });
  const dropLink = (target: Element, url: string) =>
    fireEvent.drop(target, {
      dataTransfer: {
        types: ["text/uri-list"],
        files: [],
        getData: (type: string) => (type === "text/uri-list" ? url : ""),
      },
    });
  const itemOf = (repository: BoardsRepository, title: string) =>
    liveItems(repository.get("films")!).find((item) => item.title === title)!;

  it("puts a picture dropped on a card in its place, and Undo gives the old one back", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const linkWeb = vi.fn<LinkKeep>(async (ask) => linked(ask.url));
    open(repository, "/b/films", { account: member, linkWeb });
    dropLink(screen.getByRole("button", { name: "The Witch" }), "https://img.test/witch.jpg");
    const notice = await screen.findByText("Picture changed on “The Witch”");
    expect(linkWeb).toHaveBeenCalledWith({ url: "https://img.test/witch.jpg" });
    expect(itemOf(repository, "The Witch")).toMatchObject({
      imageUrl: "https://img.test/witch.jpg",
      pictureId: "p1",
      attribution: { source: "web" },
    });
    // The card keeps its place.
    expect(
      itemsIn(repository.get("films")!, poolTier(repository.get("films")!)!.uid).map(
        (item) => item.title,
      ),
    ).toEqual(["The Witch", "Climax"]);
    await userEvent.click(
      within(notice.closest<HTMLElement>("[role='status']")!).getByRole("button", {
        name: "Undo",
      }),
    );
    expect(itemOf(repository, "The Witch")).toMatchObject({ imageUrl: null, pictureId: null });
    expect(itemOf(repository, "The Witch")).not.toHaveProperty("attribution");
  });

  it("says why a link dropped on a card brought no picture, and changes nothing", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const linkWeb = vi.fn<LinkKeep>(async () => {
      throw new ApiFailure({ kind: "pictureRefused", because: null, code: "NOT_A_PICTURE" });
    });
    open(repository, "/b/films", { account: member, linkWeb });
    dropLink(screen.getByRole("button", { name: "The Witch" }), "https://site.test/page");
    expect(
      await screen.findByText(
        "That link is a page, not a picture. Open the picture itself and copy its address.",
      ),
    ).toBeInTheDocument();
    expect(itemOf(repository, "The Witch").imageUrl).toBeNull();
  });

  it("asks a guest to sign in before a dropped link is kept", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const linkWeb = vi.fn<LinkKeep>();
    const signIn = vi.fn<Session["signIn"]>(async () => ({ kind: "cancelled" }));
    open(repository, "/b/films", { account: { kind: "guest", uid: null }, linkWeb, signIn });
    dropLink(screen.getByRole("button", { name: "The Witch" }), "https://img.test/witch.jpg");
    expect(await screen.findByText("Sign in to add the picture")).toBeInTheDocument();
    expect(signIn).toHaveBeenCalled();
    expect(linkWeb).not.toHaveBeenCalled();
  });

  it("puts a card from the draft first in the pool, says so, and Undo takes it away", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(filmBoard());
    const linkWeb = vi.fn<LinkKeep>(async (ask) => linked(ask.url));
    open(repository, "/b/films", { account: member, linkWeb });
    dropLink(document.querySelector(".pool")!, "https://img.test/dune.jpg");
    const draft = await screen.findByRole("group", { name: "Picture from a link" });
    await vi.waitFor(() =>
      expect(within(draft).getByRole("button", { name: "Add card" })).toBeInTheDocument(),
    );
    await userEvent.type(within(draft).getByRole("textbox", { name: "Name" }), "Dune");
    await vi.waitFor(() =>
      expect(within(draft).getByRole("button", { name: "Add card" })).toBeEnabled(),
    );
    await userEvent.click(within(draft).getByRole("button", { name: "Add card" }));
    const kept = repository.get("films")!;
    expect(itemsIn(kept, poolTier(kept)!.uid).map((item) => item.title)).toEqual([
      "Dune",
      "The Witch",
      "Climax",
    ]);
    const notice = screen.getByText("Added “Dune”").closest<HTMLElement>("[role='status']")!;
    await userEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(liveItems(repository.get("films")!).map((item) => item.title)).not.toContain("Dune");
  });
});

describe("BoardPage: the editor's credits on a house list", () => {
  const POSTER = "https://image.tmdb.org/t/p/w500/witch.jpg";
  const pictured = () => {
    const next = uids();
    const b = addToPool(
      { ...newBoard("films", "Films", 100, next), category: "film_tv" },
      [
        {
          title: "The Witch",
          imageUrl: POSTER,
          attribution: { source: "tmdb", id: "tmdb:movie:2" },
        },
      ],
      100,
      next,
    );
    return b;
  };
  const sending = (): HouseSending => ({
    publish: vi.fn(() => Promise.resolve({ id: "H1", topicId: null })),
    replace: vi.fn((id: string) => Promise.resolve({ id, topicId: null })),
    load: vi.fn(() => Promise.reject(new ApiFailure({ kind: "offline" }))),
  });
  const aboutOf = async (name: string) => {
    await userEvent.dblClick(screen.getByRole("button", { name }));
    const menu = screen.getByRole("menu", { name });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "About the picture" }));
    return screen.getByRole("dialog", { name });
  };

  it("credits a card's picture in About the picture, and sends it with the update", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save(pictured());
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    const house = sending();
    open(boardsRepository(memoryStore()), "/b/films", { house, houseStore, houseRepository });

    const about = await aboutOf("The Witch");
    await userEvent.click(within(about).getByRole("button", { name: "Add credit" }));
    expect(within(about).getByRole("button", { name: "Save credit" })).toBeDisabled();
    await userEvent.type(within(about).getByRole("textbox", { name: "Author" }), "Jane");
    await userEvent.selectOptions(within(about).getByRole("combobox", { name: "Licence" }), [
      "CC BY 4.0",
    ]);
    await userEvent.type(
      within(about).getByRole("textbox", { name: "Source link" }),
      "https://site.test/witch",
    );
    await userEvent.click(within(about).getByRole("button", { name: "Save credit" }));
    expect(about).toHaveTextContent("Jane");
    expect(within(about).getByRole("button", { name: "Edit credit" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const credit = {
      source: "tmdb",
      id: "tmdb:movie:2",
      manual: true,
      author: "Jane",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      link: "https://site.test/witch",
    };
    expect(liveItems(houseRepository.get("films")!)[0]?.attribution).toEqual(credit);
    await userEvent.click(screen.getByRole("button", { name: "Update house list" }));
    await screen.findByText("House list updated");
    expect(vi.mocked(house.replace).mock.calls[0]?.[1].items[0]?.attribution).toEqual(credit);
  });

  it("shows the author and licence the server read from the credit's page once the update is back", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save(pictured());
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    const page = "https://commons.wikimedia.org/wiki/File:Witch.jpg";
    const filled = {
      source: "tmdb",
      id: "tmdb:movie:2",
      manual: true,
      author: "Jane Roe",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      link: page,
    };
    const house = sending();
    vi.mocked(house.replace).mockImplementation((id: string) =>
      Promise.resolve({
        id,
        topicId: null,
        revision: 3,
        list: {
          id,
          revision: 3,
          items: [{ title: "The Witch", imageUrl: POSTER, tierIndex: null, attribution: filled }],
        } as unknown as PublishedList,
      }),
    );
    open(boardsRepository(memoryStore()), "/b/films", { house, houseStore, houseRepository });

    const about = await aboutOf("The Witch");
    await userEvent.click(within(about).getByRole("button", { name: "Add credit" }));
    await userEvent.type(within(about).getByRole("textbox", { name: "Source link" }), page);
    await userEvent.click(within(about).getByRole("button", { name: "Save credit" }));
    await userEvent.keyboard("{Escape}");
    expect(liveItems(houseRepository.get("films")!)[0]?.attribution?.author).toBeUndefined();

    await userEvent.click(screen.getByRole("button", { name: "Update house list" }));
    await screen.findByText("House list updated");
    expect(liveItems(houseRepository.get("films")!)[0]?.attribution).toEqual(filled);
    expect(hasUnsentEdits(houseRepository.get("films")!, houseStore)).toBe(false);
    expect(await aboutOf("The Witch")).toHaveTextContent("Jane Roe");
  });

  it("credits the cover of one picture in the list's settings", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save({ ...pictured(), coverImageUrls: [POSTER], coverImageUrl: POSTER });
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    const house = sending();
    open(boardsRepository(memoryStore()), "/b/films", { house, houseStore, houseRepository });

    await userEvent.click(await screen.findByRole("button", { name: "List settings" }));
    const settings = screen.getByRole("dialog", { name: "List settings" });
    await userEvent.click(within(settings).getByRole("button", { name: /Cover/ }));
    const panel = within(settings).getByRole("region", { name: "About the cover picture" });
    await userEvent.click(within(panel).getByRole("button", { name: "Add credit" }));
    await userEvent.type(
      within(panel).getByRole("textbox", { name: "Source link" }),
      "https://www.flickr.com/photos/someone/123/",
    );
    expect(panel).toHaveTextContent("Author and licence will be read from this page");
    await userEvent.click(within(panel).getByRole("button", { name: "Save credit" }));
    expect(within(panel).getByRole("link", { name: "flickr.com" })).toBeInTheDocument();
    await userEvent.click(within(settings).getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Update house list" }));
    await screen.findByText("House list updated");
    expect(vi.mocked(house.replace).mock.calls[0]?.[1].coverAttribution).toEqual({
      manual: true,
      link: "https://www.flickr.com/photos/someone/123/",
    });
  });

  it("credits a card's picture from the ranked list too, and takes the credit off", async () => {
    const houseRepository = boardsRepository(memoryStore());
    houseRepository.save(setDisplayMode(pictured(), "FLAT_RANKED", 100));
    const houseStore = memoryStore();
    linkToHouse("films", "H1", houseStore);
    open(boardsRepository(memoryStore()), "/b/films", {
      house: sending(),
      houseStore,
      houseRepository,
    });
    await userEvent.click(await screen.findByRole("button", { name: /unranked/ }));
    await userEvent.click(screen.getByRole("button", { name: /The Witch/ }));
    const sheet = screen.getByRole("dialog", { name: "The Witch" });
    await userEvent.click(within(sheet).getByRole("button", { name: "About the picture" }));
    const about = screen.getByRole("dialog", { name: "The Witch" });
    await userEvent.click(within(about).getByRole("button", { name: "Add credit" }));
    await userEvent.selectOptions(within(about).getByRole("combobox", { name: "Licence" }), [
      "Public domain",
    ]);
    await userEvent.type(
      within(about).getByRole("textbox", { name: "Source link" }),
      "https://site.test/witch",
    );
    await userEvent.click(within(about).getByRole("button", { name: "Save credit" }));
    expect(liveItems(houseRepository.get("films")!)[0]?.attribution).toMatchObject({
      manual: true,
      license: "Public domain",
    });
    await userEvent.click(within(about).getByRole("button", { name: "Edit credit" }));
    await userEvent.click(within(about).getByRole("button", { name: "Remove credit" }));
    expect(liveItems(houseRepository.get("films")!)[0]?.attribution).toEqual({
      source: "tmdb",
      id: "tmdb:movie:2",
      link: "https://site.test/witch",
      manual: false,
    });
  });

  it("offers no editing on a board of one's own, for a card or the cover", async () => {
    const repository = boardsRepository(memoryStore());
    const b = pictured();
    repository.save({
      ...b,
      items: b.items.map((item) => ({
        ...item,
        attribution: { source: "tmdb", link: "https://www.themoviedb.org/movie/2" },
      })),
    });
    open(repository, "/b/films");
    const about = await aboutOf("The Witch");
    expect(within(about).queryByRole("button", { name: "Add credit" })).toBeNull();
    expect(within(about).queryByRole("button", { name: "Edit credit" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    // Nor for its cover.
    repository.save({
      ...repository.get("films")!,
      coverImageUrls: [POSTER],
      coverImageUrl: POSTER,
    });
    await userEvent.click(screen.getByRole("button", { name: "List settings" }));
    const settings = screen.getByRole("dialog", { name: "List settings" });
    await userEvent.click(within(settings).getByRole("button", { name: /Cover/ }));
    expect(within(settings).queryByRole("region", { name: "About the cover picture" })).toBeNull();
  });
});
