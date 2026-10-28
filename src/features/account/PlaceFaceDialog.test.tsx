import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceFaceDialog, type FaceSource, type Placed } from "./PlaceFaceDialog";

const CARD: FaceSource = { kind: "card", url: "https://img/poster.jpg" };

// jsdom lays nothing out and draws no picture: the circle is 240 px wide with
// its corner at (100, 100), and a picture "loads" at the size a test gives it.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
});
afterAll(() => {
  delete (Element.prototype as Partial<Element>).setPointerCapture;
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 240,
    height: 240,
  } as DOMRect);
  return () => vi.restoreAllMocks();
});

const open = (source: FaceSource = CARD) => {
  const onCancel = vi.fn();
  const onUse = vi.fn<(placed: Placed | null) => void>();
  const onUnreadable = vi.fn();
  render(
    <PlaceFaceDialog
      source={source}
      onCancel={onCancel}
      onUse={onUse}
      onUnreadable={onUnreadable}
    />,
  );
  return { onCancel, onUse, onUnreadable };
};

const frame = () => screen.getByRole("application", { name: "The picture to place in the circle" });
const picture = () => frame().querySelector("img")!;
const confirmButton = () => screen.getByRole("button", { name: "Use this" });

function load(width: number, height: number) {
  const img = picture();
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
}

/** Where the picture is drawn, in percent of the circle. */
const box = () => {
  const { left, top, width, height } = picture().style;
  return {
    left: parseFloat(left),
    top: parseFloat(top),
    width: parseFloat(width),
    height: parseFloat(height),
  };
};

/** The picture still covers the whole circle: no gap at any edge. */
const covers = () => {
  const { left, top, width, height } = box();
  return left <= 1e-9 && top <= 1e-9 && left + width >= 100 - 1e-9 && top + height >= 100 - 1e-9;
};

describe("PlaceFaceDialog", () => {
  it("shows the picture behind the circle once it is there, and hands back the middle square", async () => {
    const { onUse } = open();
    expect(screen.getByRole("dialog", { name: "Place your face" })).toBeInTheDocument();
    expect(frame()).toHaveFocus();
    expect(frame()).toHaveAccessibleDescription("Drag to move, pinch or scroll to zoom.");
    // Asked for so the page may cut it.
    expect(picture()).toHaveAttribute("src", CARD.url);
    expect(picture()).toHaveAttribute("crossorigin", "anonymous");
    expect(picture()).toHaveClass("placing__picture--waiting");
    expect(confirmButton()).toBeDisabled();

    load(1000, 500);
    expect(picture()).not.toHaveClass("placing__picture--waiting");
    expect(box()).toEqual({ left: -50, top: 0, width: 200, height: 100 });
    await userEvent.click(confirmButton());
    expect(onUse).toHaveBeenCalledWith({
      picture: picture(),
      square: { left: 250, top: 0, side: 500 },
      moved: false,
    });
  });

  it("moves 8 px a press with the arrows and 32 with Shift, zooms a tenth with + and −, and keeps the circle covered", async () => {
    const { onUse } = open();
    load(400, 400);
    const user = userEvent.setup();

    // A square picture at its first size has nowhere to go.
    await user.keyboard("{ArrowRight}");
    expect(box()).toEqual({ left: 0, top: 0, width: 100, height: 100 });

    await user.keyboard("+");
    expect(box().width).toBeCloseTo(110);
    await user.keyboard("-");
    expect(box().width).toBeCloseTo(100);

    await user.keyboard("+++++++");
    const zoomed = box();
    expect(zoomed.width).toBeCloseTo(100 * 1.1 ** 7);
    await user.keyboard("{ArrowRight}");
    expect(box().left - zoomed.left).toBeCloseTo((8 / 240) * 100);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(box().top - zoomed.top).toBeCloseTo((32 / 240) * 100);

    // As far as the edge and no further.
    await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
    expect(box().left + box().width).toBeCloseTo(100);
    expect(covers()).toBe(true);
    await user.keyboard("--------------------");
    expect(box()).toEqual({ left: 0, top: 0, width: 100, height: 100 });

    // Other keys are left alone.
    expect(fireEvent.keyDown(frame(), { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(frame(), { key: "ArrowUp" })).toBe(false);

    await user.keyboard("++++{ArrowUp}");
    await user.click(confirmButton());
    expect(onUse.mock.calls[0]?.[0]).toMatchObject({ moved: true });
    expect(onUse.mock.calls[0]?.[0]?.square.side).toBeLessThan(400);
  });

  it("follows a drag, zooms on the wheel around the pointer, and spreads under two fingers", () => {
    open();
    load(1000, 500);
    const target = frame();

    // The middle of the circle is at (220, 220); 24 px is a tenth of it.
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 220, clientY: 220 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 244, clientY: 260 });
    expect(box()).toEqual({ left: -40, top: 0, width: 200, height: 100 });
    fireEvent.pointerUp(target, { pointerId: 1 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 400, clientY: 220 });
    expect(box().left).toBeCloseTo(-40);

    // Taken from the page, which would otherwise scroll.
    expect(fireEvent.wheel(target, { deltaY: -100, clientX: 220, clientY: 220 })).toBe(false);
    const wheeled = box();
    expect(wheeled.width).toBeCloseTo(200 * Math.exp(0.2));
    expect(covers()).toBe(true);

    fireEvent.pointerDown(target, { pointerId: 2, clientX: 160, clientY: 220 });
    fireEvent.pointerDown(target, { pointerId: 3, clientX: 280, clientY: 220 });
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 340, clientY: 220 });
    expect(box().width).toBeCloseTo(wheeled.width * 1.5);
    expect(covers()).toBe(true);
    fireEvent.pointerCancel(target, { pointerId: 2 });
    fireEvent.pointerUp(target, { pointerId: 3 });
  });

  it("offers a card its host will not let be cut as it is, in the middle and still", async () => {
    const { onUse } = open();
    fireEvent.error(picture());
    // The plain try: shown, but not to be read.
    expect(picture()).not.toHaveAttribute("crossorigin");
    expect(confirmButton()).toBeDisabled();
    load(500, 750);
    expect(frame()).toHaveAccessibleDescription("This picture can only be used as it is.");
    expect(box()).toEqual({ left: 0, top: -25, width: 100, height: 150 });

    await userEvent.keyboard("{ArrowUp}+");
    fireEvent.pointerDown(frame(), { pointerId: 1, clientX: 220, clientY: 220 });
    fireEvent.pointerMove(frame(), { pointerId: 1, clientX: 220, clientY: 300 });
    expect(fireEvent.wheel(frame(), { deltaY: -100, clientX: 220, clientY: 220 })).toBe(true);
    expect(box()).toEqual({ left: 0, top: -25, width: 100, height: 150 });

    await userEvent.click(confirmButton());
    expect(onUse).toHaveBeenCalledWith(null);
  });

  it("says so when a card cannot be shown at all, and still lets it be used as it is", async () => {
    const { onUse } = open();
    fireEvent.error(picture());
    fireEvent.error(picture());
    expect(frame().querySelector("img")).toBeNull();
    expect(frame()).toHaveAccessibleDescription(
      "The picture could not be shown here. It can still be used as it is.",
    );
    await userEvent.click(confirmButton());
    expect(onUse).toHaveBeenCalledWith(null);
  });

  it("gives back a photo the browser cannot draw, and one with no size at all", () => {
    const photo: FaceSource = { kind: "photo", url: "blob:me", name: "me.heic" };
    const { onUnreadable } = open(photo);
    expect(picture()).toHaveAttribute("crossorigin", "anonymous");
    fireEvent.error(picture());
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    load(0, 0);
    expect(onUnreadable).toHaveBeenCalledTimes(2);
  });

  it("closes on Cancel and on Escape, with nothing chosen", async () => {
    const { onCancel, onUse } = open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onUse).not.toHaveBeenCalled();
  });
});
