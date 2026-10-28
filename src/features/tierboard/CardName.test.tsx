import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardName, type FitName } from "./CardName";

describe("CardName", () => {
  it("draws the name at the size it was fitted to, breaking words only between them", () => {
    const fit = vi.fn<FitName>(() => ({ size: 8.5, hyphenate: false }));
    render(<CardName title="Ex Machina" board="small" fit={fit} />);
    const name = screen.getByText("Ex Machina");
    expect(fit).toHaveBeenCalledWith("Ex Machina", "small");
    expect(name).toHaveClass("tile__name");
    expect(name).toHaveStyle({ fontSize: "8.5px", hyphens: "manual" });
  });

  it("lets a word too long even at the floor break with a hyphen", () => {
    render(
      <CardName
        title="Supercalifragilistic"
        board="medium"
        fit={() => ({ size: 9, hyphenate: true })}
      />,
    );
    expect(screen.getByText("Supercalifragilistic")).toHaveStyle({ hyphens: "auto" });
  });

  it("starts at the board's size and leans on hyphens where there is no canvas to measure on", () => {
    // jsdom has no OffscreenCanvas.
    render(<CardName title="Heat" board="large" />);
    expect(screen.getByText("Heat")).toHaveStyle({ fontSize: "11px", hyphens: "auto" });
  });
});
