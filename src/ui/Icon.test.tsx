import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("is decorative unless given a label", () => {
    const { container } = render(<Icon name="undo" className="big" />);
    const icon = container.querySelector("span");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("ms", "big");
    expect(icon).toHaveTextContent("undo");
  });

  it("marks the icons that point along the text, so they turn round right to left, and no others", () => {
    const { container } = render(
      <>
        <Icon name="undo" />
        <Icon name="open_in_new" />
        <Icon name="check" />
        <Icon name="search" />
      </>,
    );
    const mirrored = [...container.querySelectorAll(".ms--mirrored")].map((n) => n.textContent);
    expect(mirrored).toEqual(["undo", "open_in_new"]);
  });

  it("becomes an image with a name when labelled", () => {
    render(<Icon name="lock" label="Secure" />);
    expect(screen.getByRole("img", { name: "Secure" })).toHaveTextContent("lock");
  });
});
