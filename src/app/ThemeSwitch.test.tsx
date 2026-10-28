import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_KEY } from "../lib/theme";
import { ThemeSwitch } from "./ThemeSwitch";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("ThemeSwitch", () => {
  it("offers Light, Dark and System in the app's order, System until a choice is made", () => {
    render(<ThemeSwitch />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const [light, dark, system, ...more] = screen.getAllByRole("radio");
    expect(more).toEqual([]);
    expect(light).toHaveAccessibleName("Light");
    expect(dark).toHaveAccessibleName("Dark");
    expect(system).toHaveAccessibleName("System");
    expect(system).toHaveAttribute("aria-checked", "true");
    // The chosen segment alone carries the check.
    expect(group.querySelectorAll(".theme__check")).toHaveLength(1);
    expect(system?.querySelector(".theme__check")).not.toBeNull();
  });

  it("moves the check to the choice, puts it on the page and keeps it", async () => {
    render(<ThemeSwitch />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("radio", { name: "Dark" }).querySelector(".theme__check"),
    ).not.toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");

    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
