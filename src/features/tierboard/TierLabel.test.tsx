import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { estimateMeasure } from "../../lib/textFit";
import { BAND_TYPE, fitLabel } from "./bandFit";
import { TierCaption, TierLabel } from "./TierLabel";

// Letters 0.6 of the size wide, as Roboto's are.
const measure = estimateMeasure;

describe("TierLabel", () => {
  it("keeps a letter at the band's own size, set by the stylesheet", () => {
    render(<TierLabel label="S" caption={null} band="large" measure={measure} />);
    expect(screen.getByText("S")).toHaveClass("tier__label");
    expect(screen.getByText("S").getAttribute("style")).toBeNull();
  });

  it("makes the type smaller for a word the phone's band cannot hold, rather than cut it", () => {
    render(<TierLabel label="Great" caption={null} band="small" measure={measure} />);
    const label = screen.getByText("Great");
    const size = parseFloat(label.style.fontSize);
    expect(size).toBeLessThan(BAND_TYPE.small.start);
    expect(5 * 0.6 * size).toBeLessThanOrEqual(BAND_TYPE.small.width);
    // Broken between words only.
    expect(label.style.hyphens).toBe("manual");
  });

  it("gives a long name smaller type on every board size, and less beside a caption", () => {
    const name = "The very best films I have ever seen";
    for (const size of ["small", "medium", "large"] as const) {
      const alone = fitLabel(name, null, BAND_TYPE[size], measure);
      const captioned = fitLabel(name, "Watch again soon", BAND_TYPE[size], measure);
      expect(alone.broken).toBe(false);
      expect(alone.size).toBeLessThan(BAND_TYPE[size].start);
      expect(captioned.size).toBeLessThanOrEqual(alone.size);
    }
  });

  it("hyphenates only a word too long even at the smallest size", () => {
    render(
      <TierLabel
        label="Supercalifragilisticexpialidocious"
        caption={null}
        band="medium"
        measure={measure}
      />,
    );
    const label = screen.getByText("Supercalifragilisticexpialidocious");
    expect(label.style.fontSize).toBe(`${BAND_TYPE.medium.floor}px`);
    expect(label.style.hyphens).toBe("auto");
  });
});

describe("TierCaption", () => {
  // Every letter as wide as half the type's size.
  const halves = (text: string, size: number) => text.length * size * 0.5;

  it("keeps a caption whose every word fits at the band's size", () => {
    render(<TierCaption caption="so good" band="medium" measure={halves} />);
    expect(screen.getByText("so good")).not.toHaveAttribute("style");
  });

  it("makes a word wider than the band smaller instead of breaking it (QA 24)", () => {
    render(<TierCaption caption="Masterpieces" band="medium" measure={halves} />);
    const caption = screen.getByText("Masterpieces");
    // 66 at 11 on a 64 band; 60 at 10 fits it whole.
    expect(caption.style.fontSize).toBe("10px");
    expect(caption.style.overflowWrap).toBe("normal");
  });

  it("breaks only a word too long even at the floor", () => {
    render(<TierCaption caption="Supercalifragilistic" band="medium" measure={halves} />);
    const caption = screen.getByText("Supercalifragilistic");
    expect(caption.style.fontSize).toBe("8px");
    expect(caption.style.overflowWrap).toBe("anywhere");
  });
});
