import { describe, expect, it, vi } from "vitest";
import { FADE_MS, FLIGHT_MS, flyIn } from "./flight";

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

function tileAt(to: DOMRect) {
  const tile = document.createElement("button");
  tile.getBoundingClientRect = () => to;
  const animate = vi.fn();
  tile.animate = animate as unknown as HTMLElement["animate"];
  return { tile, animate };
}

describe("flyIn", () => {
  it("starts the tile where the card was in the tray, at the tray's size, and settles in place", () => {
    const { tile, animate } = tileAt(rect(100, 500, 44, 62));
    flyIn(tile, rect(20, 700, 52, 74), false);
    expect(animate).toHaveBeenCalledOnce();
    const [frames, options] = animate.mock.calls[0]!;
    expect(frames[0].transform).toBe(
      "translate(-80px, 200px) scale(1.1818181818181819, 1.1935483870967742)",
    );
    expect(frames[1].transform).toBe("none");
    expect(options).toEqual({ duration: FLIGHT_MS, easing: "cubic-bezier(.2,.7,.3,1)" });
  });

  it("fades in instead for someone who asked for less motion", () => {
    const { tile, animate } = tileAt(rect(100, 500, 44, 62));
    flyIn(tile, rect(20, 700, 52, 74), true);
    const [frames, options] = animate.mock.calls[0]!;
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(options).toMatchObject({ duration: FADE_MS });
  });

  it("stops the landing the stylesheet started, so the two do not compose", () => {
    const { tile, animate } = tileAt(rect(0, 0, 44, 62));
    const cancel = vi.fn();
    tile.getAnimations = () => [{ cancel } as unknown as Animation];
    flyIn(tile, rect(0, 0, 52, 74), false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
  });

  it("does nothing where the browser cannot animate", () => {
    const tile = document.createElement("button");
    // jsdom has no Element.animate; the site must not throw there.
    expect(() => flyIn(tile, rect(0, 0, 1, 1), false)).not.toThrow();
  });
});
