import { describe, expect, it, vi } from "vitest";
import { ApiFailure, errorOf } from "../api/errors";
import type { PictureAsk, PicturePage } from "../api/pictures";
import {
  limitedSearch,
  pasteLimitText,
  searchAgainAt,
  searchLimitOf,
  searchLimitText,
} from "./searchLimit";

const ask: PictureAsk = { q: "naruto", scope: "all", web: false, page: 1 };
const page: PicturePage = { items: [], hasMore: false, notices: [], rest: false };
const refused = (retryAt?: number) =>
  new ApiFailure(
    retryAt === undefined ? { kind: "searchLimit" } : { kind: "searchLimit", retryAt },
  );

// Local times, so the clock reads the same wherever the tests run.
const today14 = new Date(2026, 10, 13, 14, 0).getTime();
const noon = new Date(2026, 10, 13, 12, 0).getTime();

describe("limitedSearch", () => {
  it("asks nothing until the time the backend gave, then asks again", async () => {
    let now = noon;
    const find = vi
      .fn<(ask: PictureAsk) => Promise<PicturePage>>()
      .mockRejectedValueOnce(refused(today14))
      .mockResolvedValue(page);
    const search = limitedSearch(find, () => now);

    await expect(search(ask)).rejects.toSatisfy((reason) => searchLimitOf(reason) === today14);
    await expect(search({ ...ask, q: "bleach" })).rejects.toSatisfy(
      (reason) => searchLimitOf(reason) === today14,
    );
    expect(find).toHaveBeenCalledTimes(1);

    now = today14;
    await expect(search(ask)).resolves.toBe(page);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("waits a minute when the backend gave no time", async () => {
    const find = vi.fn<(ask: PictureAsk) => Promise<PicturePage>>().mockRejectedValue(refused());
    const search = limitedSearch(find, () => noon);
    await expect(search(ask)).rejects.toSatisfy(
      (reason) => searchLimitOf(reason) === noon + 60_000,
    );
  });

  it("lets other failures through and keeps asking after them", async () => {
    const down = new ApiFailure({ kind: "offline" });
    const find = vi
      .fn<(ask: PictureAsk) => Promise<PicturePage>>()
      .mockRejectedValueOnce(down)
      .mockResolvedValue(page);
    const search = limitedSearch(find, () => noon);
    await expect(search(ask)).rejects.toSatisfy((reason) => errorOf(reason).kind === "offline");
    await expect(search(ask)).resolves.toBe(page);
  });
});

describe("the time searching works again", () => {
  it("is the time alone today, rounded up to the minute, and with the day after today", () => {
    expect(searchAgainAt(today14 - 30_000, noon)).toBe(searchAgainAt(today14, noon));
    expect(searchAgainAt(today14, noon)).not.toMatch(/2026/);
    const tomorrow = new Date(2026, 10, 14, 0, 0).getTime();
    expect(searchAgainAt(tomorrow, noon)).toMatch(/2026/);
  });

  it("is said in the box, and after a paste with the names that went alone", () => {
    const at = searchAgainAt(today14, noon);
    expect(searchLimitText(today14, noon)).toBe(
      `Too many picture searches. Search again at ${at}.`,
    );
    expect(searchLimitText(null)).toBe(
      "Too many picture searches. Search again in a little while.",
    );
    expect(pasteLimitText(3, today14, noon)).toBe(
      `3 cards came without pictures: too many picture searches. Search again at ${at}.`,
    );
    expect(pasteLimitText(1, today14, noon)).toBe(
      `1 card came without a picture: too many picture searches. Search again at ${at}.`,
    );
    expect(pasteLimitText(2, null)).toBe(
      "Too many picture searches. Search again in a little while.",
    );
  });
});
