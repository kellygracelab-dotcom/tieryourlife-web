import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardsEditor, TILE_RETRY_MS } from "./CardsEditor";

const items = [
  { key: "p1", title: "", imageUrl: "https://dl/p1?alt=media&token=t", pictureId: "p1" },
  { key: "c1", title: "Plain", imageUrl: "https://img/plain.jpg", pictureId: null },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("CardsEditor tiles", () => {
  it("asks once more for a picture that did not come, a moment later, and then lets it be", () => {
    render(
      <CardsEditor
        items={items}
        category={null}
        dispatch={() => {}}
        lookup={async () => []}
        upload={async () => ({ pictureId: "x", previewUrl: "https://dl/x" })}
      />,
    );
    const tile = screen.getByRole("img", { name: "Untitled card" });
    fireEvent.error(tile);
    expect(tile).toHaveAttribute("src", "https://dl/p1?alt=media&token=t");
    act(() => vi.advanceTimersByTime(TILE_RETRY_MS));
    expect(tile).toHaveAttribute("src", "https://dl/p1?alt=media&token=t&retry=1");

    fireEvent.error(tile);
    act(() => vi.advanceTimersByTime(TILE_RETRY_MS));
    expect(tile).toHaveAttribute("src", "https://dl/p1?alt=media&token=t&retry=1");

    const plain = screen.getByRole("img", { name: "Plain" });
    fireEvent.error(plain);
    act(() => vi.advanceTimersByTime(TILE_RETRY_MS));
    expect(plain).toHaveAttribute("src", "https://img/plain.jpg?retry=1");
  });
});
