import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rewrite = {
  source: string;
  destination?: string;
  function?: { functionId: string; region: string };
};

type HostingSite = {
  target: string;
  public: string;
  rewrites: Rewrite[];
};

const config = JSON.parse(readFileSync("firebase.json", "utf8")) as Record<string, unknown>;
const hosting = config.hosting as HostingSite[];

describe("firebase.json", () => {
  it("never carries the keys that belong to the backend repository", () => {
    for (const key of Object.keys(config)) {
      expect(["hosting", "functions", "emulators"]).toContain(key);
    }
  });

  it("owns exactly one functions codebase, named web, and never the backend's", () => {
    const codebases = config.functions as { codebase: string; source: string }[];
    expect(codebases.map((c) => c.codebase)).toEqual(["web"]);
    expect(codebases[0]?.source).toBe("functions");
  });

  it("deploys one site, the web target, from the Vite build", () => {
    expect(hosting).toHaveLength(1);
    expect(hosting[0]?.target).toBe("web");
    expect(hosting[0]?.public).toBe("dist");
  });

  it("routes the proxy paths to the backend functions in their region before the catch-all", () => {
    const rewrites = hosting[0]!.rewrites;
    const byFunction = (id: string) => rewrites.findIndex((r) => r.function?.functionId === id);
    const catchAll = rewrites.findIndex((r) => r.source === "**");

    expect(rewrites[byFunction("lists")]?.source).toBe("/lists{,/**}");
    expect(rewrites[byFunction("tmdb")]?.source).toBe("/3/search/**");
    expect(rewrites.filter((r) => r.function?.functionId === "web").map((r) => r.source)).toEqual([
      "/api/**",
      "/l/**",
      "/r/**",
    ]);
    for (const id of ["lists", "tmdb", "web"]) {
      expect(rewrites[byFunction(id)]?.function?.region).toBe("europe-west1");
      expect(byFunction(id)).toBeLessThan(catchAll);
    }
    expect(rewrites[catchAll]?.destination).toBe("/index.html");
  });
});

describe("until the site moves to its final address", () => {
  it("asks search engines to stay away from the temporary one", () => {
    expect(readFileSync("public/robots.txt", "utf8")).toMatch(/Disallow: \/\s*$/);
    expect(readFileSync("index.html", "utf8")).toContain('name="robots" content="noindex"');
  });
});
