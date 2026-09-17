import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    expect(tile.querySelectorAll(".art__bars span")[0]).toHaveStyle({ background: "#b03a32" });
  });

  it("is a bare tile when a list has nothing at all, not even a title", () => {
    render(<ListArt cover={null} previews={[]} tierColors={[]} />);
    const tile = screen.getByRole("img", { name: "No picture" });
    expect(tile).toHaveClass("art--titled");
    expect(tile.querySelector(".art__title")).toBeNull();
    expect(tile.querySelector(".art__bars")).toBeNull();
  });
});
