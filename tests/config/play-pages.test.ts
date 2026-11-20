import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Google Play links to these two pages, so they are copied from the backend
// repository as they are. Changing one is a deliberate act: update the digest.
const pages = {
  "public/privacy.html": "a546056818d2ff8520f891a07fad1fc4852be0943f3590fd89db795abeff609e",
  "public/delete-account.html": "b93afaa0535ec10d9cde90540cedcb9d14bc2fa6989961b655249e00f03721d7",
};

const digestOf = (path: string) =>
  createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("the pages Google Play points at", () => {
  it.each(Object.entries(pages))("%s is the copy the backend serves", (path, digest) => {
    expect(digestOf(path)).toBe(digest);
  });
});
