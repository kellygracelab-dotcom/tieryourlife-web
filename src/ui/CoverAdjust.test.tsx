import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoverFocus } from "../lib/coverFocus";
import { CoverAdjust } from "./CoverAdjust";

/** The stage drawn 200 × 300 at the window's corner. */
function open(focus: CoverFocus | null, picture: { width: number; height: number }) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 300,
  } as DOMRect);
  const onDone = vi.fn();
  render(<CoverAdjust src="https://img/p.jpg" focus={focus} onDone={onDone} onCancel={vi.fn()} />);
  const stage = screen.getByRole("application");
  const img = stage.querySelector("img")!;
  Object.defineProperty(img, "naturalWidth", { value: picture.width });
  Object.defineProperty(img, "naturalHeight", { value: picture.height });
  fireEvent.load(img);
  const done = () => fireEvent.click(screen.getByRole("button", { name: "Done" }));
  return { stage, onDone, done };
}

const PORTRAIT = { width: 1000, height: 1500 };
const WIDE = { width: 1600, height: 1000 };

describe("Adjust cover", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts a tall picture at its default and gives null back for it", () => {
    const { stage, onDone, done } = open(null, PORTRAIT);
    const point = stage.querySelector<HTMLElement>(".cover-adjust__point")!;
    expect(point.style.left).toBe("50%");
    expect(point.style.top).toBe("35%");
    done();
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it("moves the point anywhere on the picture, both ways, with the arrows", () => {
    // A 16:10 picture under a 2.05 header still moves up and down, and a
    // 16:10 one sideways: nothing holds the point to a frame (SPEC, second round).
    const { stage, onDone, done } = open(null, WIDE);
    for (let i = 0; i < 4; i++) fireEvent.keyDown(stage, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(stage, { key: "ArrowLeft" });
    done();
    expect(onDone).toHaveBeenCalledWith({ x: 0.48, y: 0.1, zoom: 1 });
  });

  it("puts the point where the picture is tapped, and moves it with a drag", () => {
    const { stage, onDone, done } = open(null, WIDE);
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 50, clientY: 30 });
    done();
    expect(onDone).toHaveBeenLastCalledWith({ x: 0.25, y: 0.1, zoom: 1 });

    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 50, clientY: 30 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 90, clientY: 90 });
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 90, clientY: 90 });
    done();
    expect(onDone).toHaveBeenLastCalledWith({ x: 0.45, y: 0.3, zoom: 1 });
  });

  it("keeps the middle of a tall picture, which is not its default, and Reset goes back to it", () => {
    const { stage, onDone, done } = open(null, PORTRAIT);
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 150 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 150 });
    done();
    expect(onDone).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5, zoom: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    done();
    expect(onDone).toHaveBeenLastCalledWith(null);
  });

  it("starts from the focus kept, zooms by the slider, and draws the widest frame on the picture", () => {
    const { stage, onDone, done } = open({ x: 0.3, y: 0.4, zoom: 1 }, WIDE);
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    // The 2.05 header's frame at zoom 2: 800 × 390 of 1600 × 1000, its middle at 480, 400.
    const edge = stage.querySelector<HTMLElement>(".cover-adjust__edge")!;
    expect(parseFloat(edge.style.width)).toBeCloseTo(50, 5);
    expect(parseFloat(edge.style.left)).toBeCloseTo(5, 5);
    done();
    expect(onDone).toHaveBeenCalledWith({ x: 0.3, y: 0.4, zoom: 2 });
  });
});
