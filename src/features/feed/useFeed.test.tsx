import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { useFeed, type LoadFeed } from "./useFeed";

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
      ? `${state.lists.map((list) => list.id).join(",")}|${state.next ?? "-"}|${state.more}`
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
