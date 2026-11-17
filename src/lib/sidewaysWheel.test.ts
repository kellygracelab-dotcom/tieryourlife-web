import { afterEach, describe, expect, it } from "vitest";
import { installSidewaysWheel } from "./sidewaysWheel";

/** A row 300 wide holding 900, as jsdom draws nothing: the sizes are set by hand. */
function row(className: string, { scrollLeft = 0, height = 64, dir = "ltr" } = {}) {
  const box = document.createElement("nav");
  box.className = className;
  box.dir = dir;
  box.style.direction = dir;
  const child = document.createElement("a");
  box.append(child);
  document.body.append(box);
  let left = scrollLeft;
  Object.defineProperties(box, {
    scrollWidth: { value: 900 },
    clientWidth: { value: 300 },
    scrollHeight: { value: height },
    clientHeight: { value: 64 },
    scrollLeft: { get: () => left, set: (value: number) => (left = value) },
  });
  box.scrollBy = ((options: ScrollToOptions) => {
    left += options.left ?? 0;
  }) as typeof box.scrollBy;
  return { box, child, left: () => left };
}

const wheel = (target: Element, init: WheelEventInit) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("the wheel over a row that scrolls sideways", () => {
  let remove = () => {};
  afterEach(() => {
    remove();
    document.body.replaceChildren();
  });

  it("turns the sections sideways, and gives the page its wheel back at the row's end", () => {
    remove = installSidewaysWheel();
    const { child, left } = row("sections-grid");
    const down = wheel(child, { deltaY: 100 });
    expect(down.defaultPrevented).toBe(true);
    expect(left()).toBe(100);

    const { child: atEnd } = row("following-strip__items", { scrollLeft: 600 });
    expect(wheel(atEnd, { deltaY: 100 }).defaultPrevented).toBe(false);
    // Back up from the start goes to the page too.
    const { child: atStart } = row("cards__scopes");
    expect(wheel(atStart, { deltaY: -100 }).defaultPrevented).toBe(false);
  });

  it("reads lines as 40 px, and runs the other way right to left", () => {
    remove = installSidewaysWheel();
    const lines = row("pool__items");
    wheel(lines.child, { deltaY: 3, deltaMode: 1 });
    expect(lines.left()).toBe(120);

    const rtl = row("sections-grid", { dir: "rtl" });
    expect(wheel(rtl.child, { deltaY: 100 }).defaultPrevented).toBe(true);
    expect(rtl.left()).toBe(-100);
  });

  it("leaves the page its wheel anywhere else, with Shift, a pinch or a sideways swipe", () => {
    remove = installSidewaysWheel();
    const tier = row("tier__items");
    expect(wheel(tier.child, { deltaY: 100 }).defaultPrevented).toBe(false);
    // A column that scrolls down is not a sideways row.
    const column = row("pool__items", { height: 400 });
    expect(wheel(column.child, { deltaY: 100 }).defaultPrevented).toBe(false);
    const { child } = row("sections-grid");
    expect(wheel(child, { deltaY: 100, shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel(child, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(child, { deltaY: 10, deltaX: 40 }).defaultPrevented).toBe(false);
  });
});
