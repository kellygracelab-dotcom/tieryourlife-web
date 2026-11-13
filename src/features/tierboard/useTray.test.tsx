import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRAY_GAP, TRAY_PAGE, useTray } from "./useTray";

const TILE = 52;

/** A tray of `count` tiles, laid out by hand: jsdom has no layout of its own. */
function Tray({ count, dir = "ltr" }: { selected?: number | null; count: number; dir?: string }) {
  const { tray, page, pages, readPage } = useTray(count);
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
  it("leaves the row where it is when a card is picked, in either direction", () => {
    for (const dir of ["ltr", "rtl"]) {
      const { container, rerender, unmount } = render(
        <Tray selected={null} count={12} dir={dir} />,
      );
      const row = container.querySelector("ul") as HTMLUListElement;
      layOut(row, dir === "rtl");
      row.scrollLeft = 0;
      rerender(<Tray selected={4} count={12} dir={dir} />);
      rerender(<Tray selected={11} count={12} dir={dir} />);
      expect(row.scrollBy).not.toHaveBeenCalled();
      expect(row.scrollLeft).toBe(0);
      unmount();
    }
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

  it("puts the last dot on at the row's end, where a wide row stops short of a page", () => {
    const { container, getByText } = render(<Tray selected={null} count={12} />);
    const row = container.querySelector("ul") as HTMLUListElement;
    layOut(row);
    // Twelve tiles in a row 600 wide: it scrolls only 120 in all.
    Object.defineProperty(row, "scrollWidth", { configurable: true, value: 720 });
    Object.defineProperty(row, "clientWidth", { configurable: true, value: 600 });
    for (const [scrolled, page] of [
      [0, 0],
      [60, 0],
      [120, 2],
      [-120, 2],
    ] as const) {
      row.scrollLeft = scrolled;
      act(() => row.dispatchEvent(new Event("scroll")));
      expect(getByText(`page ${page} of 3`)).toBeInTheDocument();
    }
  });
});
