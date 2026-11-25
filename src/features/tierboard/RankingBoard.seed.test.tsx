import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import { draftKey } from "./draft";
import type { Rows } from "./model";
import { RankingBoard } from "./RankingBoard";
import type { HitTest } from "./useTileDrag";

vi.mock("../../lib/api", () => ({
  noteTake: vi.fn(),
  keepListRanking: vi.fn(async () => undefined),
  rearrangeRanking: vi.fn(async () => ({ code: "abcdefgh" })),
  rankingStillThere: vi.fn(async () => true),
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
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: 1 },
    { title: "Climax", imageUrl: null, tierIndex: null },
  ],
};

const theirs: Rows = [[0], [1]];
const tier = (label: string) => screen.getByRole("list", { name: label });

// jsdom has no PointerEvent, so a mouse event carries the pointer type by hand.
const pointer = (type: string, target: Element | Window, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  return fireEvent(target, event);
};

describe("RankingBoard showing somebody else's arrangement", () => {
  it("draws their rows and their pool, keeps nothing on the device, and has no bar or keys", () => {
    const store = memoryStore();
    store.write(draftKey("abc"), "this device's own draft");
    render(
      <MemoryRouter>
        <RankingBoard
          list={list}
          store={store}
          seed={{
            rows: theirs,
            label: "Their ranking",
            hint: "Placing it starts yours",
            dropHint: "Drop it to start yours",
            onStart: vi.fn(),
          }}
        />
      </MemoryRouter>,
    );
    const board = screen.getByRole("region", { name: "Their ranking" });
    expect(within(tier("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(within(tier("A")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();
    // What they left unranked is the board's pool (Danylo, 16.11.2026).
    const pool = screen
      .getByRole("heading", { level: 2, name: "Cards left · 1" })
      .closest(".pool")!;
    expect(within(pool as HTMLElement).getByRole("button", { name: "Climax" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(screen.queryByText(/placed/)).toBeNull();
    expect(board.querySelector(".tier__key")).toBeNull();
    expect(store.read(draftKey("abc"))).toBe("this device's own draft");
  });

  it("hands the rows on once, with the first move made, and not for a pick alone", async () => {
    const onStart = vi.fn();
    render(
      <MemoryRouter>
        <RankingBoard
          list={list}
          store={memoryStore()}
          seed={{
            rows: theirs,
            label: "Their ranking",
            hint: "Placing it starts yours",
            dropHint: "Drop it to start yours",
            onStart,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Placing it starts yours")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ex Machina" }));
    // A pick says what placing it will do.
    expect(screen.getByRole("status")).toHaveTextContent("Placing it starts yours");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Placing it starts yours")).toBeNull();
    expect(onStart).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "The Witch" }));
    await userEvent.click(screen.getByRole("button", { name: "Place The Witch in S" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith([[0, 1], []]);

    // The page has moved on to Mine by now; a board left behind says nothing more.
    screen.getByRole("button", { name: "Ex Machina" }).focus();
    await userEvent.keyboard("{Enter}2");
    expect(within(tier("A")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("starts Mine with a card taken out to the pool, everything placed or not", () => {
    let under: Element | null = null;
    const hitTest: HitTest = () => under;
    const onStart = vi.fn();
    render(
      <MemoryRouter>
        <RankingBoard
          list={{ ...list, items: list.items.slice(0, 2) }}
          store={memoryStore()}
          hitTest={hitTest}
          seed={{
            rows: theirs,
            label: "Their ranking",
            hint: "Placing it starts yours",
            dropHint: "Drop it to start yours",
            onStart,
          }}
        />
      </MemoryRouter>,
    );
    // All placed: no empty pool beside the board, which takes the width (Danylo, 25.11).
    const region = screen.getByRole("region", { name: "Their ranking" });
    expect(screen.queryByRole("heading", { name: "Cards left · 0" })).toBeNull();
    expect(region).toHaveClass("ranking--under");
    // A card lifted brings the pool, empty, to drop on.
    pointer("pointerdown", screen.getByRole("button", { name: "Ex Machina" }), 10, 10);
    pointer("pointermove", window, 25, 25);
    const pool = screen
      .getByRole("heading", { name: "Cards left · 0" })
      .closest<HTMLElement>(".pool")!;
    under = pool;
    pointer("pointermove", window, 40, 40);
    expect(pool).toHaveClass("pool--target");
    pointer("pointerup", window, 40, 40);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith([[], [1]]);
  });

  it("starts Mine with a card of their pool placed", async () => {
    const onStart = vi.fn();
    render(
      <MemoryRouter>
        <RankingBoard
          list={list}
          store={memoryStore()}
          seed={{
            rows: theirs,
            label: "Their ranking",
            hint: "Placing it starts yours",
            dropHint: "Drop it to start yours",
            onStart,
          }}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Climax" }));
    await userEvent.click(screen.getByRole("button", { name: "Place Climax in A" }));
    expect(onStart).toHaveBeenCalledWith([[0], [1, 2]]);
  });

  it("leaves no lifted card behind when Mine takes its place in the middle of a drag", () => {
    let under: Element | null = null;
    const hitTest: HitTest = () => under;
    const store = memoryStore();
    const page = (mine: boolean) => (
      <MemoryRouter>
        {mine ? (
          <RankingBoard key="mine" list={list} store={store} hitTest={hitTest} />
        ) : (
          <RankingBoard
            key="theirs"
            list={list}
            store={store}
            hitTest={hitTest}
            seed={{
              rows: theirs,
              label: "Their ranking",
              hint: "Placing it starts yours",
              dropHint: "Drop it to start yours",
              onStart: vi.fn(),
            }}
          />
        )}
      </MemoryRouter>
    );
    const { rerender } = render(page(false));
    pointer("pointerdown", screen.getByRole("button", { name: "Ex Machina" }), 10, 10);
    under = tier("A").parentElement;
    pointer("pointermove", window, 40, 40);
    expect(document.querySelector(".ghost")).not.toBeNull();
    // While it is carried, the line under the board says what letting go does.
    expect(screen.getByRole("status")).toHaveTextContent("Drop it to start yours");

    // The switch to Mine while the card is still held.
    rerender(page(true));
    expect(document.querySelector(".ghost")).toBeNull();
    // The rest of the gesture finds nobody listening: Mine is as it was.
    under = tier("S").parentElement;
    pointer("pointermove", window, 60, 60);
    pointer("pointerup", window, 60, 60);
    expect(document.querySelector(".ghost")).toBeNull();
    expect(document.querySelector(".tile--lifted")).toBeNull();
    expect(screen.getByText(/of 3 placed/)).toHaveTextContent("0 of 3 placed");
  });
});
