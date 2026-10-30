import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import { MemoryRouter } from "react-router";
import type { PublishedList } from "../../api/types";
import { SessionContext, type Session } from "../../app/session";
import type { KeyValueStore } from "../../lib/storage";
import { RankingBoard } from "./RankingBoard";

vi.mock("../../lib/api", () => ({
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  keepListRanking: vi.fn(async () => undefined),
}));

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
    { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: "https://img/ex.jpg", tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: 1 },
    { title: "Climax", imageUrl: null, tierIndex: null },
  ],
};

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

const tierList = (label: string) => screen.getByRole("list", { name: label });
const card = (title: string) => screen.getByRole("button", { name: title });
const progress = () => screen.getByText(/of 3 placed/);

describe("RankingBoard", () => {
  it("starts empty whatever the author did, with every card in the pool", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    expect(progress()).toHaveTextContent("0 of 3 placed");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("3 cards left");
    expect(within(tierList("S")).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
  });

  it("places a card by tapping it and then a tier", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    await userEvent.click(card("Ex Machina"));
    expect(card("Ex Machina")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("Click a tier to place Ex Machina, or press its number."),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Place Ex Machina in S · Masterpiece" }),
    );

    expect(within(tierList("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(progress()).toHaveTextContent("1 of 3 placed");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2 cards left");
    // The next card is picked already; with nothing picked the hint asks for one.
    expect(
      screen.getByText("Click a tier to place The Witch, or press its number."),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Pick a card, then tap a tier or press 1–2")).toBeInTheDocument();
  });

  it("places the selected card with a number key and clears with Escape", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    await userEvent.click(card("The Witch"));
    await userEvent.keyboard("2");
    expect(within(tierList("A")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();

    await userEvent.click(card("Climax"));
    await userEvent.keyboard("{Escape}");
    expect(card("Climax")).toHaveAttribute("aria-pressed", "false");
    await userEvent.keyboard("1");
    expect(progress()).toHaveTextContent("1 of 3 placed");
  });

  it("moves a placed card to another tier and undoes with the button or Ctrl+Z", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("1");
    await userEvent.click(within(tierList("S")).getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("2");
    expect(within(tierList("A")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(tierList("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(progress()).toHaveTextContent("0 of 3 placed");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("moves a picked card along its row with the arrow keys", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    // Placing one picks the next by itself, so three presses fill the row.
    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("111");
    const order = () =>
      within(tierList("S"))
        .getAllByRole("button")
        .map((tile) => tile.getAttribute("aria-label"));
    expect(order()).toEqual(["Ex Machina", "The Witch", "Climax"]);

    await userEvent.click(within(tierList("S")).getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(order()).toEqual(["The Witch", "Ex Machina", "Climax"]);
    // Still picked: the next press takes it further, and the end stops it.
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(order()).toEqual(["The Witch", "Climax", "Ex Machina"]);
    await userEvent.keyboard("{ArrowLeft}");
    expect(order()).toEqual(["The Witch", "Ex Machina", "Climax"]);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(order()).toEqual(["The Witch", "Climax", "Ex Machina"]);
  });

  it("moves the other way in Arabic, where the row starts on the right", async () => {
    render(
      <div dir="rtl" style={{ direction: "rtl" }}>
        <MemoryRouter>
          <RankingBoard list={list} />
        </MemoryRouter>
      </div>,
    );
    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("11");
    const section = document.querySelector("section");
    if (section !== null) section.style.direction = "rtl";
    await userEvent.click(within(tierList("S")).getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("{ArrowLeft}");
    expect(
      within(tierList("S"))
        .getAllByRole("button")
        .map((tile) => tile.getAttribute("aria-label")),
    ).toEqual(["The Witch", "Ex Machina"]);
  });

  it("does not steal number keys from a text field", async () => {
    render(
      <>
        <input aria-label="note" />
        <RankingBoard list={list} />
      </>,
    );
    await userEvent.click(card("Climax"));
    await userEvent.click(screen.getByRole("textbox", { name: "note" }));
    await userEvent.keyboard("1");
    expect(progress()).toHaveTextContent("0 of 3 placed");
  });

  it("places a card by tapping anywhere on the tier row, and a row with nothing picked ignores the tap", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    await userEvent.click(tierList("A"));
    expect(progress()).toHaveTextContent("0 of 3 placed");

    await userEvent.click(card("Climax"));
    await userEvent.click(tierList("A"));
    expect(within(tierList("A")).getByRole("button", { name: "Climax" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await userEvent.click(tierList("A"));
    expect(progress()).toHaveTextContent("1 of 3 placed");
  });

  it("picks the next card by itself, so the rest of the list is one tap a card", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Tap a card, then a tier")).toBeInTheDocument();
    await userEvent.click(card("Ex Machina"));
    expect(screen.getByText("Tap a tier to place Ex Machina.")).toBeInTheDocument();

    // The band's own button, the way a finger or a screen reader gets there.
    await userEvent.click(
      screen.getByRole("button", { name: "Place Ex Machina in S · Masterpiece" }),
    );
    expect(card("The Witch")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Place The Witch in A" }));
    expect(card("Climax")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tierList("A"));
    expect(progress()).toHaveTextContent("3 of 3 placed");
    // No card is picked; the pool's place toggle is the only pressed button left.
    expect(
      screen.queryByRole("button", { name: /Ex Machina|The Witch|Climax/, pressed: true }),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(card("Climax")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 card left");
  });

  it("flies a tap-placed card from the tray to its row", async () => {
    const animate = vi.fn();
    const had = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    try {
      render(
        <MemoryRouter>
          <RankingBoard list={list} store={memoryStore()} />
        </MemoryRouter>,
      );
      await userEvent.click(card("Ex Machina"));
      await userEvent.click(
        screen.getByRole("button", { name: "Place Ex Machina in S · Masterpiece" }),
      );
      expect(animate).toHaveBeenCalledOnce();
      expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 220 });
      // The tile in its row is what flies, not the one that left the tray.
      expect(animate.mock.contexts[0]).toBe(
        within(tierList("S")).getByRole("button", { name: "Ex Machina" }),
      );
    } finally {
      HTMLElement.prototype.animate = had;
    }
  });

  it("shows a dot per five cards in the tray, and none once five or fewer are left", () => {
    const long: PublishedList = {
      ...list,
      itemCount: 12,
      items: Array.from({ length: 12 }, (_, i) => ({
        title: `Film ${i + 1}`,
        imageUrl: null,
        tierIndex: null,
      })),
    };
    const { unmount } = render(
      <MemoryRouter>
        <RankingBoard list={long} store={memoryStore()} />
      </MemoryRouter>,
    );
    expect(document.querySelectorAll(".pool__dot")).toHaveLength(3);
    expect(document.querySelectorAll(".pool__dot--on")).toHaveLength(1);
    unmount();
    render(
      <MemoryRouter>
        <RankingBoard
          list={{ ...long, itemCount: 5, items: long.items.slice(0, 5) }}
          store={memoryStore()}
        />
      </MemoryRouter>,
    );
    expect(document.querySelector(".pool__dots")).toBeNull();
  });

  it("offers a search over a long pool, narrows the tray to the name typed, and / puts the cursor in it", async () => {
    const long: PublishedList = {
      ...list,
      itemCount: 30,
      items: Array.from({ length: 30 }, (_, i) => ({
        title: i === 7 ? "The Witch" : `Film ${i + 1}`,
        imageUrl: null,
        tierIndex: null,
      })),
    };
    render(
      <MemoryRouter>
        <RankingBoard list={long} store={memoryStore()} />
      </MemoryRouter>,
    );
    const tray = () => within(document.querySelector(".pool__items")!);
    const box = screen.getByRole("searchbox", { name: "Find a card" });
    expect(tray().getAllByRole("button")).toHaveLength(30);

    await userEvent.keyboard("/");
    expect(box).toHaveFocus();
    await userEvent.type(box, "witch");
    expect(tray().getAllByRole("button")).toHaveLength(1);
    expect(tray().getByRole("button", { name: "The Witch" })).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "zzz");
    expect(tray().queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("No card by that name.")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(box).not.toHaveFocus();
    expect(tray().getAllByRole("button")).toHaveLength(30);
  });

  it("docks the pool under the board on a wide, tall window, and keeps the choice to put it beside", async () => {
    const had = { width: window.innerWidth, height: window.innerHeight };
    Object.assign(window, { innerWidth: 1600, innerHeight: 900 });
    try {
      const store = memoryStore();
      render(
        <MemoryRouter>
          <RankingBoard list={list} store={store} />
        </MemoryRouter>,
      );
      const board = () => document.querySelector(".ranking")!;
      expect(board()).toHaveClass("ranking--under");
      expect(document.querySelector(".pool__grip")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Cards under the board" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await userEvent.click(screen.getByRole("button", { name: "Cards beside the board" }));
      expect(board()).not.toHaveClass("ranking--under");
      expect(document.querySelector(".pool__grip")).toBeNull();
      expect(store.data.get("tyl:pool-dock")).toContain('"wide":{"dock":"beside"');
      // The picked card and the search survive the move.
      await userEvent.click(card("Ex Machina"));
      await userEvent.click(screen.getByRole("button", { name: "Cards under the board" }));
      expect(card("Ex Machina")).toHaveAttribute("aria-pressed", "true");
    } finally {
      Object.assign(window, { innerWidth: had.width, innerHeight: had.height });
    }
  });

  it("keeps the pool beside the board on a laptop window, and offers no toggle to a phone", () => {
    const had = { width: window.innerWidth, height: window.innerHeight };
    Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
    try {
      const { unmount } = render(
        <MemoryRouter>
          <RankingBoard list={list} store={memoryStore()} />
        </MemoryRouter>,
      );
      expect(document.querySelector(".ranking")).not.toHaveClass("ranking--under");
      expect(screen.getByRole("group", { name: "Where the cards sit" })).toBeInTheDocument();
      unmount();
      Object.assign(window, { innerWidth: 390, innerHeight: 800 });
      render(
        <MemoryRouter>
          <RankingBoard list={list} store={memoryStore()} />
        </MemoryRouter>,
      );
      // The toggle is in the tree for the stylesheet to hide; the board's shape is the phone's.
      expect(document.querySelector(".ranking")).not.toHaveClass("ranking--under");
    } finally {
      Object.assign(window, { innerWidth: had.width, innerHeight: had.height });
    }
  });

  it("has no search over a pool short enough to scan", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("takes a tap on a placed card as picking that card, not as placing the picked one on its row", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("1");
    expect(card("The Witch")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(within(tierList("S")).getByRole("button", { name: "Ex Machina" }));
    expect(progress()).toHaveTextContent("1 of 3 placed");
    expect(card("Ex Machina")).toHaveAttribute("aria-pressed", "true");
    expect(card("The Witch")).toHaveAttribute("aria-pressed", "false");
  });

  it("turns the pool into the way out once every card has a tier", async () => {
    const keep = vi.fn().mockResolvedValue({ code: "abcdefgh", claimToken: "t" });
    render(
      <MemoryRouter>
        <RankingBoard
          list={list}
          keep={keep}
          take={() => Promise.resolve()}
          store={memoryStore()}
        />
      </MemoryRouter>,
    );
    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("112");
    expect(screen.getByText("All 3 placed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    // On a wide screen the pool says so in one line and keeps its place toggle;
    // Finish is the bar's, not repeated below.
    expect(screen.getByText("Drag a card to change your mind")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Where the cards sit" })).toBeInTheDocument();
    expect(document.querySelector(".pool .btn--filled")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(keep).toHaveBeenCalledWith("abc", [[0, 1], [2]]);
    expect(await screen.findByText(/\/r\/abcdefgh/)).toBeInTheDocument();
    expect(screen.queryByText("All 3 placed")).toBeNull();
    // Nothing left to place and nothing to change: no tray saying "0 cards left".
    expect(document.querySelector(".pool")).toBeNull();
  });

  it("keeps the placements in the store and picks them up again", async () => {
    const store = memoryStore();
    const { unmount } = render(
      <MemoryRouter>
        <RankingBoard list={list} store={store} />
      </MemoryRouter>,
    );
    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("1");
    expect(store.data.get("tyl:draft:abc")).toContain('"rows":[[0],[]]');
    unmount();

    render(
      <MemoryRouter>
        <RankingBoard list={list} store={store} />
      </MemoryRouter>,
    );
    expect(progress()).toHaveTextContent("1 of 3 placed");
    expect(within(tierList("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
  });

  it("starts fresh when the stored draft is for another snapshot of the list", () => {
    const store = memoryStore();
    store.write(
      "tyl:draft:abc",
      JSON.stringify({ listId: "abc", updatedAt: 999, itemCount: 3, rows: [[0], [1]] }),
    );
    render(
      <MemoryRouter>
        <RankingBoard list={list} store={store} />
      </MemoryRouter>,
    );
    expect(progress()).toHaveTextContent("0 of 3 placed");
  });

  it("keeps the ranking on Finish, locks the board and offers the link", async () => {
    const store = memoryStore();
    const keep = vi.fn(async () => ({ code: "abcdefgh", claimToken: "secret" }));
    const take = vi.fn(async () => undefined);
    const share = vi.fn(async () => undefined);
    render(
      <MemoryRouter>
        <RankingBoard list={list} store={store} keep={keep} take={take} share={share} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();

    await userEvent.click(card("Ex Machina"));
    await userEvent.keyboard("1");
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(keep).toHaveBeenCalledWith("abc", [[0], []]);
    expect(await screen.findByRole("status")).toHaveTextContent("Your ranking is live at");
    expect(take).toHaveBeenCalledWith("abc");
    expect(store.data.get("tyl:ranking:abc")).toContain('"code":"abcdefgh"');
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(card("The Witch")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Download image" }));
    expect(share).toHaveBeenCalledWith(list, [[0], []], `${window.location.host}/r/abcdefgh`);

    await userEvent.click(screen.getByRole("button", { name: "Change ranking" }));
    expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled();
    expect(card("The Witch")).toBeEnabled();
  });

  it("counts a signed-in reader's Finish among the list's rankings, as the app shows them, and a guest's not", async () => {
    const keep = vi.fn(async () => ({ code: "abcdefgh", claimToken: "secret" }));
    const tell = vi.fn(async () => undefined);
    const finish = async (account: Session["account"]) => {
      const session: Session = {
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      };
      const view = render(
        <SessionContext.Provider value={session}>
          <MemoryRouter>
            <RankingBoard
              list={list}
              store={memoryStore()}
              keep={keep}
              take={async () => undefined}
              tell={tell}
            />
          </MemoryRouter>
        </SessionContext.Provider>,
      );
      // The Witch first, then Ex Machina beside it: the order inside S travels.
      await userEvent.click(card("The Witch"));
      await userEvent.keyboard("1");
      await userEvent.click(card("Ex Machina"));
      await userEvent.keyboard("1");
      await userEvent.click(screen.getByRole("button", { name: "Finish" }));
      await screen.findByRole("status");
      view.unmount();
    };

    await finish({ kind: "signedIn", uid: "u9", displayName: "Reader", photoUrl: null });
    expect(tell).toHaveBeenCalledWith(list, [[1, 0], []]);

    tell.mockClear();
    await finish({ kind: "guest", uid: null });
    expect(tell).not.toHaveBeenCalled();
  });

  it("keeps the board editable when saving fails, and tries again", async () => {
    const keep = vi
      .fn<() => Promise<{ code: string; claimToken: string }>>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce({ code: "zzzzzzzz", claimToken: "t" });
    render(
      <MemoryRouter>
        <RankingBoard list={list} store={memoryStore()} keep={keep} take={async () => {}} />
      </MemoryRouter>,
    );
    await userEvent.click(card("Climax"));
    await userEvent.keyboard("2");
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    expect(card("Ex Machina")).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("zzzzzzzz");
  });

  it("shows the number of each of the first nine tiers on its band", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} />
      </MemoryRouter>,
    );
    const s = tierList("S").parentElement!;
    expect(s.querySelector(".tier__key")).toHaveTextContent("1");
  });

  it("turns the band's number into the row's own button while a card is picked, and no other", async () => {
    const tiers = Array.from({ length: 10 }, (_, i) => ({
      label: `T${i + 1}`,
      caption: i === 0 ? "Best" : null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    render(
      <MemoryRouter>
        <RankingBoard list={{ ...list, tiers }} />
      </MemoryRouter>,
    );
    const row = (label: string) => tierList(label).parentElement!;
    // Nothing picked: no row is a button, and the band shows its key.
    expect(screen.queryByRole("button", { name: /^Place / })).toBeNull();
    expect(row("T1").querySelector(".tier__key")).toHaveTextContent("1");

    await userEvent.click(card("Climax"));
    const first = screen.getByRole("button", { name: "Place Climax in T1 · Best" });
    expect(first).toHaveClass("tier__place");
    expect(first).toHaveTextContent("1");
    // The key became the pill; the pool's other cards step back.
    expect(row("T1").querySelector(".tier__key")).toBeNull();
    expect(row("T1")).toHaveClass("tier--armed");
    expect(screen.getByRole("heading", { level: 2 }).closest(".pool")).toHaveClass("pool--picked");
    // The tenth tier has no key: its pill is a plus alone.
    const tenth = screen.getByRole("button", { name: "Place Climax in T10" });
    expect(tenth.querySelector(".tier__place-key")).toBeNull();
    expect(tenth.querySelector(".tier__place-add--only")).toHaveTextContent("add");

    // In the tab order only while there is something to place.
    await userEvent.click(first);
    expect(within(tierList("T1")).getByRole("button", { name: "Climax" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /^Place / })).toBeNull();

    // A placed card picked again: its own row is no target, every other is.
    await userEvent.click(within(tierList("T1")).getByRole("button", { name: "Climax" }));
    expect(row("T1")).not.toHaveClass("tier--armed");
    expect(screen.queryByRole("button", { name: /^Place Climax in T1( ·.*)?$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Place Climax in T2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 }).closest(".pool")).not.toHaveClass(
      "pool--picked",
    );
  });
});
