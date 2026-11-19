import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  packages: Record<string, { version: string }>;
};

describe("the browser shards' image", () => {
  it("is Playwright's own image of the locked version, pinned by digest", () => {
    const image =
      /image: mcr\.microsoft\.com\/playwright:v([\d.]+)-noble@sha256:[0-9a-f]{64}\n/.exec(ci);
    expect(
      image,
      "the browsers job runs in mcr.microsoft.com/playwright:v<version>-noble@sha256:…",
    ).not.toBeNull();
    // A newer @playwright/test needs the image of its own version: its browsers are the ones it drives.
    expect(image![1]).toBe(lock.packages["node_modules/@playwright/test"]!.version);
    expect(image![1]).toBe(lock.packages["node_modules/playwright"]!.version);
  });

  it("no longer installs the browsers' system packages in the shards", () => {
    const browsers = ci.slice(ci.indexOf("\n  browsers:"), ci.indexOf("\n  check:"));
    expect(browsers).toContain("npm run e2e -- --shard=");
    expect(browsers).not.toContain("playwright install");
  });
});
