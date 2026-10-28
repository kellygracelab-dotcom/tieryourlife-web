import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { Ranking } from "../api/rank";
import type { PublishedList } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { itemsIn, liveItems, newBoard, poolTier, rankedTiers } from "../features/boards/model";
import type { CopyBack } from "../features/boards/ownList";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import {
  DEFAULT_TIERS,
  editDraftKey,
  forkDraftKey,
  NEW_DRAFT_KEY,
  saveEditorDraft,
  type Draft,
} from "../features/editor/model";
import { memoryStore, type KeyValueStore } from "../lib/storage";
import { NewBoardPage } from "./NewBoardPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());

const me: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

/** The feed's own copy of a picture of list `listId`. */
const feedCopy = (listId: string, pictureId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(`published/${listId}/${pictureId}`)}?alt=media`;
const POSTER = "https://image.tmdb.org/t/p/w500/witch.jpg";

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: feedCopy("abc", "p1"), tierIndex: 0 },
    { title: "The Witch", imageUrl: POSTER, tierIndex: 1 },
    { title: "Climax", imageUrl: null, tierIndex: null },
  ],
};

const draft = (title: string, items: string[], rows: number[][]): Draft => ({
  title,
  category: "film_tv",
  tiers: DEFAULT_TIERS.map((tier, index) => ({ ...tier, key: `t${index}` })),
  items: items.map((name, index) => ({
    key: `p${index}`,
    title: name,
    imageUrl: null,
    pictureId: null,
  })),
  rows,
  serial: DEFAULT_TIERS.length + items.length,
});

/** Where the page went, so a test can see the board it opened. */
function Arrived() {
  const location = useLocation();
  return <p data-testid="arrived">{`${location.pathname}${location.search}`}</p>;
}

interface Setup {
  path: string;
  account?: Session["account"];
  repository?: BoardsRepository;
  store?: KeyValueStore;
  load?: (id: string) => Promise<PublishedList>;
  loadKept?: (code: string) => Promise<Ranking>;
  copyBack?: CopyBack;
  signIn?: Session["signIn"];
}

const open = ({
  path,
  account = me,
  repository = boardsRepository(memoryStore()),
  store = memoryStore(),
  load = () => Promise.resolve(list),
  loadKept = () => Promise.reject(new Error("no rankings here")),
  copyBack = () => Promise.reject(new Error("no copies here")),
  signIn = () => Promise.resolve({ kind: "cancelled" }),
}: Setup) => {
  const router = createMemoryRouter(
    [
      {
        path: "/b/new",
        element: (
          <NewBoardPage
            repository={repository}
            store={store}
            load={load}
            loadKept={loadKept}
            copyBack={copyBack}
            now={() => 5000}
          />
        ),
      },
      { path: "/b/:uid", element: <Arrived /> },
      { path: "/l/:id", element: <Arrived /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: () => Promise.resolve(), refresh: () => undefined }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return { repository, store };
};

const arrivedAt = async () => (await screen.findByTestId("arrived")).textContent ?? "";
const boardAt = (repository: BoardsRepository, path: string) => {
  const uid = decodeURIComponent(/^\/b\/([^?]+)/.exec(path)?.[1] ?? "");
  return repository.get(uid);
};
const titlesIn = (board: ReturnType<BoardsRepository["get"]>) => {
  const kept = board!;
  return [...rankedTiers(kept), poolTier(kept)!].map((tier) =>
    itemsIn(kept, tier.uid).map((item) => item.title),
  );
};

describe("NewBoardPage: making a list is making a board", () => {
  it("opens a new board, named after a search that brought a name along", async () => {
    open({ path: "/b/new?title=%20Cheeses%20" });
    expect(await arrivedAt()).toMatch(/^\/b\/[^?]+\?new=5000&title=Cheeses$/);
  });

  it("opens a new board with nothing brought along", async () => {
    open({ path: "/b/new" });
    expect(await arrivedAt()).toMatch(/^\/b\/[^?]+\?new=5000$/);
  });

  it("files a new board under the section it was asked for, and ignores one that is not a section", async () => {
    const { repository } = open({ path: "/b/new?category=film_tv&title=Ex%20Machina%20%26%20co" });
    expect(await arrivedAt()).toMatch(
      /^\/b\/[^?]+\?new=5000&title=Ex\+Machina\+%26\+co&category=film_tv$/,
    );
    // Nothing is kept here: the board page keeps it once it is touched.
    expect(repository.all()).toEqual([]);
  });

  it("leaves out a section the site does not have", async () => {
    open({ path: "/b/new?category=nonsense" });
    expect(await arrivedAt()).toMatch(/^\/b\/[^?]+\?new=5000$/);
  });

  it("puts a list begun in the old editor on a board, and lets the draft go", async () => {
    const store = memoryStore();
    saveEditorDraft(store, draft("Films", ["Ex Machina", "The Witch"], [[1], [], [], [], []]));
    const { repository } = open({ path: "/b/new", store });
    const board = boardAt(repository, await arrivedAt());
    expect(board?.title).toBe("Films");
    expect(titlesIn(board)).toEqual([["The Witch"], [], [], [], [], ["Ex Machina"]]);
    expect(store.read(NEW_DRAFT_KEY)).toBeNull();
  });

  it("leaves an empty draft behind and opens a new board instead", async () => {
    const store = memoryStore();
    saveEditorDraft(store, draft("  ", [], [[], [], [], [], []]));
    open({ path: "/b/new", store });
    expect(await arrivedAt()).toMatch(/\?new=5000$/);
  });

  it("makes what the link asked for even with a draft waiting, and keeps the draft for later", async () => {
    const store = memoryStore();
    saveEditorDraft(store, draft("Films", ["Ex Machina"], [[], [], [], [], []]));
    open({ path: "/b/new?category=games", store });
    expect(await arrivedAt()).toMatch(/\?new=5000&category=games$/);
    expect(store.read(NEW_DRAFT_KEY)).not.toBeNull();
  });
});

describe("NewBoardPage: a kept ranking as a board", () => {
  const ranking: Ranking = {
    code: "aaaaaaaa",
    listId: "abc",
    listAvailable: true,
    createdAt: 0,
    snapshot: {
      title: list.title,
      authorName: "someone",
      authorPhotoUrl: null,
      category: "film_tv",
      tiers: list.tiers,
      items: list.items,
    },
    rows: [[2], [0]],
  };

  it("arranges the cards as the ranking had them, without the author's own pictures", async () => {
    const { repository } = open({
      path: "/b/new?ranking=aaaaaaaa",
      loadKept: () => Promise.resolve(ranking),
    });
    const board = boardAt(repository, await arrivedAt());
    expect(titlesIn(board)).toEqual([["Climax"], ["Ex Machina"], ["The Witch"]]);
    const pictures = Object.fromEntries(
      liveItems(board!).map((item) => [item.title, item.imageUrl]),
    );
    // The author's upload goes when they do; the catalogue's poster stays.
    expect(pictures).toEqual({ "Ex Machina": null, "The Witch": POSTER, Climax: null });
  });

  it("takes what the old editor kept for that ranking instead, and lets it go", async () => {
    const store = memoryStore();
    saveEditorDraft(
      store,
      draft("Mine now", ["Climax"], [[0], [], [], [], []]),
      forkDraftKey("aaaaaaaa"),
    );
    const { repository } = open({
      path: "/b/new?ranking=aaaaaaaa",
      store,
      loadKept: () => Promise.resolve(ranking),
    });
    expect(boardAt(repository, await arrivedAt())?.title).toBe("Mine now");
    expect(store.read(forkDraftKey("aaaaaaaa"))).toBeNull();
  });

  it("says so when the ranking cannot be opened", async () => {
    open({
      path: "/b/new?ranking=aaaaaaaa",
      loadKept: () => Promise.reject(new ApiFailure({ kind: "notFound" })),
    });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "This ranking isn’t available",
    );
  });
});

describe("NewBoardPage: one's own published list is changed on its board", () => {
  it("opens the board that published it, without asking for the list", async () => {
    const repository = boardsRepository(memoryStore());
    const linked = {
      ...newBoard("films", "Films", 1, () => `x${Math.random()}`),
      publishedId: "abc",
    };
    repository.save(linked);
    const load = vi.fn(() => Promise.resolve(list));
    open({ path: "/b/new?list=abc", repository, load });
    expect(await arrivedAt()).toBe("/b/films");
    expect(load).not.toHaveBeenCalled();
  });

  it("makes the board of a list published before boards, its own pictures brought over first", async () => {
    const copyBack = vi.fn<CopyBack>(async () => ({
      pictureId: "own-1",
      previewUrl: "https://dl/users/u1/pictures/own-1",
    }));
    const { repository } = open({ path: "/b/new?list=abc", copyBack });
    const board = boardAt(repository, await arrivedAt())!;
    expect(copyBack).toHaveBeenCalledExactlyOnceWith(feedCopy("abc", "p1"));
    expect(board.publishedId).toBe("abc");
    expect(titlesIn(board)).toEqual([["Ex Machina"], ["The Witch"], ["Climax"]]);
    expect(liveItems(board).map((item) => [item.title, item.pictureId, item.imageUrl])).toEqual([
      ["Ex Machina", "own-1", "https://dl/users/u1/pictures/own-1"],
      ["The Witch", null, POSTER],
      ["Climax", null, null],
    ]);
    // In step with the list: nothing to send yet.
    expect(board.publishedEditedAt).toBe(board.editedAt);
  });

  it("carries changes the old editor had not sent, and the board knows it is behind", async () => {
    const store = memoryStore();
    saveEditorDraft(
      store,
      draft("Renamed", ["Climax"], [[0], [], [], [], []]),
      editDraftKey("abc"),
    );
    const { repository } = open({ path: "/b/new?list=abc", store });
    const board = boardAt(repository, await arrivedAt())!;
    expect(board.title).toBe("Renamed");
    expect(board.publishedEditedAt).toBeLessThan(board.editedAt);
    expect(store.read(editDraftKey("abc"))).toBeNull();
  });

  it("says so when the pictures could not come over, and tries again", async () => {
    const copyBack = vi
      .fn<CopyBack>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ pictureId: "own-1", previewUrl: "https://dl/own-1" });
    const { repository } = open({ path: "/b/new?list=abc", copyBack });
    expect(
      await screen.findByText(
        "Your list’s pictures could not be brought to its board. Nothing was lost. Try again.",
      ),
    ).toBeInTheDocument();
    expect(repository.all()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(boardAt(repository, await arrivedAt())?.publishedId).toBe("abc");
  });

  it("asks a guest to sign in first", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    open({ path: "/b/new?list=abc", account: { kind: "guest", uid: "g1" }, signIn });
    expect(screen.getByText("Sign in to edit the lists you published.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("tells somebody else's list apart, and a list that is gone", async () => {
    open({ path: "/b/new?list=abc", account: { ...me, uid: "someone" } as Session["account"] });
    expect(await screen.findByText("This list was published by someone else.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the list" })).toHaveAttribute("href", "/l/abc");
  });

  it("names a list that is not published any more", async () => {
    open({
      path: "/b/new?list=abc",
      load: () => Promise.reject(new ApiFailure({ kind: "notFound" })),
    });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "This list isn’t available",
    );
  });
});
