import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("is a busy progress bar named for what it waits for", () => {
    render(<Spinner label="Anime" className="extra" />);
    const ring = screen.getByRole("progressbar", { name: "Anime" });
    expect(ring).toHaveAttribute("aria-busy", "true");
    expect(ring).toHaveClass("spinner", "extra");
  });
});
