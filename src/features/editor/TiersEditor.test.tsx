import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIERS, type EditorAction, type EditorTier } from "./model";
import { TiersEditor } from "./TiersEditor";

const tiers: EditorTier[] = DEFAULT_TIERS.map((tier, i) => ({ ...tier, key: `t${i}` }));
const dispatch = vi.fn<(action: EditorAction) => void>();

// jsdom has no PointerEvent and no layout; the rows are laid out by hand,
// 40 px each, top to bottom.
const pointer = (type: string, target: Element | Window, y: number, button = 0) =>
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button }));

beforeEach(() => {
  dispatch.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const row = this.closest("li");
    const index = row === null ? 0 : [...row.parentElement!.children].indexOf(row);
    return { top: index * 40, bottom: index * 40 + 40 } as DOMRect;
  });
});

afterEach(() => vi.restoreAllMocks());

describe("TiersEditor drag", () => {
  it("lifts a row by its handle and places it where the pointer crosses the others", () => {
    render(<TiersEditor tiers={tiers} dispatch={dispatch} />);
    const handle = screen.getByTitle("Drag S to reorder");
    pointer("pointerdown", handle, 20);
    expect(handle.closest("li")).toHaveClass("tiers__row--lifted");

    pointer("pointermove", window, 50);
    expect(dispatch).not.toHaveBeenCalled();
    pointer("pointermove", window, 105);
    expect(dispatch).toHaveBeenCalledWith({ type: "placeTier", key: "t0", index: 2 });

    pointer("pointerup", window, 105);
    expect(handle.closest("li")).not.toHaveClass("tiers__row--lifted");
    pointer("pointermove", window, 150);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps following the pointer after the row has moved in the list", () => {
    const { rerender } = render(<TiersEditor tiers={tiers} dispatch={dispatch} />);
    pointer("pointerdown", screen.getByTitle("Drag S to reorder"), 20);
    pointer("pointermove", window, 65);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "placeTier", key: "t0", index: 1 });

    const swapped = [tiers[1]!, tiers[0]!, ...tiers.slice(2)];
    rerender(<TiersEditor tiers={swapped} dispatch={dispatch} />);
    expect(screen.getByTitle("Drag S to reorder").closest("li")).toHaveClass("tiers__row--lifted");
    pointer("pointermove", window, 105);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "placeTier", key: "t0", index: 2 });
  });

  it("ignores any button but the main one", () => {
    render(<TiersEditor tiers={tiers} dispatch={dispatch} />);
    const s = screen.getByTitle("Drag S to reorder");
    pointer("pointerdown", s, 20, 2);
    expect(s.closest("li")).not.toHaveClass("tiers__row--lifted");
    pointer("pointermove", window, 150);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
