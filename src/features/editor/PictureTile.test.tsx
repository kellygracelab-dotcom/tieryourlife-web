import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundPicture } from "../../api/pictures";
import { PictureTile, TILE_WAIT_MS } from "./PictureTile";

const found: FoundPicture = {
  id: "web:1",
  title: "Borscht",
  subtitle: null,
  imageUrl: "https://img.test/borscht.jpg",
  thumbUrl: null,
  source: "web",
  kind: "web",
  credit: null,
  attribution: null,
};

/** Every picture in sight at once, as a browser says of the first row. */
class InSight {
  private readonly told: IntersectionObserverCallback;
  constructor(told: IntersectionObserverCallback) {
    this.told = told;
  }
  observe(target: Element) {
    this.told([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
  }
  disconnect() {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tile = () =>
  render(<PictureTile found={found} added={false} busy={false} onPick={() => undefined} />);

describe("PictureTile", () => {
  it("shimmers while its picture comes, then shows it", () => {
    const { container } = tile();
    const box = container.querySelector(".cards__pick-picture")!;
    expect(box).toHaveClass("cards__pick-picture--waiting");
    fireEvent.load(container.querySelector("img")!);
    expect(box).toHaveClass("cards__pick-picture--shown");
    expect(box).not.toHaveClass("cards__pick-picture--waiting");
  });

  it("goes when its picture fails, leaving no grey square", () => {
    const { container } = tile();
    fireEvent.error(container.querySelector("img")!);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("goes when its picture in sight has not come in time, and stays once it has", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", InSight);
    const { container } = tile();
    act(() => vi.advanceTimersByTime(TILE_WAIT_MS - 1));
    expect(screen.getByRole("button")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    const again = tile();
    fireEvent.load(again.container.querySelector("img")!);
    act(() => vi.advanceTimersByTime(TILE_WAIT_MS * 2));
    expect(again.container.querySelector("img")).not.toBeNull();
  });
});
