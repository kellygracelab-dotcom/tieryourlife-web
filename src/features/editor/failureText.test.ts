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
});
