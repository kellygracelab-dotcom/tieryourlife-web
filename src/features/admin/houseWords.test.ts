import { describe, expect, it } from "vitest";
import type { PublishRequest } from "../../api/lists";
import { searchAgainAt } from "../../lib/searchLimit";
import type { PublishProblem } from "../boards/publish";
import { busyText, failureText, notCopiedCards, problemText } from "./houseWords";

describe("the house's words", () => {
  it("says why a board cannot go out, as its settings do", () => {
    const problems: PublishProblem[] = ["category", "noItems", "tooManyTiers", "tooManyItems"];
    expect(problems.map(problemText)).toEqual([
      "Pick a category.",
      "Add at least one card before you publish this list.",
      "At most 19 tiers.",
      "At most 2000 cards.",
    ]);
  });

  it("names the tier limit when the feed refuses a list for its tiers", () => {
    const refused = {
      kind: "invalid",
      detail: "At most 19 tiers",
      code: "TOO_MANY_TIERS",
    } as const;
    expect(failureText(refused, "publish")).toBe("At most 19 tiers. At most 19 tiers");
  });

  it("explains when the same house list changed during replacement", () => {
    expect(failureText({ kind: "publicationChanged" }, "replace")).toBe(
      "The published list changed during the update. Your edits are saved on this device. Try publishing again.",
    );
  });

  it("reads a missing list as gone only for a replace", () => {
    expect(failureText({ kind: "notFound" }, "replace")).toBe("This list isn’t published anymore.");
    expect(failureText({ kind: "notFound" }, "publish")).toBe("Couldn’t publish. Try again.");
  });
});

describe("a house publication held back by its pictures", () => {
  const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/Mango.jpg?width=600";
  const request: PublishRequest = {
    title: "Fruit",
    category: "food",
    coverImageUrl: null,
    coverPictureId: null,
    tiers: [],
    items: [
      { title: "Apple", imageUrl: "https://img.test/apple.jpg", pictureId: null, tierIndex: 0 },
      {
        title: "Mango",
        imageUrl: null,
        pictureId: "w-1",
        attribution: { source: "commons", originalUrl: COMMONS },
        tierIndex: 0,
      },
      { title: "Pear", imageUrl: COMMONS, pictureId: null, tierIndex: null },
    ],
  };
  const at = Date.UTC(2026, 10, 13, 12, 0);

  it("names the cards whose pictures were not copied, by the address sent or the one kept", () => {
    expect(notCopiedCards([COMMONS], request)).toEqual(["Mango", "Pear"]);
    expect(notCopiedCards(["https://img.test/apple.jpg"], request)).toEqual(["Apple"]);
    expect(notCopiedCards(["https://img.test/none.jpg"], request)).toEqual([]);
  });

  it("says Wikimedia is busy, or which cards, and when to try again", () => {
    const time = searchAgainAt(at);
    expect(busyText({ kind: "sourceBusy", busy: ["wikimedia"] }, request, at)).toBe(
      `Wikimedia is busy. Try again at ${time}.`,
    );
    expect(busyText({ kind: "picturesNotCopied", imageUrls: [COMMONS] }, request, at)).toBe(
      `Pictures not copied in time: Mango, Pear. Try again at ${time}; if one keeps failing, replace it.`,
    );
    expect(busyText({ kind: "picturesNotCopied", imageUrls: [COMMONS] }, null, at)).toBe(
      `Some pictures weren’t copied in time. Try again at ${time}.`,
    );
  });

  it("says so too when a board picked in the House pane is held back", () => {
    expect(failureText({ kind: "sourceBusy", retryAt: at }, "replace")).toBe(
      `Wikimedia is busy. Try again at ${searchAgainAt(at)}.`,
    );
  });
});
