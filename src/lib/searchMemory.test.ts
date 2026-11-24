import { describe, expect, it, vi } from "vitest";
import type { PictureAsk, PicturePage } from "../api/pictures";
import { REMEMBERED_MAX, REMEMBERED_MS, rememberedSearch } from "./searchMemory";

const ask = (q: string, more: Partial<PictureAsk> = {}): PictureAsk => ({
  q,
  scope: "all",
  page: 1,
  web: false,
  ...more,
});
const answer = (more: Partial<PicturePage> = {}): PicturePage => ({
  items: [],
  hasMore: false,
  notices: [],
  rest: false,
  ...more,
});

describe("rememberedSearch", () => {
  it("answers the same words from memory, and asks again for anything else in the request", async () => {
    let language = "en";
    const find = vi.fn(async () => answer());
    const search = rememberedSearch(find, () => language);
    const signal = new AbortController().signal;
    await search(ask("borscht", { quick: true }), signal);
    await search(ask(" borscht ", { quick: true }));
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(ask("borscht", { quick: true }), signal);
    await search(ask("borscht"));
    await search(ask("borscht", { section: "food" }));
    await search(ask("borscht", { page: 2 }));
    await search(ask("borscht", { web: true }));
    await search(ask("borscht", { scope: "anime" }));
    await search(ask("borscht", { topic: "t1" }));
    language = "uk";
    await search(ask("borscht", { quick: true }));
    expect(find).toHaveBeenCalledTimes(8);
  });

  it("keeps no failure and no answer a busy catalogue left short", async () => {
    const find = vi
      .fn<(a: PictureAsk) => Promise<PicturePage>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(answer({ busy: ["books"] }))
      .mockResolvedValue(answer());
    const search = rememberedSearch(find, () => "en");
    await expect(search(ask("dune"))).rejects.toThrow("offline");
    await search(ask("dune"));
    await search(ask("dune"));
    await search(ask("dune"));
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("forgets an answer after a while, and the oldest past the limit", async () => {
    let now = 0;
    const find = vi.fn(async () => answer());
    const search = rememberedSearch(
      find,
      () => "en",
      () => now,
    );
    await search(ask("dune"));
    now = REMEMBERED_MS - 1;
    await search(ask("dune"));
    expect(find).toHaveBeenCalledTimes(1);
    now = REMEMBERED_MS + 1;
    await search(ask("dune"));
    expect(find).toHaveBeenCalledTimes(2);
    for (let at = 0; at < REMEMBERED_MAX; at++) await search(ask(`word ${at}`));
    expect(find).toHaveBeenCalledTimes(2 + REMEMBERED_MAX);
    await search(ask("dune"));
    expect(find).toHaveBeenCalledTimes(3 + REMEMBERED_MAX);
  });
});
