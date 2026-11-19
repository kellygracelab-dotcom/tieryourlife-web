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

  it("draws each ready colour in two tones of its light palette, and one's own as the wheel", async () => {
    const { rolesFor } = await import("../../lib/palette");
    render(<ColourPicker signedIn={false} />);
    const disc = (name: string) => radio(name).querySelector<HTMLElement>(".colour__disc")!;
    await waitFor(() =>
      expect(disc(strings.colour.matcha).style.getPropertyValue("--swatch-primary")).toBe(
        rolesFor("matcha", false).primary,
      ),
    );
    expect(disc(strings.colour.matcha).style.getPropertyValue("--swatch-container")).toBe(
      rolesFor("matcha", false).primaryContainer,
    );
    expect(disc(strings.colour.lavender).style.getPropertyValue("--swatch-primary")).toBe(
      "#4A5BAA",
    );
    expect(radio(strings.colour.custom)).toHaveClass("colour__swatch--wheel");
    // The chosen one carries the check; one's own always carries the pencil.
    expect(radio(strings.colour.lavender).querySelector(".colour__mark")).not.toBeNull();
    expect(radio(strings.colour.matcha).querySelector(".colour__mark")).toBeNull();
    expect(radio(strings.colour.custom).querySelector(".colour__mark")).not.toBeNull();
  });

  it("opens the slider on the hue the site is drawn in, and paints Done in the hue's button", async () => {
    const { rolesOf } = await import("../../lib/palette");
    render(<ColourPicker signedIn={false} />);
    await userEvent.click(radio(strings.colour.custom));
    expect(screen.getByRole("slider", { name: strings.colour.hue })).toHaveValue("265");
    await userEvent.click(screen.getByRole("button", { name: strings.colour.cancel }));

    await userEvent.click(radio(strings.colour.sky));
    await userEvent.click(radio(strings.colour.custom));
    expect(screen.getByRole("slider", { name: strings.colour.hue })).toHaveValue("220");
    const dialog = screen.getByRole("dialog", { name: strings.colour.yourColour });
    await waitFor(() =>
      expect(dialog.style.getPropertyValue("--own-button")).toBe(rolesOf(220, false).primary),
    );
    fireEvent.change(screen.getByRole("slider", { name: strings.colour.hue }), {
      target: { value: "30" },
    });
    expect(dialog.style.getPropertyValue("--own-button")).toBe(rolesOf(30, false).primary);
    await userEvent.click(screen.getByRole("button", { name: strings.colour.done }));

    // Chosen, one's own is two tones of its hue, and the slider comes back to it.
    await waitFor(() =>
      expect(radio(strings.colour.custom)).not.toHaveClass("colour__swatch--wheel"),
    );
    expect(
      radio(strings.colour.custom)
        .querySelector<HTMLElement>(".colour__disc")!
        .style.getPropertyValue("--swatch-primary"),
    ).toBe(rolesOf(30, false).primary);
    await userEvent.click(radio(strings.colour.custom));
    expect(screen.getByRole("slider", { name: strings.colour.hue })).toHaveValue("30");
  });

  it("draws the little sheet in the dark palette when the site is dark", async () => {
    const { rolesOf } = await import("../../lib/palette");
    document.documentElement.dataset.theme = "dark";
    try {
      render(<ColourPicker signedIn={false} />);
      await userEvent.click(radio(strings.colour.custom));
      const dialog = screen.getByRole("dialog", { name: strings.colour.yourColour });
      await waitFor(() =>
        expect(dialog.style.getPropertyValue("--own-paper")).toBe(rolesOf(265, true).surface),
      );
      expect(dialog.style.getPropertyValue("--own-button")).toBe(rolesOf(265, true).primary);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });
});
