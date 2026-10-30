import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlayButton } from "./PlayButton";

describe("the Play button", () => {
  it("plays", async () => {
    const onClick = vi.fn();
    render(<PlayButton onClick={onClick} disabled={false} saved={false} />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button).not.toHaveAttribute("aria-disabled");
    // Nothing to say beyond its name. (The test library reads the tooltip as a description
    // even when it is the name; a browser does not, so ask for the reference itself.)
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(button.querySelector(".play-button__dot")).toBeNull();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays reachable below three cards, says why, and does nothing", async () => {
    const onClick = vi.fn();
    render(<PlayButton onClick={onClick} disabled saved={false} />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "Play needs at least 3 cards.");
    expect(button).toHaveAccessibleDescription("Play needs at least 3 cards.");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    // Unlike a disabled button, it can still be reached, and its reason read.
    button.blur();
    await userEvent.tab();
    expect(button).toHaveFocus();
  });

  it("wears the badge while a game is saved, and says so", () => {
    render(<PlayButton onClick={vi.fn()} disabled={false} saved />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button.querySelector(".play-button__dot")).not.toBeNull();
    expect(button).toHaveAccessibleDescription("A game is saved.");
  });

  it("is named Play and says it as a tooltip, whether its word shows or only the icon", () => {
    render(<PlayButton onClick={vi.fn()} disabled={false} saved={false} />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("title", "Play");
    expect(button).toHaveTextContent("play_arrow");
    // The word is the one below 840 hides: the name stays on the button itself.
    expect(button.querySelector(".play-button__word")).toHaveAttribute("aria-hidden", "true");
  });
});
