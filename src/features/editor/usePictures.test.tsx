import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { FoundPicture, PictureScope } from "../../api/pictures";
import { LOOKUP_DEBOUNCE_MS, usePictures, type FindPictures } from "./usePictures";

vi.mock("../../lib/api", () => ({ findPictures: vi.fn() }));

const picture = (id: string): FoundPicture => ({
  id,
  title: id,
  subtitle: null,
  imageUrl: `https://img.test/${id}.jpg`,
  thumbUrl: null,
  source: "tmdb",
  kind: "movie",
  credit: null,
  attribution: null,
});

function Probe({
  query,
  scope = "all",
  web = false,
  find,
}: {
  query: string;
  scope?: PictureScope;
  web?: boolean;
  find: FindPictures;
}) {
  const { state, more } = usePictures(query, scope, web, find);
  return (
    <>
      <output>
        {state.status === "ready"
          ? `ready:${state.items.map((item) => item.id).join(",")}|next:${state.next ?? "-"}|${state.notices.join(",")}${state.more ? "|more" : ""}${state.filling ? "|filling" : ""}`
          : state.status === "failed" && state.limit !== undefined
            ? `limited:${state.limit.retryAt ?? "-"}`
            : state.status}
      </output>
      <button type="button" onClick={more}>
        more
      </button>
    </>
  );
}

const shown = () => screen.getByRole("status");
const settle = () =>
  act(async () => {
    vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS + 10);
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePictures", () => {
  it("asks nothing for one letter, then the scope given after a pause", async () => {
    const find = vi.fn<FindPictures>(async ({ q }) => ({
      items: [picture(q)],
      hasMore: false,
      notices: ["webDailyLimit"],
      rest: false,
    }));
    const { rerender } = render(<Probe query="a" find={find} />);
    expect(shown()).toHaveTextContent("idle");

    rerender(<Probe query="an" scope="anime" find={find} />);
    expect(shown()).toHaveTextContent("searching");
    await settle();
    expect(find).toHaveBeenCalledWith({
      q: "an",
      scope: "anime",
      web: false,
      page: 1,
      quick: true,
    });
    expect(shown()).toHaveTextContent("ready:an|next:-|webDailyLimit");

    // A few more letters keep the answer on screen; another scope does not.
    rerender(<Probe query="ani" scope="anime" find={find} />);
    expect(shown()).toHaveTextContent("ready:an");
    rerender(<Probe query="ani" scope="games" find={find} />);
    expect(shown()).toHaveTextContent("searching");
    await settle();
    expect(shown()).toHaveTextContent("ready:ani");

    rerender(<Probe query="ani" scope="games" web find={find} />);
    expect(shown()).toHaveTextContent("searching");
    await settle();
    expect(find).toHaveBeenLastCalledWith({
      q: "ani",
      scope: "games",
      web: true,
      page: 1,
      quick: true,
    });

    rerender(<Probe query="zebra" scope="games" web find={find} />);
    expect(shown()).toHaveTextContent("searching");
  });

  it("names a failure", async () => {
    const find = vi.fn<FindPictures>(async () => {
      throw new Error("down");
    });
    render(<Probe query="naruto" find={find} />);
    await settle();
    expect(shown()).toHaveTextContent("failed");
  });

  it("says when the searches start again, and asks no whole search after a refused quick one", async () => {
    const find = vi.fn<FindPictures>(async () => {
      throw new ApiFailure({ kind: "searchLimit", retryAt: 1_794_571_200_000 });
    });
    render(<Probe query="naruto" find={find} />);
    await settle();
    expect(shown()).toHaveTextContent("limited:1794571200000");
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("names the limit when the whole search is refused after a failed quick one", async () => {
    const find = vi.fn<FindPictures>(async ({ quick }) => {
      if (quick === true) throw new Error("slow");
      throw new ApiFailure({ kind: "searchLimit" });
    });
    render(<Probe query="naruto" find={find} />);
    await settle();
    expect(shown()).toHaveTextContent("limited:-");
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("adds the next pages, each picture once, until there are no more", async () => {
    const pages: Record<number, { ids: string[]; hasMore: boolean }> = {
      1: { ids: ["a", "b"], hasMore: true },
      2: { ids: ["b", "c"], hasMore: true },
      3: { ids: ["d"], hasMore: false },
    };
    const find = vi.fn<FindPictures>(async ({ page }) => ({
      items: (pages[page]?.ids ?? []).map(picture),
      hasMore: pages[page]?.hasMore ?? false,
      notices: [],
      rest: false,
    }));
    render(<Probe query="naruto" find={find} />);
    await settle();
    expect(shown()).toHaveTextContent("ready:a,b|next:2");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "more" }));
    });
    expect(find).toHaveBeenLastCalledWith({ q: "naruto", scope: "all", web: false, page: 2 });
    expect(shown()).toHaveTextContent("ready:a,b,c|next:3");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "more" }));
    });
    expect(shown()).toHaveTextContent("ready:a,b,c,d|next:-");

    // Nothing more to ask for.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "more" }));
    });
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("keeps the pages it has when the next will not come, and drops one meant for other words", async () => {
    let second: (value: Awaited<ReturnType<FindPictures>>) => void = () => undefined;
    const find = vi.fn<FindPictures>(async ({ q, page }) => {
      if (page === 1) return { items: [picture(`${q}1`)], hasMore: true, notices: [], rest: false };
      if (q === "naruto") throw new Error("down");
      return new Promise((resolve) => {
        second = resolve;
      });
    });
    const { rerender } = render(<Probe query="naruto" find={find} />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "more" }));
    });
    expect(shown()).toHaveTextContent("ready:naruto1|next:2");

    rerender(<Probe query="bleach" find={find} />);
    await settle();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "more" }));
    });
    expect(shown()).toHaveTextContent("ready:bleach1|next:2||more");
    rerender(<Probe query="bleach" scope="anime" find={find} />);
    await settle();
    await act(async () => {
      second({ items: [picture("late")], hasMore: false, notices: [], rest: false });
    });
    expect(shown()).toHaveTextContent("ready:bleach1|next:2");
    expect(shown()).not.toHaveTextContent("late");
  });

  it("shows the quick answer first, then adds what the whole search found below it", async () => {
    let whole: (value: Awaited<ReturnType<FindPictures>>) => void = () => undefined;
    const find = vi.fn<FindPictures>(({ quick }) =>
      quick === true
        ? Promise.resolve({
            items: [picture("a"), picture("b")],
            hasMore: false,
            notices: [],
            rest: true,
          })
        : new Promise((resolve) => {
            whole = resolve;
          }),
    );
    render(<Probe query="dune" find={find} />);
    await settle();
    expect(find).toHaveBeenNthCalledWith(1, {
      q: "dune",
      scope: "all",
      web: false,
      page: 1,
      quick: true,
    });
    expect(find).toHaveBeenNthCalledWith(2, { q: "dune", scope: "all", web: false, page: 1 });
    // No next page until the whole search says there is one.
    expect(shown()).toHaveTextContent("ready:a,b|next:-||filling");

    await act(async () => {
      whole({
        items: [picture("b"), picture("book"), picture("a"), picture("web")],
        hasMore: true,
        notices: ["webDailyLimit"],
        rest: false,
      });
    });
    expect(shown()).toHaveTextContent("ready:a,b,book,web|next:2|webDailyLimit");
    expect(shown()).not.toHaveTextContent("filling");
  });

  it("asks once when the quick answer is all there is, and keeps it when the whole search fails", async () => {
    const once = vi.fn<FindPictures>(async () => ({
      items: [picture("a")],
      hasMore: true,
      notices: [],
      rest: false,
    }));
    const { unmount } = render(<Probe query="dune" find={once} />);
    await settle();
    expect(once).toHaveBeenCalledTimes(1);
    expect(shown()).toHaveTextContent("ready:a|next:2");
    unmount();

    const failing = vi.fn<FindPictures>(async ({ quick }) => {
      if (quick === true) return { items: [picture("a")], hasMore: false, notices: [], rest: true };
      throw new Error("slow catalogue down");
    });
    render(<Probe query="dune" find={failing} />);
    await settle();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(shown()).toHaveTextContent("ready:a|next:-|");
    expect(shown()).not.toHaveTextContent("filling");
  });

  it("asks for the whole search when the quick answer will not come", async () => {
    const find = vi.fn<FindPictures>(async ({ quick }) => {
      if (quick === true) throw new Error("timeout");
      return { items: [picture("a"), picture("web")], hasMore: false, notices: [], rest: false };
    });
    render(<Probe query="dune" find={find} />);
    await settle();
    expect(find).toHaveBeenCalledTimes(2);
    expect(shown()).toHaveTextContent("ready:a,web|next:-|");
    expect(shown()).not.toHaveTextContent("filling");

    const down = vi.fn<FindPictures>(async () => {
      throw new Error("down");
    });
    render(<Probe query="dune" find={down} />);
    await settle();
    expect(screen.getAllByRole("status")[1]).toHaveTextContent("failed");
  });
});
