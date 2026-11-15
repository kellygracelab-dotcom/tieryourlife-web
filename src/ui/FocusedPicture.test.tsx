import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusedPicture } from "./FocusedPicture";

describe("FocusedPicture", () => {
  afterEach(() => vi.restoreAllMocks());

  it("covers its box as before without a focus, a wide picture in the middle", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 100,
    } as DOMRect);
    const { container } = render(<FocusedPicture src="https://img/c.jpg" focus={null} />);
    const picture = container.querySelector("img")!;
    expect(picture).toHaveAttribute("src", "https://img/c.jpg");
    Object.defineProperty(picture, "naturalWidth", { value: 1600 });
    Object.defineProperty(picture, "naturalHeight", { value: 900 });
    fireEvent.load(picture);
    expect(picture.style.position).toBe("");
  });

  it("shows a tall picture without a focus high, at y 0.35 (SPEC, second round)", () => {
    // A 16:10 tile, 160 × 100, over a 1000 × 1500 portrait: a frame 1000 × 625,
    // its middle 525 down, so it starts 212.5 down: 34% of its height above the box.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 100,
    } as DOMRect);
    const { container } = render(<FocusedPicture src="https://img/c.jpg" focus={null} />);
    const picture = container.querySelector("img")!;
    Object.defineProperty(picture, "naturalWidth", { value: 1000 });
    Object.defineProperty(picture, "naturalHeight", { value: 1500 });
    fireEvent.load(picture);
    expect(picture.style.top).toBe("-34%");
    expect(picture.style.position).toBe("absolute");
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
