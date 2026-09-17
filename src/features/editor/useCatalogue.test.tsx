import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogueItem } from "../../api/catalogue";
import { LOOKUP_DEBOUNCE_MS, useCatalogue, type Lookup } from "./useCatalogue";

vi.mock("../../lib/api", () => ({ findInCatalogue: vi.fn() }));

const item = (title: string): CatalogueItem => ({
  id: `tmdb:${title}`,
  title,
  subtitle: null,
  imageUrl: null,
});

function Probe({ query, lookup }: { query: string; lookup: Lookup }) {
  const state = useCatalogue(query, lookup);
  return (
    <output>
      {state.status === "ready"
        ? `ready:${state.items.map((i) => i.title).join(",")}`
        : state.status === "failed"
          ? `failed:${state.query}`
          : state.status}
    </output>
  );
}

const shown = () => screen.getByRole("status");

describe("useCatalogue", () => {
  it("asks nothing for one character, then asks after a pause and keeps the answer", async () => {
    vi.useFakeTimers();
    const lookup = vi.fn<Lookup>(async (query) => [item(`${query}!`)]);
    const { rerender } = render(<Probe query="a" lookup={lookup} />);
    expect(shown()).toHaveTextContent("idle");

    rerender(<Probe query="an" lookup={lookup} />);
    expect(shown()).toHaveTextContent("searching");
    expect(lookup).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS + 10);
    });
    expect(lookup).toHaveBeenCalledWith("an");
    expect(shown()).toHaveTextContent("ready:an!");

    rerender(<Probe query="ani" lookup={lookup} />);
    expect(shown()).toHaveTextContent("ready:an!");
    await act(async () => {
      vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS + 10);
    });
    expect(shown()).toHaveTextContent("ready:ani!");

    rerender(<Probe query="zebra" lookup={lookup} />);
    expect(shown()).toHaveTextContent("searching");
    vi.useRealTimers();
  });

  it("drops an answer that arrives for words no longer in the box, and names a failure", async () => {
    vi.useFakeTimers();
    let resolveFirst: (items: CatalogueItem[]) => void = () => {};
    const lookup = vi
      .fn<Lookup>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("down"));
    const { rerender } = render(<Probe query="first" lookup={lookup} />);
    await act(async () => {
      vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS + 10);
    });
    rerender(<Probe query="second" lookup={lookup} />);
    await act(async () => {
      vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS + 10);
    });
    await act(async () => resolveFirst([item("late")]));
    expect(shown()).toHaveTextContent("failed:second");
    vi.useRealTimers();
  });
});
