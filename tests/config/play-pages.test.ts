import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Google Play links to these two pages, so they are copied from the backend
// repository as they are. Changing one is a deliberate act: update the digest.
const pages = {
  "public/privacy.html": "098982e62b8659140249b347eb7a9c81f745e8f7f42e0f5dc90c6ee245eb787d",
  "public/delete-account.html": "cae0e1b505fd7948bcb95fea3fe6129268f36d7e504f6f747b9e260ccf393bdb",
};

const digestOf = (path: string) =>
  createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("the pages Google Play points at", () => {
  it.each(Object.entries(pages))("%s is the copy the backend serves", (path, digest) => {
    expect(digestOf(path)).toBe(digest);
  });
});
