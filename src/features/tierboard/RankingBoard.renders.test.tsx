import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import { saveDraft, scopeOf } from "./draft";
import { RankingBoard } from "./RankingBoard";
import type { HitTest } from "./useTileDrag";

vi.mock("../../lib/api", () => ({
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  keepListRanking: vi.fn(async () => undefined),
  rearrangeRanking: vi.fn(async () => ({ code: "abcdefgh" })),
}));

// Every card here has no picture, so each drawing of a tile draws its name once.
const drawn = vi.hoisted(() => ({ names: 0 }));
vi.mock("./CardName", () => ({
  CardName: ({ title }: { title: string }) => {
    drawn.names++;
    return <span className="name">{title}</span>;
  },
}));

// The site's limit: four tiers of 400 cards and a pool of 400.
const CARDS = 2000;
const list: PublishedList = {
  id: "big",
  title: "Everything",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "other",
  itemCount: CARDS,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 1,
  takeCount: 0,
  tiers: ["S", "A", "B", "C"].map((label) => ({
    label,
    caption: null,
    colorLight: "#b03a32",
    colorDark: "#f1948c",
  })),
  items: Array.from({ length: CARDS }, (_, i) => ({ title: `Card ${i}`, imageUrl: null })),
};
const rows = [0, 1, 2, 3].map((tier) => Array.from({ length: 400 }, (_, i) => tier * 400 + i));

// jsdom has no layout, so the hit test is told what lies under the pointer.
let under: Element | null = null;
const hitTest: HitTest = () => under;

const pointer = (type: string, target: Element | Window, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  return fireEvent(target, event);
};
const tile = (item: number) => document.querySelector<HTMLElement>(`button[data-item="${item}"]`)!;
const row = (tier: number) => document.querySelectorAll(".board > .tier")[tier]!;

function renderBoard() {
  const store = memoryStore();
  saveDraft(store, scopeOf(list), rows);
  render(
    <MemoryRouter>
      <RankingBoard list={list} store={store} hitTest={hitTest} />
    </MemoryRouter>,
  );
  drawn.names = 0;
}

beforeEach(() => {
  under = null;
});

describe("a board of 2,000 cards", () => {
  it("draws again only the cards a pick and a placement touch", () => {
    renderBoard();
    fireEvent.click(tile(1600));
    expect(tile(1600)).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "1" });
    expect(row(0).querySelector('[data-item="1600"]')).not.toBeNull();
    // The card picked, then placed, and the card picked after it: not 2,000 twice.
    expect(drawn.names).toBeLessThan(10);
    expect(tile(1601)).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the pointer with the ghost alone, and redraws no card as one is carried", () => {
    renderBoard();
    pointer("pointerdown", tile(1700), 10, 10);
    under = row(2);
    pointer("pointermove", window, 40, 40);
    expect(tile(1700)).toHaveClass("tile--lifted");
    expect(row(2)).toHaveClass("tier--target");
    drawn.names = 0;

    for (let step = 1; step <= 20; step++) pointer("pointermove", window, 40 + step, 40);
    // Twenty moves within one place: the ghost's name twenty times, no tile's.
    expect(drawn.names).toBe(20);
    expect(document.querySelector(".ghost")).toHaveStyle({
      transform: "translate(50px, 30px) rotate(-4deg) scale(1.06)",
    });

    // Over the row's first place: the room opens there, and still no tile is drawn again.
    drawn.names = 0;
    pointer("pointermove", window, 61, -1);
    expect(row(2).querySelector(".tier__items > li")).toHaveClass("tile-slot");
    expect(drawn.names).toBe(1);

    pointer("pointerup", window, 61, -1);
    expect(row(2).querySelector(".tier__items [data-item]")).toHaveAttribute("data-item", "1700");
    expect(document.querySelector(".ghost")).toBeNull();
  });
});
