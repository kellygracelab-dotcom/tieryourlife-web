import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListArt } from "./ListArt";

describe("ListArt", () => {
  it("shows the cover when there is one", () => {
    const { container } = render(
      <ListArt
        cover="https://img/cover.jpg"
        previews={["https://img/1.jpg"]}
        tierColors={["#000"]}
      />,
    );
    expect(container.querySelector(".art--cover img")).toHaveAttribute(
      "src",
      "https://img/cover.jpg",
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("falls back to a mosaic of at most six pictures", () => {
    const previews = Array.from({ length: 8 }, (_, i) => `https://img/${i}.jpg`);
    const { container } = render(<ListArt cover={null} previews={previews} tierColors={[]} />);
    expect(container.querySelector(".art--mosaic")).toHaveAttribute("data-count", "6");
    expect(container.querySelectorAll("img")).toHaveLength(6);
  });

  it("cuts each collage cell by the focus its card was given", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 150,
    } as DOMRect);
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        tierColors={[]}
        cellFocus={new Map([["https://img/a.jpg", { x: 0.5, y: 0, zoom: 1 }]])}
      />,
    );
    const cells = container.querySelectorAll<HTMLImageElement>(".art__cell img");
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      Object.defineProperty(cell, "naturalWidth", { value: 1000 });
      Object.defineProperty(cell, "naturalHeight", { value: 1500 });
      fireEvent.load(cell);
    }
    // Both posters are tall: the one placed at the top, the other at its default y 0.35.
    expect(cells[0]!.style.top).toBe("0%");
    expect(cells[1]!.style.top).not.toBe("0%");
    vi.restoreAllMocks();
  });

  it("cuts a published list's collage by the focus sent for each preview, by its place", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 150,
    } as DOMRect);
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        previewFocus={[null, { x: 0.5, y: 0, zoom: 1 }]}
        tierColors={[]}
      />,
    );
    const cells = container.querySelectorAll<HTMLImageElement>(".art__cell img");
    for (const cell of cells) {
      Object.defineProperty(cell, "naturalWidth", { value: 1000 });
      Object.defineProperty(cell, "naturalHeight", { value: 1500 });
      fireEvent.load(cell);
    }
    expect(cells[0]!.style.top).not.toBe("0%");
    expect(cells[1]!.style.top).toBe("0%");
    vi.restoreAllMocks();
  });

  // Night W7 (18.11.2026): a card whose picture fails shows its name on the board, and leaves the collage.
  it("leaves a picture that fails to load out of the collage, with no blank tile", () => {
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/gone.jpg", "https://img/b.jpg"]}
        tierColors={["#000"]}
      />,
    );
    expect(container.querySelector(".art--mosaic")).toHaveAttribute("data-count", "3");
    fireEvent.error(container.querySelectorAll("img")[1]!);
    expect(container.querySelector(".art--mosaic")).toHaveAttribute("data-count", "2");
    expect(Array.from(container.querySelectorAll("img"), (img) => img.getAttribute("src"))).toEqual(
      ["https://img/a.jpg", "https://img/b.jpg"],
    );
    // Every one gone: the tier colours, as for a list without pictures.
    for (const img of Array.from(container.querySelectorAll("img"))) fireEvent.error(img);
    expect(container.querySelector(".art--stripes")).not.toBeNull();
  });

  it("falls back to a titled tile with at most five tier colours along the bottom", () => {
    render(
      <ListArt
        cover={null}
        previews={[]}
        tierColors={["#b03a32", "#c06a25", "#a98b1f", "#3f7f55", "#3c6e99", "#000000"]}
        title="Every A24 film, ranked"
      />,
    );
    const tile = screen.getByRole("img", { name: "Every A24 film, ranked" });
    expect(tile).toHaveClass("art--titled");
    expect(tile.querySelector(".art__title")).toHaveTextContent("Every A24 film, ranked");
    expect(tile.querySelectorAll(".art__bars span")).toHaveLength(5);
    expect(tile.querySelectorAll(".art__bars span")[0]).toHaveStyle({ backgroundColor: "#b03a32" });
    // B's old olive is drawn as the new gold (artboard 54).
    expect(tile.querySelectorAll(".art__bars span")[2]).toHaveStyle({ backgroundColor: "#B88A00" });
  });

  it("is a bare tile when a list has nothing at all, not even a title", () => {
    render(<ListArt cover={null} previews={[]} tierColors={[]} />);
    const tile = screen.getByRole("img", { name: "No picture" });
    expect(tile).toHaveClass("art--titled");
    expect(tile.querySelector(".art__title")).toBeNull();
    expect(tile.querySelector(".art__bars")).toBeNull();
  });
});
