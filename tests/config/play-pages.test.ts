import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Google Play links to these two pages, so they are copied from the backend
// repository as they are. Changing one is a deliberate act: update the digest.
const pages = {
  "public/privacy.html": "37845b7c8fac531dba1d3cb8b52b23e5ab4b4b1854a8b8bfa02919509381b0bb",
  "public/delete-account.html": "4c2707b157ef8ed173d428fecb93bc981697cca277604340c1bc3c18ff3c99f3",
};

const digestOf = (path: string) =>
  createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("the pages Google Play points at", () => {
  it.each(Object.entries(pages))("%s is the copy the backend serves", (path, digest) => {
    expect(digestOf(path)).toBe(digest);
  });
});
