import { describe, expect, it } from "vitest";
import { failureText } from "./failureText";

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
  });
});
