import { describe, expect, it } from "vitest";
import type { PublishProblem } from "../boards/publish";
import { failureText, problemText } from "./houseWords";

describe("the house's words", () => {
  it("says why a board cannot go out, as its settings do", () => {
    const problems: PublishProblem[] = ["category", "noItems", "tooManyTiers", "tooManyItems"];
    expect(problems.map(problemText)).toEqual([
      "Pick a category.",
      "Add at least one card before you publish this list.",
      "At most 20 tiers.",
      "At most 2000 cards.",
    ]);
  });

  it("reads a missing list as gone only for a replace", () => {
    expect(failureText({ kind: "notFound" }, "replace")).toBe("This list isn’t published anymore.");
    expect(failureText({ kind: "notFound" }, "publish")).toBe("Couldn’t publish. Try again.");
  });
});
