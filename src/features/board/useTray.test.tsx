import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRAY_GAP, TRAY_INSET, TRAY_PAGE, useTray } from "./useTray";

const TILE = 52;

/** A tray of `count` tiles, laid out by hand: jsdom has no layout of its own. */
function Tray({
  selected,
  count,
  dir = "ltr",
}: {
  selected: number | null;
  count: number;
  dir?: string;
}) {
  const { tray, page, pages, readPage } = useTray(selected, count);
  return (
    <div dir={dir}>
      <ul ref={tray} onScroll={readPage} style={{ direction: dir as "ltr" | "rtl" }}>
        {Array.from({ length: count }, (_, item) => (
          <li key={item}>
            <button type="button" data-item={item}>
              {item}
            </button>
          </li>
        ))}
      </ul>
      <p>
        page {page} of {pages}
      </p>
    </div>
  );
}

function layOut(row: HTMLUListElement, rtl = false) {
  const width = 360;
  row.getBoundingClientRect = () => ({ left: 0, right: width }) as DOMRect;
  [...row.children].forEach((holder, i) => {
    Object.defineProperty(holder, "offsetWidth", { configurable: true, value: TILE });
    const start = i * (TILE + TRAY_GAP);
    (holder as HTMLElement).getBoundingClientRect = () =>
      (rtl
        ? { left: width - start - TILE, right: width - start }
        : { left: start, right: start + TILE }) as DOMRect;
  });
  row.scrollBy = vi.fn() as typeof row.scrollBy;
}

afterEach(() => vi.restoreAllMocks());

describe("useTray", () => {
  it("brings the picked card to the row's start, left to right", () => {
    const { container, rerender } = render(<Tray selected={null} count={12} />);
    const row = container.querySelector("ul") as HTMLUListElement;
    layOut(row);
    rerender(<Tray selected={4} count={12} />);
    expect(row.scrollBy).toHaveBeenCalledWith({
      left: 4 * (TILE + TRAY_GAP) - TRAY_INSET,
      behavior: "smooth",
    });
  });

  it("brings it to the right edge in Arabic, where the row starts", () => {
    const { container, rerender } = render(<Tray selected={null} count={12} dir="rtl" />);
    const row = container.querySelector("ul") as HTMLUListElement;
    layOut(row, true);
    rerender(<Tray selected={4} count={12} dir="rtl" />);
    expect(row.scrollBy).toHaveBeenCalledWith({
      left: -(4 * (TILE + TRAY_GAP)) + TRAY_INSET,
      behavior: "smooth",
    });
  });

  it("counts pages of five, and reads the page from how far the row is scrolled", () => {
    const { container, getByText } = render(<Tray selected={null} count={12} />);
    expect(getByText("page 0 of 3")).toBeInTheDocument();
    const row = container.querySelector("ul") as HTMLUListElement;
    layOut(row);
    const stride = (TILE + TRAY_GAP) * TRAY_PAGE;
    for (const [scrolled, page] of [
      [stride, 1],
      [2 * stride, 2],
      [10 * stride, 2],
      // Arabic counts scrollLeft from the right, below zero.
      [-stride, 1],
    ] as const) {
      row.scrollLeft = scrolled;
      act(() => row.dispatchEvent(new Event("scroll")));
      expect(getByText(`page ${page} of 3`)).toBeInTheDocument();
    }
  });
});
