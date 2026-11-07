import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardName, type FitName } from "./CardName";

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

  it("fits a name on the board's wider tile as wide", () => {
    const fit = vi.fn<FitName>(() => ({ size: 12, hyphenate: false }));
    render(<CardName title="Moonlight" board="small" wide fit={fit} />);
    expect(fit).toHaveBeenCalledWith("Moonlight", "small", "wide");
    expect(screen.getByText("Moonlight")).toHaveStyle({ fontSize: "12px" });
  });
});
