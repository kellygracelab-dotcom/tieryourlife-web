import { describe, expect, it } from "vitest";
import { failureText, WEB_PICTURES_TOO_MANY } from "./failureText";

describe("failureText", () => {
  it("sends the reader to the site's own take-down, speaks of the list, and leaves the proxy's English out", () => {
    expect(failureText({ kind: "tooManyLists" }, "new")).toBe(
      "This account has published as many lists as it can. Take one down in Your public lists first.",
    );
    expect(failureText({ kind: "offline" }, "edit")).toBe(
      "No connection. Nothing was lost: the list is safe on this device. Try again once you are back online.",
    );
    expect(failureText({ kind: "tooLarge", detail: "refused" }, "new")).toBe(
      "The list is too big to publish.",
    );
    expect(
      failureText({ kind: "invalid", detail: "title too long", code: "INVALID" }, "edit"),
    ).toBe("The list was refused.");
  });

  it("names the reason of a refusal that trying again would not get past", () => {
    // A photo SafeSearch refused would be sent again: the text says what to do instead.
    for (const mode of ["new", "edit"] as const) {
      expect(failureText({ kind: "pictureRefused", because: "adult" }, mode)).toBe(
        "One of your photos cannot go in the public feed. Remove it, or keep this list private.",
      );
    }
    expect(failureText({ kind: "banned", until: Date.UTC(2026, 10, 13, 12) }, "new")).toBe(
      "A moderator took down one of your lists. You can publish again on November 13, 2026.",
    );
    expect(failureText({ kind: "banned", until: null }, "edit")).toBe(
      "A moderator took down one of your lists, and you can no longer publish.",
    );
    expect(
      failureText({ kind: "invalid", detail: "x", code: "INVALID", field: "category" }, "new"),
    ).toBe("This category no longer takes lists. Choose another one under Category.");
    // More tiers than the feed takes: what to change, not a bare refusal.
    for (const mode of ["new", "edit"] as const) {
      expect(
        failureText({ kind: "invalid", detail: "Too many", code: "TOO_MANY_TIERS" }, mode),
      ).toBe("At most 19 tiers.");
    }
  });

  // QA S11: pictures from other sites are fetched and checked at publish.
  it("says which card's picture from another site was refused, and why pictures from other sites stopped it", () => {
    const refused = {
      kind: "pictureRefused",
      because: "racy",
      imageUrl: "https://x.test/p.jpg",
    } as const;
    expect(
      failureText(refused, "new", (url) => (url === "https://x.test/p.jpg" ? "Poster" : null)),
    ).toBe(
      "The picture on “Poster” cannot go in the public feed. Change it, or keep this list private.",
    );
    // A picture no card holds any more: the plain words.
    expect(failureText(refused, "edit")).toBe(
      "One of your photos cannot go in the public feed. Remove it, or keep this list private.",
    );
    expect(failureText({ kind: "tooManyRequests", code: "WEB_PICTURES_DAILY_LIMIT" }, "new")).toBe(
      "This list has more pictures from other sites than this account can publish today. Try again tomorrow, or use fewer of them.",
    );
    expect(failureText({ kind: "tooManyRequests", code: null }, "new")).toBe(
      "Could not publish. Nothing was lost. Try again.",
    );
    expect(failureText({ kind: "tooLarge", detail: WEB_PICTURES_TOO_MANY }, "new")).toBe(
      "This list has too many pictures from other sites to publish. Remove some of them.",
    );
  });
});
