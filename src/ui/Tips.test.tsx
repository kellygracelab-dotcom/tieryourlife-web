import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type KeyValueStore } from "../lib/storage";
import {
  TIPS_KEY,
  tipsAgain,
  tipSeen,
  tipsOff,
  tipWanted,
  useTipsStoreForTests,
} from "./tipMemory";
import { TIP_DELAY_MS, TIP_RING, Tips } from "./Tips";

let store: KeyValueStore;

beforeEach(() => {
  store = memoryStore();
  useTipsStoreForTests(store);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  useTipsStoreForTests(null);
});

/** A page with the places named, and the tips over it. */
function page(places: { tip: string; n?: number; keys?: string; ranked?: boolean }[]) {
  return render(
    <>
      {places.map(({ tip, n, keys, ranked }) => (
        <button
          key={tip}
          type="button"
          data-tip={tip}
          data-tip-n={n}
          data-tip-keys={keys}
          data-tip-ranked={ranked ? "true" : undefined}
        >
          {tip}
        </button>
      ))}
      <Tips />
    </>,
  );
}

const wait = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(TIP_DELAY_MS + 10);
  });

describe("the newcomer's tips", () => {
  it("comes a moment after its place, is read out, rings its element, and is shown once", async () => {
    page([{ tip: "place", keys: "1–5" }]);
    expect(screen.queryByRole("status")).toBeNull();
    await wait();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Start here: tap a card, then the tier it belongs in. Or drag it there.",
    );
    expect(screen.getByRole("button", { name: "place" })).toHaveClass(TIP_RING);
    // The focus stays where it was.
    expect(document.activeElement).toBe(document.body);
    expect(tipWanted("place")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "place" })).not.toHaveClass(TIP_RING);
    await wait();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the number keys where there is a mouse and a keyboard", async () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMedia);
    page([{ tip: "place", keys: "1–5" }]);
    await wait();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Start here: pick a card, then a tier — or press 1–5. Dragging works too.",
    );
    vi.unstubAllGlobals();
  });

  it("is a strip at the window's foot on a computer as on a phone, its buttons kept and its element ringed", async () => {
    // A computer's window: a mouse, and wider than a phone (walkthrough of 25.11, item 4).
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("hover: hover") }));
    vi.stubGlobal("matchMedia", matchMedia);
    page([{ tip: "add" }]);
    await wait();
    const tip = screen.getByRole("status").closest(".tip");
    expect(tip).toHaveAttribute("data-tip-for", "add");
    // Set over the foot, not beside its element: no screen position of its own.
    expect(tip).toHaveStyle({ "--tip-lift": "8px" });
    expect(tip).not.toHaveStyle({ visibility: "hidden" });
    expect((tip as HTMLElement).style.left).toBe("");
    expect((tip as HTMLElement).style.top).toBe("");
    expect(screen.getByRole("button", { name: "add" })).toHaveClass(TIP_RING);
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No more tips" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    vi.unstubAllGlobals();
  });

  it("offers Play for a ranking of one's own where every card is already placed", async () => {
    // Someone's ranked list has nothing left to place by hand (Designer, 360-430, 26.11).
    page([{ tip: "play", n: 219, ranked: true }]);
    await wait();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Rank these your way? Play: pick the better of two.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(/by hand/);
  });

  it("shows one at a time, in their order, and the next only once the first is gone", async () => {
    const view = page([{ tip: "add" }, { tip: "play", n: 25 }]);
    await wait();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Rather not place 25 by hand? Play: pick the better of two and the tiers fill in.",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // Escape closes it; the next comes after its moment.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    await wait();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Type a name — the picture comes with it.",
    );
    // A press anywhere else closes it too.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });

  it("goes by itself when its place does, and No more tips stops them all", async () => {
    const view = page([{ tip: "place" }]);
    await wait();
    expect(screen.getByRole("status")).toBeInTheDocument();
    view.rerender(<Tips />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();

    page([{ tip: "add" }, { tip: "play", n: 9 }]);
    await wait();
    fireEvent.click(screen.getByRole("button", { name: "No more tips" }));
    expect(screen.queryByRole("status")).toBeNull();
    await wait();
    expect(screen.queryByRole("status")).toBeNull();
    expect(tipWanted("add")).toBe(false);
  });

  it("remembers on this device, and Show the tips again brings all three back", () => {
    tipSeen("place");
    tipsOff();
    expect(JSON.parse(store.read(TIPS_KEY) ?? "")).toEqual({ off: true, seen: ["place"] });
    expect(tipWanted("play")).toBe(false);
    tipsAgain();
    expect(store.read(TIPS_KEY)).toBeNull();
    expect(["place", "play", "add"].every((id) => tipWanted(id as "place"))).toBe(true);
    // What is not ours to read is nobody's word.
    store.write(TIPS_KEY, "{not json");
    expect(tipWanted("add")).toBe(true);
  });
});
