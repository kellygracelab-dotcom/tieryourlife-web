import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("takes the size it is given and stays out of the accessibility tree", () => {
    const { container } = render(<Skeleton width="64px" height="90px" className="tile" />);
    const bone = container.querySelector("span");
    expect(bone).toHaveAttribute("aria-hidden", "true");
    expect(bone).toHaveClass("skeleton", "tile");
    expect(bone).toHaveStyle({ width: "64px", height: "90px" });
  });

  it("fills its line by default", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector("span")).toHaveAttribute("style", "width: 100%; height: 1em;");
  });
});
