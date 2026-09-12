import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("is a toggle that says whether it is pressed", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Chip onClick={onClick}>Newest</Chip>);
    const chip = screen.getByRole("button", { name: "Newest" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Chip selected icon="check">
        Newest
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
  });
});
