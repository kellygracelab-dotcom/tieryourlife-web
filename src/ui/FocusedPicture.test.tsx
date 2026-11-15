import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusedPicture } from "./FocusedPicture";

describe("FocusedPicture", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the plain covering picture without a focus, or with the middle", () => {
    const { container, rerender } = render(<FocusedPicture src="https://img/c.jpg" focus={null} />);
    expect(container.querySelector(".focused-picture")).toBeNull();
    rerender(<FocusedPicture src="https://img/c.jpg" focus={{ x: 0.5, y: 0.5, zoom: 1 }} />);
    expect(container.querySelector(".focused-picture")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", "https://img/c.jpg");
  });

  it("cuts the picture by the shared formula for its box's shape, its class on the box", () => {
    // A 16:10 tile, 160 × 100.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 100,
    } as DOMRect);
    const { container } = render(
      <FocusedPicture
        src="https://img/c.jpg"
        className="topic-art"
        focus={{ x: 0.5, y: 0.15, zoom: 1 }}
      />,
    );
    const box = container.querySelector(".focused-picture");
    expect(box).toHaveClass("topic-art");
    const picture = container.querySelector("img")!;
    expect(picture).not.toHaveClass("topic-art");
    // A 1000 × 1500 portrait: the frame is the whole width, 625 high, from the top.
    Object.defineProperty(picture, "naturalWidth", { value: 1000 });
    Object.defineProperty(picture, "naturalHeight", { value: 1500 });
    fireEvent.load(picture);
    expect(picture.style.left).toBe("0%");
    expect(picture.style.top).toBe("0%");
    expect(picture.style.width).toBe("100%");
    expect(picture.style.height).toBe("240%");
    expect(picture.style.position).toBe("absolute");
  });
});
