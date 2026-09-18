import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { TOUCH_HOLD_MS } from "./drag";
import { MemoryRouter } from "react-router";
import { RankingBoard } from "./RankingBoard";

vi.mock("../../lib/api", () => ({ keepRanking: vi.fn(), noteTake: vi.fn() }));
import type { HitTest } from "./useTileDrag";

const list: PublishedList = {
  id: "abc",
  title: "Films",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 2,
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
    { title: "Anora", imageUrl: "https://img/anora.jpg", tierIndex: null },
    { title: "Conclave", imageUrl: null, tierIndex: null },
  ],
};

// jsdom has no layout, so the hit test is told what lies under the pointer.
let under: Element | null = null;
const hitTest: HitTest = () => under;

const tierRow = (label: string) => screen.getByRole("list", { name: label }).parentElement!;
const poolBox = () => screen.getByRole("heading", { level: 2 }).closest(".pool")!;
const card = (title: string) => screen.getByRole("button", { name: title });

// jsdom has no PointerEvent, so a mouse event carries the pointer type by hand.
const pointer = (
  type: string,
  target: Element | Window,
  x: number,
  y: number,
  extra: { button?: number; pointerType?: string } = {},
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: extra.button ?? 0,
  });
  Object.defineProperty(event, "pointerType", { value: extra.pointerType ?? "mouse" });
  return fireEvent(target, event);
};

beforeEach(() => {
  vi.useFakeTimers();
  under = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dragging a card", () => {
  it("drops a card on a tier with the mouse and lifts it while it travels", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} hitTest={hitTest} />
      </MemoryRouter>,
    );
    pointer("pointerdown", card("Anora"), 10, 10, { button: 0 });
    pointer("pointermove", window, 12, 10);
    expect(card("Anora")).not.toHaveClass("tile--lifted");

    under = tierRow("S");
    pointer("pointermove", window, 40, 40);
    expect(card("Anora")).toHaveClass("tile--lifted");
    expect(tierRow("S")).toHaveClass("tier--target");
    // Grabbed 10px into a tile that jsdom lays out at the origin, so the ghost trails by that much.
    expect(document.querySelector(".ghost")).toHaveStyle({
      transform: "translate(30px, 30px) rotate(-4deg) scale(1.06)",
    });

    pointer("pointerup", window, 40, 40);
    expect(
      within(screen.getByRole("list", { name: "S" })).getByRole("button", { name: "Anora" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".ghost")).toBeNull();
    expect(screen.getByText(/of 2 placed/)).toHaveTextContent("1 of 2 placed");
  });

  // A quick flick: the move that starts the drag and the release arrive before
  // React has committed anything. The card used to fall back into the pool.
  it("drops the card even when the release comes before React has drawn the drag", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} hitTest={hitTest} />
      </MemoryRouter>,
    );
    pointer("pointerdown", card("Anora"), 10, 10, { button: 0 });
    under = tierRow("S");
    const raw = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      window.dispatchEvent(event);
    };
    await act(async () => {
      raw("pointermove", 40, 40);
      raw("pointermove", 60, 60);
      raw("pointerup", 60, 60);
    });
    expect(
      within(screen.getByRole("list", { name: "S" })).getByRole("button", { name: "Anora" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".ghost")).toBeNull();
  });

  it("does nothing when let go outside every target, or on a right button", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} hitTest={hitTest} />
      </MemoryRouter>,
    );
    pointer("pointerdown", card("Anora"), 10, 10, { button: 2 });
    pointer("pointermove", window, 80, 80);
    expect(document.querySelector(".ghost")).toBeNull();

    pointer("pointerdown", card("Anora"), 10, 10, { button: 0 });
    pointer("pointermove", window, 80, 80);
    expect(document.querySelector(".ghost")).not.toBeNull();
    pointer("pointerup", window, 80, 80);
    expect(screen.getByText(/of 2 placed/)).toHaveTextContent("0 of 2 placed");
  });

  it("sends a placed card back to the pool when dropped there, and cancels cleanly", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} hitTest={hitTest} />
      </MemoryRouter>,
    );
    fireEvent.click(card("Conclave"));
    fireEvent.click(tierRow("A"));
    expect(screen.getByText(/of 2 placed/)).toHaveTextContent("1 of 2 placed");

    pointer("pointerdown", card("Conclave"), 10, 10, { button: 0 });
    under = poolBox();
    pointer("pointermove", window, 50, 300);
    expect(poolBox()).toHaveClass("pool--target");
    pointer("pointerup", window, 50, 300);
    expect(screen.getByText(/of 2 placed/)).toHaveTextContent("0 of 2 placed");

    pointer("pointerdown", card("Conclave"), 10, 10, { button: 0 });
    pointer("pointermove", window, 50, 300);
    pointer("pointercancel", window, 50, 300);
    expect(document.querySelector(".ghost")).toBeNull();
    expect(screen.getByText(/of 2 placed/)).toHaveTextContent("0 of 2 placed");
  });

  it("lets a finger scroll but drags after a hold", () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} hitTest={hitTest} />
      </MemoryRouter>,
    );
    pointer("pointerdown", card("Anora"), 10, 10, { button: 0, pointerType: "touch" });
    pointer("pointermove", window, 10, 40);
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_MS + 10);
    });
    expect(document.querySelector(".ghost")).toBeNull();

    under = tierRow("A");
    pointer("pointerdown", card("Anora"), 10, 10, { button: 0, pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_MS + 10);
    });
    expect(document.querySelector(".ghost")).not.toBeNull();
    const touchMove = new Event("touchmove", { bubbles: true, cancelable: true });
    window.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(true);

    pointer("pointermove", window, 12, 50);
    pointer("pointerup", window, 12, 50);
    expect(
      within(screen.getByRole("list", { name: "A" })).getByRole("button", { name: "Anora" }),
    ).toBeInTheDocument();
  });
});
