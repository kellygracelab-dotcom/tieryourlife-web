import { describe, expect, it } from "vitest";
import { quotaOf } from "./linkQuota";

describe("the quota of pictures from links", () => {
  it("takes what is left, the limit and when the day starts again", () => {
    expect(quotaOf({ left: 3, limit: 50, resetsAt: 1_800_000_000_000 })).toEqual({
      left: 3,
      limit: 50,
      resetsAt: 1_800_000_000_000,
    });
    expect(quotaOf({ left: 0, limit: 50, resetsAt: 1 })).toEqual({
      left: 0,
      limit: 50,
      resetsAt: 1,
    });
  });

  it("never says more is left than the limit", () => {
    expect(quotaOf({ left: 80, limit: 50, resetsAt: 5 })).toEqual({
      left: 50,
      limit: 50,
      resetsAt: 5,
    });
  });

  it("drops a quota that is missing or makes no sense", () => {
    expect(quotaOf(undefined)).toBeNull();
    expect(quotaOf(null)).toBeNull();
    expect(quotaOf("3 of 50")).toBeNull();
    expect(quotaOf([3, 50, 5])).toBeNull();
    expect(quotaOf({ left: 3, limit: 50 })).toBeNull();
    expect(quotaOf({ left: -1, limit: 50, resetsAt: 5 })).toBeNull();
    expect(quotaOf({ left: 1.5, limit: 50, resetsAt: 5 })).toBeNull();
    expect(quotaOf({ left: "3", limit: 50, resetsAt: 5 })).toBeNull();
    expect(quotaOf({ left: 3, limit: 50, resetsAt: 0 })).toBeNull();
    expect(quotaOf({ left: 3, limit: Number.MAX_VALUE, resetsAt: 5 })).toBeNull();
  });
});
