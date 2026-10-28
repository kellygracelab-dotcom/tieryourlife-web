import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBoardSize } from "./useBoardSize";

describe("useBoardSize", () => {
  const width = window.innerWidth;
  afterEach(() => {
    window.innerWidth = width;
  });

  it("follows the window across the board's sizes", () => {
    window.innerWidth = 1280;
    const { result } = renderHook(() => useBoardSize());
    expect(result.current).toBe("large");
    act(() => {
      window.innerWidth = 700;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe("medium");
    act(() => {
      window.innerWidth = 390;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe("small");
  });
});
