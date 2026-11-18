import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardName, TileCaption, type FitName } from "./CardName";

describe("CardName", () => {
  it("draws the name at the size it was fitted to, breaking words only between them", () => {
    const fit = vi.fn<FitName>(() => ({ size: 8.5, hyphenate: false }));
    render(<CardName title="Ex Machina" board="small" fit={fit} />);
    const name = screen.getByText("Ex Machina");
    expect(fit).toHaveBeenCalledWith("Ex Machina", "small", "poster");
    expect(name).toHaveClass("tile__name");
    expect(name).toHaveStyle({ fontSize: "8.5px", hyphens: "manual" });
    expect(name.style.overflowWrap).toBe("");
  });

  it("lets a word too long even at the floor break with a hyphen, or without one rather than be cut", () => {
    render(
      <CardName
        title="Supercalifragilistic"
        board="medium"
        fit={() => ({ size: 9, hyphenate: true })}
      />,
    );
    const name = screen.getByText("Supercalifragilistic");
    expect(name).toHaveStyle({ hyphens: "auto" });
    expect(name.style.overflowWrap).toBe("break-word");
  });

  it("starts at the board's size and leans on hyphens where there is no canvas to measure on", () => {
    // jsdom has no OffscreenCanvas.
    render(<CardName title="Heat" board="large" />);
    expect(screen.getByText("Heat")).toHaveStyle({ fontSize: "11px", hyphens: "auto" });
  });

  it("fits a name on the board's name tile as the board's", () => {
    const fit = vi.fn<FitName>(() => ({ size: 12, hyphenate: false }));
    render(<CardName title="Moonlight" board="small" onBoard fit={fit} />);
    expect(fit).toHaveBeenCalledWith("Moonlight", "small", "board");
    expect(screen.getByText("Moonlight")).toHaveStyle({ fontSize: "12px" });
  });
});

describe("a pictured card's caption", () => {
  it("tells the board how wide its longest word is, so the type can keep it whole (QA 36)", () => {
    const widest = (title: string) => Math.max(...title.split(" ").map((word) => word.length * 5));
    const { container } = render(<TileCaption title="Interstellar" widest={widest} />);
    const caption = container.querySelector<HTMLElement>(".tile__caption")!;
    expect(caption).toHaveTextContent("Interstellar");
    // 9 px of type over a 60 px word.
    expect(caption.style.getPropertyValue("--caption-fit")).toBe("0.1500");
  });

  it("keeps the stylesheet's size without a canvas, and says nothing for a blank name", () => {
    const { container } = render(<TileCaption title="Dune" widest={() => null} />);
    expect(
      container.querySelector<HTMLElement>(".tile__caption")!.getAttribute("style"),
    ).toBeNull();
    const blank = render(<TileCaption title="  " widest={() => 10} />);
    expect(blank.container.querySelector(".tile__caption")).toBeNull();
  });
});
