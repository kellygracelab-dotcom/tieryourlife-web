import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Google Play links to these two pages, so they are copied from the backend
// repository as they are. Changing one is a deliberate act: update the digest.
const pages = {
  "public/privacy.html": "97bfb241ba372e5bd7e2ea9cbe3f63db763e2e6155396e41bc61f5de2e43dc2b",
  "public/delete-account.html": "3ab04c03a4cd5b3c17274fa3644517fc3ceb3e43ac702c2ceb20824e93139d41",
};

const digestOf = (path: string) =>
  createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("the pages Google Play points at", () => {
  it.each(Object.entries(pages))("%s is the copy the backend serves", (path, digest) => {
    expect(digestOf(path)).toBe(digest);
  });
});
