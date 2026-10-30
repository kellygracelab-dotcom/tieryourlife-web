import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { darkOf, hexOfHueTone } from "./colour";
import { TIER_PRESETS } from "./model";
import { TierColours } from "./TierColours";

/** The colours as a dialog holds them, and every change it was told of. */
const Holder = ({
  light,
  dark,
  onChange,
}: {
  light: string;
  dark: string;
  onChange: (light: string, dark: string) => void;
}) => {
  const [colours, setColours] = useState({ light, dark });
  return (
    <TierColours
      colorLight={colours.light}
      colorDark={colours.dark}
      onChange={(l, d) => {
        onChange(l, d);
        setColours({ light: l, dark: d });
      }}
    />
  );
};

const shown = (light: string, dark: string) => {
  const onChange = vi.fn<(light: string, dark: string) => void>();
  render(<Holder light={light} dark={dark} onChange={onChange} />);
  return onChange;
};

// jsdom has no PointerEvent: a pointer is a mouse event under its name.
const press = (target: Element, type: string, x: number, y: number, buttons = 1) =>
  fireEvent(
    target,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons }),
  );

describe("TierColours", () => {
  it("ticks the preset in use, and takes another with its dark pair", async () => {
    const [first, second] = TIER_PRESETS;
    const onChange = shown(first!.light, first!.dark);
    expect(screen.getByRole("button", { name: first!.light })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("slider")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: second!.light }));
    expect(onChange).toHaveBeenLastCalledWith(second!.light, second!.dark);
    expect(screen.getByRole("button", { name: second!.light })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens one's own colour: the picker's arrows and the hex set the light, the dark follows", async () => {
    const [first] = TIER_PRESETS;
    const onChange = shown(first!.light, first!.dark);
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-expanded", "true");
    const picker = screen.getByRole("slider", { name: "Light colour" });
    picker.focus();
    await userEvent.keyboard("{ArrowRight}");
    const [light, dark] = onChange.mock.lastCall!;
    expect(light).not.toBe(first!.light);
    expect(dark).toBe(darkOf(light));
    // The hex keeps in step with the picker, and a typed one is taken on Enter.
    const hex = screen.getByRole("textbox", { name: "Light hex" });
    expect(hex).toHaveValue(light);
    await userEvent.clear(hex);
    await userEvent.type(hex, "#336699{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("#336699", darkOf("#336699"));
    // Anything else snaps back when the field is left.
    await userEvent.clear(hex);
    await userEvent.type(hex, "blue");
    await userEvent.tab();
    expect(hex).toHaveValue("#336699");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    // Up and down change the tone, other keys nothing.
    const calls = onChange.mock.calls.length;
    picker.focus();
    await userEvent.keyboard("{ArrowUp}{ArrowDown}{ArrowLeft}a");
    expect(onChange.mock.calls.length).toBe(calls + 3);
  });

  it("picks a colour where the picker is pressed and dragged, hue across and tone down", () => {
    const onChange = shown("#336699", darkOf("#336699"));
    // One's own colour opens with the picker already out.
    const picker = screen.getByRole("slider", { name: "Light colour" });
    const box = vi.spyOn(picker, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 360,
      height: 100,
      right: 360,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    onTestFinished(() => box.mockRestore());
    press(picker, "pointerdown", 120, 0);
    expect(onChange).toHaveBeenLastCalledWith(hexOfHueTone(120, 85), darkOf(hexOfHueTone(120, 85)));
    press(picker, "pointermove", 240, 100);
    expect(onChange.mock.lastCall?.[0]).toBe(hexOfHueTone(240, 20));
    // A move with no button held is only a hover.
    press(picker, "pointermove", 0, 50, 0);
    expect(onChange.mock.lastCall?.[0]).toBe(hexOfHueTone(240, 20));
  });

  it("sets the dark colour apart on asking, and keeps it when the light one changes", async () => {
    const onChange = shown("#336699", darkOf("#336699"));
    await userEvent.click(screen.getByRole("button", { name: "Set dark colour separately" }));
    const darkHex = screen.getByRole("textbox", { name: "Dark hex" });
    await userEvent.clear(darkHex);
    await userEvent.type(darkHex, "#aabbcc{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("#336699", "#AABBCC");
    const lightHex = screen.getByRole("textbox", { name: "Light hex" });
    await userEvent.clear(lightHex);
    await userEvent.type(lightHex, "#224466{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("#224466", "#AABBCC");
  });

  it("opens with the dark colour apart when it is not the light one's own", () => {
    shown("#336699", "#AABBCC");
    expect(screen.getByRole("textbox", { name: "Dark hex" })).toHaveValue("#AABBCC");
    expect(screen.queryByRole("button", { name: "Set dark colour separately" })).toBeNull();
  });

  it("says so when the letter would be hard to read on either colour", () => {
    const [first] = TIER_PRESETS;
    shown(first!.light, first!.dark);
    expect(screen.queryByText("The letter may be hard to read on this colour.")).toBeNull();
    render(<Holder light="#FFEE88" dark={darkOf("#FFEE88")} onChange={() => undefined} />);
    expect(screen.getByText("The letter may be hard to read on this colour.")).toBeInTheDocument();
  });
});
