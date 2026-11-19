import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readColour, useColourStoreForTests } from "../../lib/colourTheme";
import { memoryStore } from "../../lib/storage";
import { strings } from "../../strings";
import { ColourPicker } from "./ColourPicker";

beforeEach(() => useColourStoreForTests(memoryStore()));
afterEach(() => {
  document.getElementById("tyl-colour")?.remove();
  useColourStoreForTests(null);
});

const radio = (name: string) => screen.getByRole("radio", { name });

describe("the colour picker", () => {
  it("offers Lavender, Matcha, Peach, Sky and one's own, Lavender first chosen", () => {
    render(<ColourPicker signedIn={false} />);
    expect(screen.getAllByRole("radio").map((one) => one.getAttribute("aria-label"))).toEqual([
      strings.colour.lavender,
      strings.colour.matcha,
      strings.colour.peach,
      strings.colour.sky,
      strings.colour.custom,
    ]);
    expect(radio(strings.colour.lavender)).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(strings.colour.follows, { exact: false })).toBeNull();
  });

  it("recolours at once on a press, without Apply", async () => {
    render(<ColourPicker signedIn />);
    await userEvent.click(radio(strings.colour.matcha));
    expect(radio(strings.colour.matcha)).toHaveAttribute("aria-checked", "true");
    expect(readColour()?.name).toBe("matcha");
    await waitFor(() => expect(document.getElementById("tyl-colour")).not.toBeNull());
    expect(screen.getByText(strings.colour.follows, { exact: false })).toBeInTheDocument();
  });

  it("takes one's own hue on Done, and leaves the colour on Cancel", async () => {
    render(<ColourPicker signedIn={false} />);
    await userEvent.click(radio(strings.colour.custom));
    const dialog = screen.getByRole("dialog", { name: strings.colour.yourColour });
    fireEvent.change(screen.getByRole("slider", { name: strings.colour.hue }), {
      target: { value: "200" },
    });
    await userEvent.click(screen.getByRole("button", { name: strings.colour.cancel }));
    expect(dialog).not.toBeInTheDocument();
    expect(readColour()).toBeNull();

    await userEvent.click(radio(strings.colour.custom));
    fireEvent.change(screen.getByRole("slider", { name: strings.colour.hue }), {
      target: { value: "200" },
    });
    await userEvent.click(screen.getByRole("button", { name: strings.colour.done }));
    expect(readColour()).toMatchObject({ name: "custom", hue: 200 });
    expect(radio(strings.colour.custom)).toHaveAttribute("aria-checked", "true");
  });
});
