import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import { MemoryRouter } from "react-router";
import type { PublishedList } from "../../api/types";
import type { DraftStore } from "./draft";
import { RankingBoard } from "./RankingBoard";

vi.mock("../../lib/api", () => ({ keepRanking: vi.fn(), noteTake: vi.fn() }));

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

function memoryStore(): DraftStore & { data: Map<string, string> } {
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
      screen.getByText("Tap a tier to place Ex Machina, or press its number"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Place Ex Machina in S" }));

    expect(within(tierList("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(progress()).toHaveTextContent("1 of 3 placed");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2 cards left");
    // The next card is picked already; with nothing picked the hint asks for one.
    expect(
      screen.getByText("Tap a tier to place The Witch, or press its number"),
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
    expect(screen.getByText("Tap a tier to place it")).toBeInTheDocument();

    // The band's own button, the way a finger or a screen reader gets there.
    await userEvent.click(screen.getByRole("button", { name: "Place Ex Machina in S" }));
    expect(card("The Witch")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Place The Witch in A" }));
    expect(card("Climax")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tierList("A"));
    expect(progress()).toHaveTextContent("3 of 3 placed");
    expect(screen.queryByRole("button", { pressed: true })).toBeNull();

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
      await userEvent.click(screen.getByRole("button", { name: "Place Ex Machina in S" }));
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
    expect(
      screen.getByText("Change your mind by dragging a card, or finish and get your link."),
    ).toBeInTheDocument();

    const finishes = screen.getAllByRole("button", { name: "Finish" });
    expect(finishes).toHaveLength(2);
    await userEvent.click(finishes[1]!);
    expect(keep).toHaveBeenCalledWith("abc", [[0, 1], [2]]);
    expect(await screen.findByText(/\/r\/abcdefgh/)).toBeInTheDocument();
    expect(screen.queryByText("All 3 placed")).toBeNull();
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
});
