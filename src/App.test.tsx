import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("opens on the front page inside the shell", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "TierYourLife" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Rank anything, or take someone else's list and rank it your way.",
    );
  });
});
