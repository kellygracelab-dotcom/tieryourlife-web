import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { readRememberedPage, useFeed, type LoadFeed } from "./useFeed";

const summary = (id: string): ListSummary => ({
  id,
  title: id,
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 1,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

const page = (ids: string[], next: string | null = null): FeedPage => ({
  lists: ids.map(summary),
  nextCursor: next,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe({ query, load }: { query: FeedQuery; load: LoadFeed }) {
  const { state, retry, more } = useFeed(query, load);
  const text =
    state.status === "ready"
      ? `${state.lists.map((list) => list.id).join(",")}|${state.next ?? "-"}|${state.more}${state.stale === true ? "|stale" : ""}`
      : state.status === "error"
        ? `error:${state.error.kind}`
        : "loading";
  return (
    <div>
      <output>{text}</output>
      <button onClick={retry}>retry</button>
      <button onClick={more}>more</button>
    </div>
  );
}

const shown = () => screen.getByRole("status");
const popular: FeedQuery = { sort: "popular" };

describe("useFeed", () => {
  it("opens a feed read before with its last first page, and swaps in the fresh one", async () => {
    const { unmount } = render(<Probe query={popular} load={async () => page(["a", "b"], "c")} />);
    expect(await screen.findByText("a,b|c|idle")).toBeInTheDocument();
    unmount();

    const fresh = deferred<FeedPage>();
    render(<Probe query={popular} load={() => fresh.promise} />);
    expect(shown()).toHaveTextContent("a,b|c|idle");
    await act(async () => fresh.resolve(page(["z"])));
    expect(shown()).toHaveTextContent("z|-|idle");
  });

  it("does not keep which lists were the reader's own", async () => {
    const memory = { recall: vi.fn(() => null), keep: vi.fn() };
    const own = { ...summary("a"), mine: true };
    function Kept() {
      useFeed(popular, async () => ({ lists: [own], nextCursor: null }), memory);
      return null;
    }
    render(<Kept />);
    await vi.waitFor(() => expect(memory.keep).toHaveBeenCalled());
    expect(memory.keep.mock.calls[0]?.[1].lists[0]).not.toHaveProperty("mine");
  });

  it("keeps the page read before when the fresh one fails, and says it is old", async () => {
    const { unmount } = render(<Probe query={popular} load={async () => page(["a", "b"], "c")} />);
    expect(await screen.findByText("a,b|c|idle")).toBeInTheDocument();
    unmount();

    const again = deferred<FeedPage>();
    const load = vi
      .fn<LoadFeed>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockReturnValueOnce(again.promise);
    render(<Probe query={popular} load={load} />);
    expect(await screen.findByText("a,b|c|idle|stale")).toBeInTheDocument();
    // Another try keeps the lists up meanwhile, then the fresh page replaces them.
    await userEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(shown()).toHaveTextContent("a,b|c|idle|stale");
    await act(async () => again.resolve(page(["z"])));
    expect(shown()).toHaveTextContent("z|-|idle");
  });

  it("never keeps somebody's Following feed", async () => {
    const following: FeedQuery = { following: true };
    const { unmount } = render(<Probe query={following} load={async () => page(["a"])} />);
    expect(await screen.findByText("a|-|idle")).toBeInTheDocument();
    unmount();
    render(<Probe query={following} load={() => new Promise<never>(() => undefined)} />);
    expect(shown()).toHaveTextContent("loading");
  });

  it("loads the first page, then appends the next on request until there is none", async () => {
    const load = vi
      .fn<LoadFeed>()
      .mockResolvedValueOnce(page(["a", "b"], "c1"))
      .mockResolvedValueOnce(page(["c"]));
    render(<Probe query={popular} load={load} />);
    expect(shown()).toHaveTextContent("loading");
    await screen.findByText("a,b|c1|idle");
    expect(load).toHaveBeenCalledWith({ sort: "popular" });

    await userEvent.click(screen.getByRole("button", { name: "more" }));
    await screen.findByText("a,b,c|-|idle");
    expect(load).toHaveBeenLastCalledWith({ sort: "popular", after: "c1" });

    await userEvent.click(screen.getByRole("button", { name: "more" }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps what it has when the next page fails, and tries that page again", async () => {
    const load = vi
      .fn<LoadFeed>()
      .mockResolvedValueOnce(page(["a"], "c1"))
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce(page(["b"]));
    render(<Probe query={popular} load={load} />);
    await screen.findByText("a|c1|idle");
    await userEvent.click(screen.getByRole("button", { name: "more" }));
    await screen.findByText("a|c1|failed");
    await userEvent.click(screen.getByRole("button", { name: "more" }));
    await screen.findByText("a,b|-|idle");
  });

  it("names a failed first page and loads it again on retry", async () => {
    const load = vi
      .fn<LoadFeed>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce(page(["a"]));
    render(<Probe query={popular} load={load} />);
    await screen.findByText("error:offline");
    await userEvent.click(screen.getByRole("button", { name: "retry" }));
    await screen.findByText("a|-|idle");
  });

  it("reloads when the query changes and drops a page from before", async () => {
    const first = deferred<FeedPage>();
    const load = vi
      .fn<LoadFeed>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page(["z"]));
    const { rerender } = render(<Probe query={{ category: "anime" }} load={load} />);
    rerender(<Probe query={{ category: "anime" }} load={load} />);
    expect(load).toHaveBeenCalledTimes(1);

    rerender(<Probe query={{ category: "games" }} load={load} />);
    await screen.findByText("z|-|idle");
    await act(async () => first.resolve(page(["old"])));
    expect(shown()).toHaveTextContent("z|-|idle");
  });

  it("drops a next page that arrives after the query moved on", async () => {
    const next = deferred<FeedPage>();
    const load = vi
      .fn<LoadFeed>()
      .mockResolvedValueOnce(page(["a"], "c1"))
      .mockReturnValueOnce(next.promise)
      .mockResolvedValueOnce(page(["z"]));
    const { rerender } = render(<Probe query={{ category: "anime" }} load={load} />);
    await screen.findByText("a|c1|idle");
    await userEvent.click(screen.getByRole("button", { name: "more" }));
    expect(shown()).toHaveTextContent("a|c1|loading");

    rerender(<Probe query={{ category: "games" }} load={load} />);
    await screen.findByText("z|-|idle");
    await act(async () => next.resolve(page(["b"])));
    expect(shown()).toHaveTextContent("z|-|idle");
  });
});

describe("readRememberedPage", () => {
  it("gives back a page a card can be drawn from", () => {
    const kept = { lists: [summary("a")], next: "c1" };
    expect(readRememberedPage(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });

  // On a shared browser the next person would see somebody else's anonymous list as theirs.
  it("keeps nobody's own lists: the flag was said to whoever was signed in then", () => {
    const own = { ...summary("a"), anonymous: true, mine: true };
    expect(readRememberedPage({ lists: [own], next: null })?.lists[0]).not.toHaveProperty("mine");
  });

  it("takes anything else for nothing, so a bad copy cannot break Home on every visit", () => {
    for (const bad of [
      {},
      [],
      "x",
      1,
      true,
      null,
      { lists: [null] },
      { lists: [{}] },
      { lists: [{ ...summary("a"), authorName: null }], next: null },
      { lists: [summary("a")], next: 5 },
    ]) {
      expect(readRememberedPage(bad)).toBeNull();
    }
  });
});
