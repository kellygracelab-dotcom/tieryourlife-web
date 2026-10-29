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
    expect(button).not.toHaveAccessibleDescription();
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

  it("wears a dot while a game is saved, and says so", () => {
    render(<PlayButton onClick={vi.fn()} disabled={false} saved />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button.querySelector(".play-button__dot")).not.toBeNull();
    expect(button).toHaveAccessibleDescription("A game is saved.");
  });

  it("is named Play as an icon alone", () => {
    render(<PlayButton onClick={vi.fn()} disabled={false} saved={false} iconOnly />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveClass("play-button--icon");
    expect(button).toHaveTextContent("play_arrow");
  });
});
