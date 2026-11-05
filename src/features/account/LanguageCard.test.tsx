import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { localeInAddress } from "../../lib/locale";
import { type KeyValueStore, memoryStore } from "../../lib/storage";
import { keepAndReload, LanguageCard } from "./LanguageCard";

describe("LanguageCard", () => {
  it("is not there while the site speaks one language", () => {
    const { container } = render(<LanguageCard locales={["en"]} current="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers each language under its own name and marks the one in use", () => {
    render(<LanguageCard locales={["en", "uk", "ar"]} current="uk" />);
    const group = screen.getByRole("radiogroup", { name: "Language" });
    const names = within(group)
      .getAllByRole("radio")
      .map((radio) => radio.textContent);
    expect(names).toEqual(["English", "Українськаcheck", "العربية"]);
    expect(within(group).getByRole("radio", { name: /Українська/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "English" })).not.toBeChecked();
    // A name is read out in its own language, not spelled in English.
    expect(within(group).getByRole("radio", { name: "العربية" })).toHaveAttribute("lang", "ar");
  });

  it("hands over the language pressed, and leaves the one in use alone", async () => {
    const choose = vi.fn();
    render(<LanguageCard locales={["en", "uk"]} current="en" choose={choose} />);
    await userEvent.click(screen.getByRole("radio", { name: /English/ }));
    expect(choose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: "Українська" }));
    expect(choose).toHaveBeenCalledExactlyOnceWith("uk");
  });

  it("reloads into a language kept on the device, and asks for it in the address when nothing is kept", () => {
    const go = vi.fn();
    keepAndReload("de", memoryStore(), go);
    expect(go).toHaveBeenCalledExactlyOnceWith(null);

    go.mockClear();
    const blocked: KeyValueStore = { read: () => null, write: () => false, remove: () => {} };
    keepAndReload("de", blocked, go);
    const address = new URL(go.mock.calls[0]![0] as string);
    expect(address.pathname).toBe(window.location.pathname);
    expect(localeInAddress(address.search)).toBe("de");
  });
});
